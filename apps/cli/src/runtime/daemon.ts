#!/usr/bin/env node
import { createDaemonServer, DAEMON_SOCKET_ENV, type JsonValue } from "@univer-cli/daemon";
import type { CollaborationCommitResult } from "@univer-cli/univer-collaboration-runtime";
import {
  createUniverCollaborationRuntimePool,
  type UniverCollaborationRuntimeLease,
} from "@univer-cli/univer-collaboration-runtime-pool";
import { workspaceSessionPath } from "../config.js";
import { readWorkspaceCookie } from "../features/auth/session.js";
import {
  createWorkspaceEmbeddedImageUploader,
  externalizeEmbeddedImages,
} from "../features/content/embedded-images.js";
import { WorkspaceHttp } from "../transport/http.js";
import {
  parseWorkspaceRuntimeTarget,
  workspaceRuntimeKey,
  type WorkspaceRuntimeTarget,
} from "./target.js";
import { workspaceDaemonIdentity } from "./daemon-identity.js";

const MAX_COMMIT_ATTEMPTS = 3;
const socketPath = process.env[DAEMON_SOCKET_ENV];
if (!socketPath) throw new Error(`${DAEMON_SOCKET_ENV} is required`);

const runtimePool = createUniverCollaborationRuntimePool<WorkspaceRuntimeTarget>({
  entry: new URL(/* @vite-ignore */ "./worker.js", import.meta.url),
});
const daemon = createDaemonServer({
  identity: workspaceDaemonIdentity(process.env),
  socketPath,
  onShutdown: async () => {
    await runtimePool.close();
  },
});

daemon.handle("runtime.execute-read", async (payload) => {
  const request = parseExecutionRequest(payload, "read");
  const lease = await acquire(request.target);
  try {
    await synchronize(lease, request.target);
    return (await lease.execute({ code: request.code, mode: "read" })) as unknown as JsonValue;
  } finally {
    await lease.release();
  }
});

daemon.handle("runtime.export-unit-data", async (payload) => {
  const target = parseTargetRequest(payload, "export");
  const lease = await acquire(target);
  try {
    await synchronize(lease, target);
    return (await lease.exportUnitData()) as unknown as JsonValue;
  } finally {
    await lease.release();
  }
});

daemon.handle("runtime.execute-and-commit", async (payload) => {
  const request = parseExecutionRequest(payload, "write");
  if (request.target.scope.kind !== "worktree") {
    throw codedError("WORKSPACE_TARGET_NOT_EDITABLE", "Execute requires a Worktree target");
  }
  const lease = await acquire(request.target);
  let reusable = false;
  try {
    await synchronize(lease, request.target);
    const executed = await lease.execute({ code: request.code, mode: "write" });
    if (executed.mutations.length === 0) {
      reusable = true;
      return { committed: false, value: executed.value } as JsonValue;
    }

    const http = await authenticatedHttp(request.target);
    const mutations = await externalizeEmbeddedImages({
      mutations: executed.mutations,
      unitId: request.target.unitId,
      uploader: createWorkspaceEmbeddedImageUploader(http),
      worktreeId: request.target.scope.worktreeId,
    });
    await lease.replacePendingMutations(mutations);
    const committed = await commitStableChangeset(lease);
    reusable = true;
    return {
      committed: true,
      revision: committed.state.baseRevision,
      status: "committed",
      value: executed.value,
    } as JsonValue;
  } finally {
    if (reusable) await lease.release();
    else await lease.invalidate();
  }
});

await daemon.listen();
process.once("SIGINT", () => void daemon.close());
process.once("SIGTERM", () => void daemon.close());

async function acquire(target: WorkspaceRuntimeTarget): Promise<UniverCollaborationRuntimeLease> {
  return await runtimePool.acquire({ init: target, key: workspaceRuntimeKey(target) });
}

async function synchronize(
  lease: UniverCollaborationRuntimeLease,
  target: WorkspaceRuntimeTarget,
): Promise<void> {
  const before = await lease.getState();
  if (
    before.pendingMutationCount !== 0 ||
    before.awaitingChangeset !== null ||
    before.conflict !== null
  ) {
    throw codedError("WORKSPACE_RUNTIME_DIRTY", "Cached Workspace runtime is not reusable");
  }
  const pulled = await lease.pull();
  if (pulled.status === "conflict") {
    throw codedError("WORKSPACE_RUNTIME_CONFLICT", pulled.conflict.message);
  }
  if (pulled.state.baseRevision !== target.revision) {
    throw codedError(
      "workspace-result-mismatch",
      `Workspace runtime revision ${String(pulled.state.baseRevision)} does not match selected revision ${String(target.revision)}`,
    );
  }
}

async function commitStableChangeset(
  lease: UniverCollaborationRuntimeLease,
): Promise<Extract<CollaborationCommitResult, { readonly status: "confirmed" }>> {
  let lastResult: CollaborationCommitResult | undefined;
  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
    const result = await lease.commit();
    lastResult = result;
    if (result.status === "confirmed") return result;
    if (result.status === "retry" || result.status === "unknown") continue;
    if (result.status === "conflict") {
      throw codedError("WORKSPACE_RUNTIME_CONFLICT", result.conflict.message);
    }
    if (result.status === "pull-required") {
      throw codedError(
        "WORKSPACE_RUNTIME_PULL_REQUIRED",
        `Workspace advanced from revision ${String(result.baseRevision)} to ${String(result.knownHeadRevision)} during execute`,
      );
    }
    throw codedError("WORKSPACE_RUNTIME_COMMIT_INVALID", "Runtime discarded pending mutations");
  }
  const awaiting =
    lastResult !== undefined && (lastResult.status === "retry" || lastResult.status === "unknown")
      ? lastResult.changeset
      : undefined;
  throw codedError(
    "workspace-submit-retry-exhausted",
    `Workspace changeset submit could not be confirmed after ${String(MAX_COMMIT_ATTEMPTS)} attempts${awaiting === undefined ? "" : ` (sid ${awaiting.sid ?? "unknown"}, reqId ${String(awaiting.reqId ?? "unknown")})`}`,
  );
}

async function authenticatedHttp(target: WorkspaceRuntimeTarget): Promise<WorkspaceHttp> {
  const cookie = await readWorkspaceCookie({
    origin: target.origin,
    sessionPath: workspaceSessionPath(process.env),
  });
  if (cookie === undefined) {
    throw codedError(
      "workspace-authentication-required",
      "Log in to the current Workspace origin first.",
    );
  }
  return new WorkspaceHttp({ cookie, origin: target.origin, role: "client" });
}

function parseExecutionRequest(
  payload: JsonValue,
  mode: "read" | "write",
): { readonly code: string; readonly target: WorkspaceRuntimeTarget } {
  if (
    !isRecord(payload) ||
    typeof payload["code"] !== "string" ||
    payload["target"] === undefined
  ) {
    throw codedError("WORKSPACE_REQUEST_INVALID", `Workspace runtime ${mode} request is invalid`);
  }
  return { code: payload["code"], target: parseWorkspaceRuntimeTarget(payload["target"]) };
}

function parseTargetRequest(payload: JsonValue, operation: string): WorkspaceRuntimeTarget {
  if (!isRecord(payload) || payload["target"] === undefined) {
    throw codedError(
      "WORKSPACE_REQUEST_INVALID",
      `Workspace runtime ${operation} request is invalid`,
    );
  }
  return parseWorkspaceRuntimeTarget(payload["target"]);
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
