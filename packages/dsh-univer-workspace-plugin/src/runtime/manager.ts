/**
 * The headless collaboration runtime manager: owns the worker pool and
 * exposes an execute/read/write/commit surface over a target Unit to the
 * tools. The manager resolves a dsh session scope into a target, acquires a
 * lease, and runs the collaboration runtime exactly like apps/cli's daemon.
 * @module dsh-univer-workspace-plugin/runtime/manager
 */

import {
  createUniverCollaborationRuntimePool,
  type UniverCollaborationRuntimeLease,
} from "@univer-cli/univer-collaboration-runtime-pool";
import type { CollaborationCommitResult, CollaborationRuntimeValue } from "@univer-cli/univer-collaboration-runtime";
import type { WorkspaceRuntimeTarget } from "./target.js";
import { workspaceRuntimeKey } from "./target.js";

const MAX_COMMIT_ATTEMPTS = 3;

export class RuntimeManager {
  private readonly pool: ReturnType<typeof createUniverCollaborationRuntimePool<WorkspaceRuntimeTarget>>;
  private readonly workerUrl: URL;

  public constructor(workerUrl: URL) {
    this.workerUrl = workerUrl;
    this.pool = createUniverCollaborationRuntimePool<WorkspaceRuntimeTarget>({
      entry: workerUrl,
    });
  }

  public async close(): Promise<void> {
    await this.pool.close();
  }

  /** Read one Unit's data with the Facade API. */
  public async read(target: WorkspaceRuntimeTarget, code: string): Promise<CollaborationRuntimeValue> {
    const lease = await this.acquire(target);
    try {
      await this.synchronize(lease, target);
      const result = await lease.execute({ code, mode: "read" });
      return result.value;
    } finally {
      await lease.release();
    }
  }

  /** Execute a write in Worktree scope and commit the resulting changeset. */
  public async writeAndCommit(target: WorkspaceRuntimeTarget, code: string): Promise<{ committed: boolean; value: CollaborationRuntimeValue; revision?: number }> {
    if (target.scope.kind !== "worktree") {
      throw new Error("workspace target is not editable: execute requires a Worktree target");
    }
    const lease = await this.acquire(target);
    let reusable = false;
    try {
      await this.synchronize(lease, target);
      const executed = await lease.execute({ code, mode: "write" });
      if (executed.mutations.length === 0) {
        reusable = true;
        return { committed: false, value: executed.value };
      }
      const committed = await this.commitStableChangeset(lease);
      reusable = true;
      return { committed: true, revision: committed.state.baseRevision, value: executed.value };
    } finally {
      if (reusable) await lease.release();
      else await lease.invalidate();
    }
  }

  private async acquire(target: WorkspaceRuntimeTarget): Promise<UniverCollaborationRuntimeLease> {
    return await this.pool.acquire({ init: target, key: workspaceRuntimeKey(target) });
  }

  private async synchronize(lease: UniverCollaborationRuntimeLease, target: WorkspaceRuntimeTarget): Promise<void> {
    const before = await lease.getState();
    if (before.pendingMutationCount !== 0 || before.awaitingChangeset !== null || before.conflict !== null) {
      throw new Error("cached workspace runtime is not reusable");
    }
    const pulled = await lease.pull();
    if (pulled.status === "conflict") {
      throw new Error(`workspace runtime conflict: ${pulled.conflict.message}`);
    }
    if (pulled.state.baseRevision !== target.revision) {
      throw new Error(`workspace runtime revision ${String(pulled.state.baseRevision)} does not match selected revision ${String(target.revision)}`);
    }
  }

  private async commitStableChangeset(
    lease: UniverCollaborationRuntimeLease,
  ): Promise<Extract<CollaborationCommitResult, { readonly status: "confirmed" }>> {
    let lastResult: CollaborationCommitResult | undefined;
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const result = await lease.commit();
      lastResult = result;
      if (result.status === "confirmed") return result;
      if (result.status === "retry" || result.status === "unknown") continue;
      if (result.status === "conflict") {
        throw new Error(`workspace runtime conflict: ${result.conflict.message}`);
      }
      if (result.status === "pull-required") {
        throw new Error(`workspace advanced from revision ${String(result.baseRevision)} to ${String(result.knownHeadRevision)} during execute`);
      }
      throw new Error("workspace runtime discarded pending mutations");
    }
    throw new Error(`workspace changeset submit could not be confirmed after ${String(MAX_COMMIT_ATTEMPTS)} attempts`);
  }
}
