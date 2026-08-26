/**
 * Concrete Univer Workspace service implementation.
 *
 * Owns the space-links domain, reconciles the current User's remote Spaces
 * against dsh workspace records (provisioning the mechanical per-Space
 * directories), and resolves a session working directory back to its
 * `{ userId, spaceId }` through the workspace registry's own path
 * canonicalization.
 * @module dsh-univer-workspace-plugin/provider/service-provider
 */

import { mkdir } from "node:fs/promises";
import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { Domain } from "@deepseek-ai/dsh-storage-domain";
import type {} from "@deepseek-ai/dsh-workspace";
import type { CollaborationRuntimeValue } from "@univer-cli/univer-collaboration-runtime";
import { spaceDirectoryPath } from "@univerjs/univer-workspace-harness/identity";
import type { WorkspaceHttpClient } from "@univerjs/univer-workspace-harness";
import type {} from "@univerjs/univer-workspace-harness";
import type { WorkspaceDocument, WorkspaceSpace } from "../shared/wire.ts";
import {
  UniverWorkspaceService, type CreateDocumentInput, type EditUnitInput, type SpaceScope,
} from "../service/univer-workspace-service.ts";
import { RuntimeManager } from "../runtime/manager.js";
import type { WorkspaceRuntimeTarget } from "../runtime/target.js";
import { spaceLinksDomainSpec } from "./space-links.ts";
import {
  addWorktreeTrunkUnit, createDocument as apiCreateDocument, createWorktree as apiCreateWorktree,
  discardWorktree, listSpaceDocuments, listSpaces, markWorktreeReady, mergeWorktree,
  openResource, openWorktreeUnit,
} from "./workspace-api.ts";
import {
  awaitTask, downloadFile, startExport, startImport, uploadFile,
  type ExchangeTaskResult, type ExchangeUnitType, type ExportRequest, type ImportRequest,
} from "./exchange.ts";

export interface ServiceProviderConfig {
  /** Root under which per-user, per-Space mechanical directories live. */
  workspaceRoot: string;
  /** Absolute file URL of the worker bundle (produced by the package build). */
  workerUrl: URL;
  /** Univer runtime license (fall back to the built-in development license when empty). */
  license: string;
}

class UniverWorkspaceServiceImpl extends UniverWorkspaceService {
  private table: ReturnType<Domain<typeof spaceLinksDomainSpec>["table"]> | undefined;
  private readonly runtimeManager: RuntimeManager;

