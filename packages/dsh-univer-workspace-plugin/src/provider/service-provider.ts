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
import { spaceDirectoryPath } from "@univerjs/univer-workspace-harness/identity";
import type { WorkspaceHttpClient } from "@univerjs/univer-workspace-harness";
import type {} from "@univerjs/univer-workspace-harness";
import type { WorkspaceDocument, WorkspaceSpace } from "../shared/wire.ts";
import {
  UniverWorkspaceService, type CreateDocumentInput, type SpaceScope,
} from "../service/univer-workspace-service.ts";
import { spaceLinksDomainSpec } from "./space-links.ts";
import {
  addWorktreeTrunkUnit, createDocument as apiCreateDocument, createWorktree as apiCreateWorktree,
  discardWorktree, listSpaceDocuments, listSpaces, markWorktreeReady, mergeWorktree,
  openResource, openWorktreeUnit,
} from "./workspace-api.ts";

export interface ServiceProviderConfig {
  /** Root under which per-user, per-Space mechanical directories live. */
  workspaceRoot: string;
}

class UniverWorkspaceServiceImpl extends UniverWorkspaceService {
  private table: ReturnType<Domain<typeof spaceLinksDomainSpec>["table"]> | undefined;

  constructor(
    ctx: Context,
    private readonly config: ServiceProviderConfig,
  ) {
    super(ctx);
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
