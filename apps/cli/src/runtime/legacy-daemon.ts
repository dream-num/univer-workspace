import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type { DaemonStatus, JsonValue } from "@univer-cli/daemon";

const LEGACY_DAEMON_DISTRIBUTION_ID = "univer-workspace-cli";
const REQUEST_TIMEOUT_MS = 1_000;
const STOP_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export async function stopLegacyWorkspaceDaemonIfPresent(input: {
  readonly currentStatus: DaemonStatus;
  readonly socketPath: string;
}): Promise<boolean> {
  if (
    input.currentStatus.state === "running" ||
    input.currentStatus.state === "stopped" ||
    (input.currentStatus.state === "incompatible" && input.currentStatus.actual !== undefined)
  ) {
    return false;
  }

  let health: JsonValue;
  try {
    health = await requestLegacyDaemon(input.socketPath, "daemon.health");
  } catch {
    return false;
  }
  if (!isLegacyWorkspaceDaemonHealth(health, input.socketPath)) return false;

  const result = await requestLegacyDaemon(input.socketPath, "daemon.shutdown");
  if (!isRecord(result) || result["stopping"] !== true) {
    throw codedError(
      "LEGACY_DAEMON_INVALID_SHUTDOWN",
      "Legacy Workspace daemon returned an invalid shutdown response",
    );
  }
  await waitUntilUnavailable(input.socketPath);
  return true;
}

function requestLegacyDaemon(socketPath: string, method: string): Promise<JsonValue> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = createConnection(socketPath);
    let settled = false;
    let source = "";
    const timeout = setTimeout(
      () => settleError(codedError("LEGACY_DAEMON_TIMEOUT", `Legacy daemon ${method} timed out`)),
      REQUEST_TIMEOUT_MS,
    );

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.removeAllListeners();
    };
    const settleError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const settleResult = (result: JsonValue): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      resolve(result);
    };

    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id, jsonrpc: "2.0", method })}\n`);
    });
    socket.on("data", (chunk) => {
      source += chunk.toString("utf8");
      if (Buffer.byteLength(source) > MAX_RESPONSE_BYTES) {
        settleError(
          codedError("LEGACY_DAEMON_RESPONSE_TOO_LARGE", "Legacy daemon response is too large"),
        );
        return;
      }
      const newline = source.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(source.slice(0, newline)) as unknown;
        if (
          !isRecord(response) ||
          response["jsonrpc"] !== "2.0" ||
          response["id"] !== id ||
          !("result" in response)
        ) {
          throw new Error("invalid legacy daemon response");
        }
        settleResult(response["result"] as JsonValue);
      } catch (error) {
        settleError(error);
      }
    });
    socket.once("error", settleError);
    socket.once("close", () => {
      if (!settled) settleError(new Error("Legacy daemon connection closed before responding"));
    });
  });
}

function isLegacyWorkspaceDaemonHealth(value: JsonValue, socketPath: string): boolean {
  return (
    isRecord(value) &&
    value["ok"] === true &&
    value["distributionId"] === LEGACY_DAEMON_DISTRIBUTION_ID &&
    value["socketPath"] === socketPath &&
    typeof value["pid"] === "number" &&
    Number.isSafeInteger(value["pid"]) &&
    value["pid"] > 0
  );
}

async function waitUntilUnavailable(socketPath: string): Promise<void> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await canConnect(socketPath))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw codedError(
    "LEGACY_DAEMON_STOP_TIMEOUT",
    "Legacy Workspace daemon did not stop before timeout",
  );
}

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const timeout = setTimeout(() => finish(false), REQUEST_TIMEOUT_MS);
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
