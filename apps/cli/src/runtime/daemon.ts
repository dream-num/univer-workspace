#!/usr/bin/env node
import { createDaemonServer, DAEMON_SOCKET_ENV, type JsonValue } from "@univer-cli/daemon";
import type {
  WorkspaceContentRuntime,
  WorkspaceRuntimeTarget,
} from "@univerjs/univer-workspace-client-core";
import { resolveUniverLicense, workspaceSessionPath } from "../config.js";
import { readWorkspaceCookie } from "../features/auth/session.js";
import { workspaceDaemonIdentity } from "./daemon-identity.js";

const socketPath = process.env[DAEMON_SOCKET_ENV];
if (!socketPath) throw new Error(`${DAEMON_SOCKET_ENV} is required`);

interface ContentSession {
  readonly runtime: WorkspaceContentRuntime;
  readonly parseTarget: (value: unknown) => WorkspaceRuntimeTarget;
}

let contentSession: Promise<ContentSession> | undefined;
let closing = false;

async function getContentSession(): Promise<ContentSession> {
  if (closing) throw codedError("WORKSPACE_RUNTIME_CLOSED", "Workspace runtime is closing");
  contentSession ??= import("@univerjs/univer-workspace-client-core").then((content) => ({
    parseTarget: content.parseWorkspaceRuntimeTarget,
    runtime: content.createWorkspaceContentRuntime({
      resolveCredential: async (target) =>
        await readWorkspaceCookie({
          origin: target.origin,
          sessionPath: workspaceSessionPath(process.env),
        }),
      resolveLicense: () => resolveUniverLicense(process.env),
      workerEntry: new URL(/* @vite-ignore */ "./worker.js", import.meta.url),
    }),
  }));
  const session = await contentSession;
  if (closing) throw codedError("WORKSPACE_RUNTIME_CLOSED", "Workspace runtime is closing");
  return session;
}

const daemon = createDaemonServer({
  identity: workspaceDaemonIdentity(process.env),
  socketPath,
  onShutdown: async () => {
    closing = true;
    const session = await contentSession?.catch(() => undefined);
    if (session) await session.runtime.close();
  },
});

daemon.handle("runtime.execute-read", async (payload) => {
  const request = parseExecutionRequest(payload, "read");
  const { runtime, parseTarget } = await getContentSession();
  return (await runtime.executeRead({
    ...request,
    target: parseTarget(request.target),
  })) as unknown as JsonValue;
});

daemon.handle("runtime.export-unit-data", async (payload) => {
  const target = parseTargetRequest(payload, "export");
  const { runtime, parseTarget } = await getContentSession();
  return (await runtime.exportUnitData({ target: parseTarget(target) })) as unknown as JsonValue;
});

daemon.handle("runtime.execute-and-commit", async (payload) => {
  const request = parseExecutionRequest(payload, "write");
  const { runtime, parseTarget } = await getContentSession();
  return (await runtime.executeAndCommit({
    ...request,
    target: parseTarget(request.target),
  })) as unknown as JsonValue;
});

await daemon.listen();
process.once("SIGINT", () => void daemon.close());
process.once("SIGTERM", () => void daemon.close());

function parseExecutionRequest(
  payload: JsonValue,
  mode: "read" | "write",
): { readonly code: string; readonly target: JsonValue } {
  if (
    !isRecord(payload) ||
    typeof payload["code"] !== "string" ||
    payload["target"] === undefined
  ) {
    throw codedError("WORKSPACE_REQUEST_INVALID", `Workspace runtime ${mode} request is invalid`);
  }
  return { code: payload["code"], target: payload["target"] };
}

function parseTargetRequest(payload: JsonValue, operation: string): JsonValue {
  if (!isRecord(payload) || payload["target"] === undefined) {
    throw codedError(
      "WORKSPACE_REQUEST_INVALID",
      `Workspace runtime ${operation} request is invalid`,
    );
  }
  return payload["target"];
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