  constructor(
    ctx: Context,
    private readonly config: ServiceProviderConfig,
  ) {
    super(ctx);
    this.runtimeManager = new RuntimeManager(config.workerUrl);
    ctx.effect(() => () => { void this.runtimeManager.close(); }, "univer-workspace: runtime pool close");
  }

  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(spaceLinksDomainSpec);
    this.ctx.effect(() => () => { void domain.close(); }, "univer-workspace: space-links domain close");
    this.table = domain.table("links");
  }

  async listSpaces(userId: string): Promise<{ spaces: readonly WorkspaceSpace[] }> {
    const client = this.ctx.workspaceAuth.clientFor(userId);
    if (client === undefined) {
      throw new Error("workspace credential is missing; sign in again");
    }
    const remote = await listSpaces(client);
    const spaces: WorkspaceSpace[] = [];
    for (const space of remote) {
      const dshWorkspaceId = await this.reconcileSpace(userId, space.spaceId, space.name);
      spaces.push({
        spaceId: space.spaceId,
        type: space.type,
        name: space.name,
        accessRole: space.accessRole,
        dshWorkspaceId,
      });
    }
    return { spaces };
  }

  async resolveSpaceForSession(cwd: string): Promise<SpaceScope | undefined> {
    const workspace = await this.ctx.workspaceRegistry.resolveByPath(cwd);
    if (workspace === undefined) return undefined;
    const record = this.requireTable().get(workspace.id);
    return record === undefined ? undefined : { userId: record.userId, spaceId: record.spaceId };
  }

  async listDocuments(userId: string, spaceId: string): Promise<readonly WorkspaceDocument[]> {
    const client = this.requireClient(userId);
    return await listSpaceDocuments(client, spaceId);
  }

  async openDocument(userId: string, resourceId: string) {
    const client = this.requireClient(userId);
    return await openResource(client, resourceId);
  }

  async createDocument(userId: string, input: CreateDocumentInput) {
    const client = this.requireClient(userId);
    return await apiCreateDocument(client, input);
  }

  async createWorktree(userId: string, input: { name: string; summary: string | null }) {
    const client = this.requireClient(userId);
    return await apiCreateWorktree(client, input);
  }

  async addWorktreeTrunkUnit(userId: string, worktreeId: string, resourceId: string): Promise<void> {
    const client = this.requireClient(userId);
    await addWorktreeTrunkUnit(client, worktreeId, resourceId);
  }

  async openWorktreeUnit(userId: string, worktreeId: string, unitId: string, mode: "draft" | "trunk" | "mergePreview") {
    const client = this.requireClient(userId);
    return await openWorktreeUnit(client, worktreeId, unitId, mode);
  }

  async markWorktreeReady(userId: string, worktreeId: string) {
    const client = this.requireClient(userId);
    return await markWorktreeReady(client, worktreeId);
  }

  async discardWorktree(userId: string, worktreeId: string) {
    const client = this.requireClient(userId);
    return await discardWorktree(client, worktreeId);
  }

  async mergeWorktree(userId: string, worktreeId: string) {
    const client = this.requireClient(userId);
    return await mergeWorktree(client, worktreeId);
  }

  async readUnit(userId: string, input: EditUnitInput): Promise<CollaborationRuntimeValue> {
    const client = this.requireClient(userId);
    const target: WorkspaceRuntimeTarget = {
      origin: client.origin,
      revision: input.revision,
      scope: input.scope,
      unitId: input.unitId,
      unitType: input.unitType,
      sessionToken: client.sessionToken,
      license: this.config.license,
    };
    return await this.runtimeManager.read(target, input.code);
  }

  async editUnit(userId: string, input: EditUnitInput): Promise<{ committed: boolean; value: CollaborationRuntimeValue; revision?: number }> {
    const client = this.requireClient(userId);
    const target: WorkspaceRuntimeTarget = {
      origin: client.origin,
      revision: input.revision,
      scope: input.scope,
      unitId: input.unitId,
      unitType: input.unitType,
      sessionToken: client.sessionToken,
      license: this.config.license,
    };
    return await this.runtimeManager.writeAndCommit(target, input.code);
  }

  async importFile(userId: string, input: { filename: string; bytes: Uint8Array; mediaType: string; type: ExchangeUnitType | "auto"; request: ImportRequest }): Promise<ExchangeTaskResult> {
    const client = this.requireClient(userId);
    const fileID = await uploadFile(client, input.filename, input.bytes, input.mediaType);
    const taskID = await startImport(client, input.type, { ...input.request, fileID });
    return await awaitTask(client, taskID);
  }

  async exportFile(userId: string, input: { type: ExchangeUnitType; request: ExportRequest }): Promise<ExchangeTaskResult> {
    const client = this.requireClient(userId);
    const taskID = await startExport(client, input.type, input.request);
    return await awaitTask(client, taskID);
  }

  async downloadFileBytes(userId: string, fileID: string): Promise<Uint8Array> {
    const client = this.requireClient(userId);
    return await downloadFile(client, fileID);
  }

  private requireClient(userId: string): WorkspaceHttpClient {
    const client = this.ctx.workspaceAuth.clientFor(userId);
    if (client === undefined) {
      throw new Error("workspace credential is missing; sign in again");
    }
    return client;
  }
  private async reconcileSpace(userId: string, spaceId: string, name: string): Promise<string> {
    const table = this.requireTable();
    // Reuse an existing link for this space id (same user), so the backing dsh
    // workspace stays stable across list calls and Pod restarts.
    for (const [key, record] of table.entries()) {
      if (record.userId === userId && record.spaceId === spaceId) return key;
    }
    const directory = spaceDirectoryPath(this.config.workspaceRoot, userId, spaceId);
    await mkdir(directory, { recursive: true });
    const workspace = (await this.ctx.workspaceRegistry.resolveByPath(directory))
      ?? await this.ctx.workspaceRegistry.create(directory, name);
    await table.put(workspace.id, { userId, spaceId });
    return workspace.id;
  }

  private requireTable(): ReturnType<Domain<typeof spaceLinksDomainSpec>["table"]> {
    if (this.table === undefined) {
      throw new Error("space-links domain is not initialized");
    }
    return this.table;
  }
}

export const name = "univer-workspace-provider";

export const inject = ["storageDomain", "workspaceAuth", "workspaceRegistry"];

/** Mount the Univer Workspace capability service. */
export function apply(ctx: Context, config: ServiceProviderConfig): void {
  new UniverWorkspaceServiceImpl(ctx, config);
}
