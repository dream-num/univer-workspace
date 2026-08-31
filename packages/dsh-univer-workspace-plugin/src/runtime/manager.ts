/**
 * The headless collaboration runtime manager: owns the worker pool and
 * exposes an execute/read/write/commit surface over a target Unit to the
 * tools. The manager resolves a dsh session scope into a target, acquires a
 * lease, and runs the collaboration runtime exactly like apps/cli's daemon.
 * @module dsh-univer-workspace-plugin/runtime/manager
 */

import {
  createUniverCollaborationRuntimePool,
  type UniverCollaborationRuntimePoolEvent,
  type UniverCollaborationRuntimeLease,
} from "@univer-cli/univer-collaboration-runtime-pool";
import { prepareContentExecutionProgram } from "@univer-cli/content-execution";
import { inspectContent, type ContentInspectionQuery, type ContentInspectionResult } from "@univer-cli/content-inspection";
import type {
  CollaborationCommitResult,
  CollaborationRuntimeValue,
  CollaborationUnitData,
} from "@univer-cli/univer-collaboration-runtime";
import type { WorkspaceRuntimeTarget } from "./target.js";
import { workspaceRuntimeKey } from "./target.js";

const MAX_COMMIT_ATTEMPTS = 3;

type DiagnosticError = Error & { readonly code?: unknown };

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const diagnosticError = error as DiagnosticError;
    const cause = error.cause;
    return {
      name: error.name,
      message: error.message,
      ...(typeof diagnosticError.code === "string" ? { code: diagnosticError.code } : {}),
      ...(error.stack === undefined ? {} : { stack: error.stack.slice(0, 4000) }),
      ...(cause instanceof Error ? { cause: errorDetails(cause) } : {}),
    };
  }
  return { message: String(error) };
}

function diagnosticId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.message.trim() !== "") {
      messages.push(current.message.trim());
      current = current.cause;
      continue;
    }
    if (typeof current === "string" && current.trim() !== "") messages.push(current.trim());
    break;
  }
  return messages;
}

/** Preserve the actionable worker message when the pool reports a crash. */
export function runtimeFailureMessage(
  operation: string,
  target: Pick<WorkspaceRuntimeTarget, "unitType" | "unitId">,
  error: unknown,
  workerCode: string | undefined,
  id: string,
): string {
  const messages = errorMessages(error);
  const detail = messages.length === 0 ? "" : `: ${messages.join("; caused by: ")}`;
  const workerDiagnostic = workerCode === undefined
    ? `diagnostic id: ${id}`
    : `worker diagnostic: ${workerCode}; diagnostic id: ${id}`;
  return `Univer runtime ${operation} failed for ${target.unitType} Unit ${target.unitId}${detail} (${workerDiagnostic})`;
}

function logRuntimeDiagnostic(payload: Record<string, unknown>): void {
  // stderr is intentionally used: DSH and Kubernetes collect it even when
  // the tool transport has already disconnected or a worker has crashed.
  console.error(`[uwh-runtime] ${JSON.stringify(payload)}`);
}

export class RuntimeManager {
  private readonly pool: ReturnType<typeof createUniverCollaborationRuntimePool<WorkspaceRuntimeTarget>>;
  private readonly workerUrl: URL;
  /** Last worker-side error code observed before the pool reports a crash. */
  private readonly workerFailures = new Map<string, string>();

  public constructor(workerUrl: URL) {
    this.workerUrl = workerUrl;
    this.pool = createUniverCollaborationRuntimePool<WorkspaceRuntimeTarget>({
      entry: workerUrl,
      onEvent: (event: UniverCollaborationRuntimePoolEvent) => {
        if (event.type === "instance-failed") {
          this.workerFailures.set(event.key, event.errorCode);
          logRuntimeDiagnostic({
            event: "worker-instance-failed",
            key: event.key,
            errorCode: event.errorCode,
            at: new Date().toISOString(),
          });
        }
      },
    });
  }

  public async close(): Promise<void> {
    await this.pool.close();
  }

  /** Read one Unit's data with the Facade API. */
  public async read(target: WorkspaceRuntimeTarget, code: string): Promise<CollaborationRuntimeValue> {
    return await this.withDiagnosticContext(target, "read", async () => {
      const lease = await this.acquire(target);
      let reusable = false;
      try {
        await this.synchronize(lease, target);
        const result = await lease.execute({
          code: prepareContentExecutionProgram({ code, unitId: target.unitId, unitType: target.unitType }),
          mode: "read",
        });
        reusable = true;
        return result.value;
      } finally {
        if (reusable) await lease.release();
        else await lease.invalidate();
      }
    });
  }

  /** Inspect stable structured content without exposing arbitrary write code. */
  public async inspect(
    target: WorkspaceRuntimeTarget,
    query: ContentInspectionQuery,
  ): Promise<ContentInspectionResult> {
    return await this.withDiagnosticContext(target, "inspect", async () => {
      const lease = await this.acquire(target);
      let reusable = false;
      try {
        await this.synchronize(lease, target);
        const result = await inspectContent(
          {
            unitId: lease.unitId,
            unitType: target.unitType,
            execute: async (input) => await lease.execute(input),
          },
          query,
        );
        reusable = true;
        return result;
      } finally {
        if (reusable) await lease.release();
        else await lease.invalidate();
      }
    });
  }

  /** Export the synchronized UnitData for local Office conversion. */
  public async exportUnitData(target: WorkspaceRuntimeTarget): Promise<CollaborationUnitData> {
    return await this.withDiagnosticContext(target, "export", async () => {
      const lease = await this.acquire(target);
      let reusable = false;
      try {
        await this.synchronize(lease, target);
        const result = await lease.exportUnitData();
        reusable = true;
        return result;
      } finally {
        if (reusable) await lease.release();
        else await lease.invalidate();
      }
    });
  }

  /** Execute a write in Worktree scope and commit the resulting changeset. */
  public async writeAndCommit(target: WorkspaceRuntimeTarget, code: string): Promise<{ committed: boolean; value: CollaborationRuntimeValue; revision?: number }> {
    if (target.scope.kind !== "worktree") {
      throw new Error("workspace target is not editable: execute requires a Worktree target");
    }
    return await this.withDiagnosticContext(target, "write", async () => {
      const lease = await this.acquire(target);
      let reusable = false;
      try {
        await this.synchronize(lease, target);
        const executed = await lease.execute({
          code: prepareContentExecutionProgram({ code, unitId: target.unitId, unitType: target.unitType }),
          mode: "write",
        });
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
    });
  }

  private async acquire(target: WorkspaceRuntimeTarget): Promise<UniverCollaborationRuntimeLease> {
    return await this.pool.acquire({ init: target, key: workspaceRuntimeKey(target) });
  }

  /** Preserve the pool's worker-side failure code at the tool boundary. */
  private async withDiagnosticContext<T>(
    target: WorkspaceRuntimeTarget,
    operation: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    const key = workspaceRuntimeKey(target);
    try {
      return await callback();
    } catch (error) {
      const workerCode = this.workerFailures.get(key);
      this.workerFailures.delete(key);
      const id = diagnosticId();
      logRuntimeDiagnostic({
        event: "runtime-operation-failed",
        diagnosticId: id,
        operation,
        unitType: target.unitType,
        unitId: target.unitId,
        scope: target.scope.kind,
        revision: target.revision,
        workerCode,
        error: errorDetails(error),
        at: new Date().toISOString(),
      });
      throw new Error(runtimeFailureMessage(operation, target, error, workerCode, id), { cause: error });
    }
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
    if (target.revision >= 0 && pulled.state.baseRevision !== target.revision) {
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
