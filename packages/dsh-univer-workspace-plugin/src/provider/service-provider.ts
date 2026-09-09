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

import type { WorktreeListQuery } from "../shared/state.ts";
import { mkdir } from "node:fs/promises";
import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { Domain } from "@deepseek-ai/dsh-storage-domain";
import type {} from "@deepseek-ai/dsh-session-persistence";
import type { SessionHeader } from "@deepseek-ai/dsh-session";
import type { Workspace, WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type {
  CollaborationRuntimeValue,
  CollaborationUnitData,
} from "@univer-cli/univer-collaboration-runtime";
import type { ContentInspectionResult } from "@univer-cli/content-inspection";
import {
  originSpaceDirectoryPath,
  originUserDirectoryPath,
  type WorkspaceAuthService,
  type WorkspaceHttpClient,
} from "./workspace-contract.ts";
import type { DocumentListOptions, WorkspaceDocument, WorkspaceSpace } from "../shared/wire.ts";
import {
  UniverWorkspaceService,
  type CreateDocumentInput,
  type EditUnitInput,
  type SpaceScope,
  type InspectUnitInput,
} from "../service/univer-workspace-service.ts";
import { RuntimeManager } from "../runtime/manager.js";
import type { WorkspaceRuntimeTarget } from "../runtime/target.js";
import { spaceLinksDomainSpec } from "./space-links.ts";
import {
  addWorktreeTrunkUnit,
  createDocument as apiCreateDocument,
  createWorktree as apiCreateWorktree,
  createWorktreeLocalUnit as apiCreateWorktreeLocalUnit,
  setWorktreeUnitRemoved as apiSetWorktreeUnitRemoved,
  discardWorktree,
  listWorktreePage,
  listSpaceDocuments,
  listSpaces,
  markWorktreeReady,
  mergeWorktree,
  getFileState as apiGetFileState,
  getWorktreeDetail,
  getWorktreeFileState as apiGetWorktreeFileState,
  openResource,
  openWorktreeUnit,
  reopenWorktree,
  resolveUnitResource as apiResolveUnitResource,
  type CreateWorktreeLocalUnitInput,
} from "./workspace-api.ts";
import { inspectionQuery } from "./inspection.ts";

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
  private readonly connectionVersion: string | undefined;

  constructor(
    ctx: Context,
    private readonly config: ServiceProviderConfig,
  ) {
    super(ctx);
    this.connectionVersion = ctx.get("workspaceRuntime")?.version;
    this.runtimeManager = new RuntimeManager(config.workerUrl);
    ctx.effect(
      () => () => {
        return this.runtimeManager.close();
      },
      "univer-workspace: runtime pool close",
    );
  }

  async listSpaces(userId: string): Promise<{ spaces: readonly WorkspaceSpace[] }> {
    const auth = this.requireWorkspaceAuth();
    const client = this.currentClientFor(userId);
    if (client === undefined) {
      throw new Error("workspace connection is unavailable; connect to Workspace");
    }
    const remote = await listSpaces(client);
    // The registry rebuilds its header index during boot. A rolling restart
    // can recreate the per-Space directories after that bootstrap, so attach
    // durable session headers again once the canonical paths exist.
    const persistedHeaders = await this.persistedSessionHeaders();
    const spaces: WorkspaceSpace[] = [];
    for (const space of remote) {
      const dshWorkspaceId = await this.reconcileSpace(
        userId,
        space.spaceId,
        space.name,
        persistedHeaders,
      );
      spaces.push({
        spaceId: space.spaceId,
        type: space.type,
        name: space.name,
        accessRole: space.accessRole,
        dshWorkspaceId,
        ...(space.capabilities === undefined ? {} : { capabilities: space.capabilities }),
      });
    }
    return { spaces };
  }

  async resolveSpaceForSession(cwd: string): Promise<SpaceScope | undefined> {
    const workspace = await this.ctx.workspaceRegistry.resolveByPath(cwd);
    if (workspace === undefined) return undefined;
    const record = (await this.requireTable()).get(workspace.id);
    const auth = this.requireWorkspaceAuth();
    const identity = auth.currentIdentity();
    if (identity === undefined) return undefined;
    const origin = new URL(auth.effectiveOrigin()).origin;
    if (record !== undefined) {
      if (record.userId !== identity.userId || (record.origin !== undefined && record.origin !== origin))
        return undefined;
      return { userId: record.userId, spaceId: record.spaceId };
    }
    // The account-level workspace is created by the Harness home/template flow.
    // Its default destination is the authenticated account's personal Space;
    // arbitrary local workspaces never inherit this connection.
    if (workspace.path !== originUserDirectoryPath(this.config.workspaceRoot, origin, identity.userId))
      return undefined;
    const spaces = await listSpaces(this.requireClient(identity.userId));
    const personal = spaces.find((space) => space.type === "personal" && space.accessRole === "owner");
    return personal === undefined ? undefined : { userId: identity.userId, spaceId: personal.spaceId };
  }

  async listDocuments(
    userId: string,
    spaceId: string,
    options?: DocumentListOptions,
  ): Promise<readonly WorkspaceDocument[]> {
    const client = this.requireClient(userId);
    return await listSpaceDocuments(client, spaceId, options);
  }

  async openDocument(userId: string, resourceId: string) {
    const client = this.requireClient(userId);
    return await openResource(client, resourceId);
  }

  async resolveUnitResource(userId: string, unitId: string) {
    const client = this.requireClient(userId);
    return await apiResolveUnitResource(client, unitId);
  }

  async createDocument(userId: string, input: CreateDocumentInput) {
    const client = this.requireClient(userId);
    return await apiCreateDocument(client, input);
  }

  async createWorktree(userId: string, input: { name: string; summary: string | null }) {
    const client = this.requireClient(userId);
    return await apiCreateWorktree(client, input);
  }

  async getWorktreeDetail(userId: string, worktreeId: string) {
    const client = this.requireClient(userId);
    return await getWorktreeDetail(client, worktreeId);
  }

  async listWorktrees(userId: string, query: WorktreeListQuery = {}) {
    const client = this.requireClient(userId);
    return await listWorktreePage(client, query);
  }

  async addWorktreeTrunkUnit(userId: string, worktreeId: string, resourceId: string) {
    const client = this.requireClient(userId);
    return await addWorktreeTrunkUnit(client, worktreeId, resourceId);
  }

  async createWorktreeLocalUnit(userId: string, input: CreateWorktreeLocalUnitInput) {
    const client = this.requireClient(userId);
    return await apiCreateWorktreeLocalUnit(client, input);
  }

  async openWorktreeUnit(
    userId: string,
    worktreeId: string,
    unitId: string,
    mode: "draft" | "trunk" | "mergePreview",
  ) {
    const client = this.requireClient(userId);
    return await openWorktreeUnit(client, worktreeId, unitId, mode);
  }

  async markWorktreeReady(userId: string, worktreeId: string) {
    const client = this.requireClient(userId);
    return await markWorktreeReady(client, worktreeId);
  }

  async setWorktreeUnitRemoved(
    userId: string,
    worktreeId: string,
    unitId: string,
    removed: boolean,
  ) {
    return apiSetWorktreeUnitRemoved(this.requireClient(userId), worktreeId, unitId, removed);
  }

  async discardWorktree(userId: string, worktreeId: string) {
    const client = this.requireClient(userId);
    return await discardWorktree(client, worktreeId);
  }

  async mergeWorktree(userId: string, worktreeId: string) {
    const client = this.requireClient(userId);
    return await mergeWorktree(client, worktreeId);
  }

  async reopenWorktree(userId: string, worktreeId: string) {
    const client = this.requireClient(userId);
    return await reopenWorktree(client, worktreeId);
  }

  async getFileState(userId: string, resourceId: string) {
    const client = this.requireClient(userId);
    return await apiGetFileState(client, resourceId);
  }

  async getWorktreeFileState(userId: string, worktreeId: string) {
    const client = this.requireClient(userId);
    return await apiGetWorktreeFileState(client, worktreeId);
  }

  async transitionWorktree(
    userId: string,
    worktreeId: string,
    action: "ready" | "reopen" | "merge" | "discard",
  ) {
    const client = this.requireClient(userId);
    if (action === "ready") return await markWorktreeReady(client, worktreeId);
    if (action === "merge") return await mergeWorktree(client, worktreeId);
    if (action === "discard") return await discardWorktree(client, worktreeId);
    return await reopenWorktree(client, worktreeId);
  }

  async readUnit(userId: string, input: EditUnitInput): Promise<CollaborationRuntimeValue> {
    const client = this.requireClient(userId);
    const target: WorkspaceRuntimeTarget = {
      origin: client.origin,
      revision: input.revision ?? -1,
      scope: input.scope,
      unitId: input.unitId,
      unitType: input.unitType,
      sessionToken: client.sessionToken,
      license: this.config.license,
    };
    return await this.runtimeManager.read(target, input.code);
  }

  async inspectUnit(userId: string, input: InspectUnitInput): Promise<ContentInspectionResult> {
    const client = this.requireClient(userId);
    const target: WorkspaceRuntimeTarget = {
      origin: client.origin,
      revision: input.revision ?? -1,
      scope: input.scope,
      unitId: input.unitId,
      unitType: input.unitType,
      sessionToken: client.sessionToken,
      license: this.config.license,
    };
    return await this.runtimeManager.inspect(target, inspectionQuery(input.unitType, input.range));
  }

  async exportUnitData(
    userId: string,
    input: {
      scope: WorkspaceRuntimeTarget["scope"];
      unitId: string;
      unitType: WorkspaceRuntimeTarget["unitType"];
      revision?: number;
    },
  ): Promise<CollaborationUnitData> {
    const client = this.requireClient(userId);
    const target: WorkspaceRuntimeTarget = {
      origin: client.origin,
      revision: input.revision ?? -1,
      scope: input.scope,
      unitId: input.unitId,
      unitType: input.unitType,
      sessionToken: client.sessionToken,
      license: this.config.license,
    };
    return await this.runtimeManager.exportUnitData(target);
  }

  async editUnit(
    userId: string,
    input: EditUnitInput,
  ): Promise<{ committed: boolean; value: CollaborationRuntimeValue; revision?: number }> {
    const client = this.requireClient(userId);
    const target: WorkspaceRuntimeTarget = {
      origin: client.origin,
      revision: input.revision ?? -1,
      scope: input.scope,
      unitId: input.unitId,
      unitType: input.unitType,
      sessionToken: client.sessionToken,
      license: this.config.license,
    };
    return await this.runtimeManager.writeAndCommit(target, input.code);
  }

  private requireClient(userId: string): WorkspaceHttpClient {
    const client = this.currentClientFor(userId);
    if (client === undefined) {
      throw new Error("workspace connection is unavailable; connect to Workspace");
    }
    return client;
  }

  private currentClientFor(userId: string): WorkspaceHttpClient | undefined {
    const auth = this.requireWorkspaceAuth();
    const identity = auth.currentIdentity();
    if (this.ctx.get("workspaceRuntime")?.version !== this.connectionVersion || identity === undefined || identity.userId !== userId) {
      return undefined;
    }
    return auth.currentClient();
  }
  private async reconcileSpace(
    userId: string,
    spaceId: string,
    name: string,
    headers: readonly SessionHeader[],
  ): Promise<string> {
    const table = await this.requireTable();
    const auth = this.requireWorkspaceAuth();
    const origin = new URL(auth.effectiveOrigin()).origin;
    const directory = originSpaceDirectoryPath(this.config.workspaceRoot, origin, userId, spaceId);
    // workspaceRoot is an ephemeral working volume in the deployment. Always
    // recreate the deterministic directory before resolving the registry path.
    await mkdir(directory, { recursive: true });
    // Reuse an existing link for this space id (same user), so the backing dsh
    // workspace stays stable across list calls and Pod restarts.
    for (const [key, record] of table.entries()) {
      if (
        record.userId === userId &&
        record.spaceId === spaceId &&
        (record.origin === undefined || record.origin === origin)
      ) {
        const candidate = this.ctx.workspaceRegistry.get(key as WorkspaceId);
        const workspace =
          candidate?.path === directory
            ? candidate
            : await this.ctx.workspaceRegistry.resolveByPath(directory);
        if (workspace !== undefined) {
          if (record.origin !== origin) await table.put(key, { ...record, origin });
          await this.attachPersistedSessions(workspace, directory, headers);
          return workspace.id;
        }
        // A stale link can only occur when a registry record was lost or was
        // manually removed. Recreate the mechanical workspace and repair the
        // link atomically from the domain consumer's perspective.
        const recreated = await this.ctx.workspaceRegistry.create(directory, name);
        await table.delete(key);
        await table.put(recreated.id, { userId, spaceId, origin });
        await this.attachPersistedSessions(recreated, directory, headers);
        return recreated.id;
      }
    }
    const workspace =
      (await this.ctx.workspaceRegistry.resolveByPath(directory)) ??
      (await this.ctx.workspaceRegistry.create(directory, name));
    await table.put(workspace.id, { userId, spaceId, origin });
    await this.attachPersistedSessions(workspace, directory, headers);
    return workspace.id;
  }

  private async persistedSessionHeaders(): Promise<readonly SessionHeader[]> {
    const persistence = this.ctx.get("sessionPersistence");
    if (persistence === undefined) return [];
    return (await persistence.list()).map((snapshot) => snapshot.header);
  }

  private async attachPersistedSessions(
    workspace: Workspace,
    directory: string,
    headers: readonly SessionHeader[],
  ): Promise<void> {
    const attached = new Set(workspace.sessionIds);
    for (const header of headers) {
      if (header.cwd !== directory || attached.has(header.id)) continue;
      await workspace.attachSession(header.id);
      attached.add(header.id);
    }
  }

  private async requireTable(): Promise<ReturnType<Domain<typeof spaceLinksDomainSpec>["table"]>> {
    if (this.table !== undefined) return this.table;
    const storageDomain = this.ctx.get("storageDomain") as
      | { open(spec: typeof spaceLinksDomainSpec): Promise<Domain<typeof spaceLinksDomainSpec>> }
      | undefined;
    if (storageDomain === undefined) {
      throw new Error("storageDomain service is unavailable");
    }
    const domain = await storageDomain.open(spaceLinksDomainSpec);
    this.ctx.effect(
      () => () => {
        void domain.close();
      },
      "univer-workspace: space-links domain close",
    );
    this.table = domain.table("links");
    return this.table;
  }

  private requireWorkspaceAuth(): WorkspaceAuthService {
    const service = this.ctx.get("workspaceAuth") as WorkspaceAuthService | undefined;
    if (service === undefined) {
      throw new Error("workspaceAuth service is unavailable");
    }
    return service;
  }
}

export const name = "univer-workspace-provider";

// `workspaceAuth` is fetched with ctx.get() inside UniverWorkspaceServiceImpl
// at call time; a static cross-row inject here would pend this whole row on
// the harness core's startup order and could fail the deployment boot.
export const inject = ["storageDomain", "workspaceRegistry", "sessionPersistence"];

/** Mount the Univer Workspace capability service. */
export function apply(ctx: Context, config: ServiceProviderConfig): void {
  new UniverWorkspaceServiceImpl(ctx, config);
}
