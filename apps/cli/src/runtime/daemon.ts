#!/usr/bin/env node
import { createDaemonServer, DAEMON_SOCKET_ENV, type JsonValue } from "@univer-cli/daemon";
import {
  createWorkspaceContentRuntime,
  parseWorkspaceRuntimeTarget,
  type WorkspaceRuntimeTarget,
} from "@univerjs/univer-workspace-client-core";
import { resolveUniverLicense, workspaceSessionPath } from "../config.js";
import { readWorkspaceCookie } from "../features/auth/session.js";
import { workspaceDaemonIdentity } from "./daemon-identity.js";

const socketPath = process.env[DAEMON_SOCKET_ENV];
if (!socketPath) throw new Error(`${DAEMON_SOCKET_ENV} is required`);

const runtime = createWorkspaceContentRuntime({
  resolveCredential: async (target) =>
    await readWorkspaceCookie({
      origin: target.origin,
      sessionPath: workspaceSessionPath(process.env),
    }),
  resolveLicense: () => resolveUniverLicense(process.env),
  workerEntry: new URL(/* @vite-ignore */ "./worker.js", import.meta.url),
});
const daemon = createDaemonServer({
  identity: workspaceDaemonIdentity(process.env),
  socketPath,
  onShutdown: async () => {
    await runtime.close();
  },
});

daemon.handle("runtime.execute-read", async (payload) => {
  const request = parseExecutionRequest(payload, "read");
  return (await runtime.executeRead(request)) as unknown as JsonValue;
});

daemon.handle("runtime.export-unit-data", async (payload) => {
  const target = parseTargetRequest(payload, "export");
  return (await runtime.exportUnitData({ target })) as unknown as JsonValue;
});

daemon.handle("runtime.execute-and-commit", async (payload) => {
  const request = parseExecutionRequest(payload, "write");
  return (await runtime.executeAndCommit(request)) as unknown as JsonValue;
});

await daemon.listen();
process.once("SIGINT", () => void daemon.close());
process.once("SIGTERM", () => void daemon.close());

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
