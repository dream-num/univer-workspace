/**
 * Durable connection state for the local Workspace Harness.
 *
 * The local Harness has one process-wide Workspace identity. This file is
 * deliberately stored outside the selected DSH runtime home so the launcher
 * can choose an origin-and-user-specific runtime before DSH starts. It is a
 * connection bootstrap record, not a local authorization database.
 *
 * @module @univerjs/univer-workspace-harness/connection-state
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { UwhIdentity } from "./contract.ts";

export const CONNECTION_STATE_VERSION = 1;

export interface WorkspaceConnection {
  readonly origin: string;
  readonly identity: UwhIdentity;
  readonly sessionToken: string;
}

export interface WorkspaceConnectionState {
  readonly version: typeof CONNECTION_STATE_VERSION;
  readonly configuredOrigin?: string;
  readonly active?: WorkspaceConnection;
}

const stateWrites = new Map<string, Promise<void>>();

export function canonicalWorkspaceOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Workspace origin must use http or https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("Workspace origin must not contain credentials");
  }
  return url.origin;
}

export function connectionIdentityKey(origin: string, userId: string): string {
  if (userId.trim() === "") throw new Error("Workspace user id is required");
  return createHash("sha256")
    .update(canonicalWorkspaceOrigin(origin), "utf8")
    .update("\0", "utf8")
    .update(userId, "utf8")
    .digest("hex");
}

export function runtimeHomeFor(
  dataHome: string,
  connection: WorkspaceConnection | undefined,
): string {
  const name =
    connection === undefined
      ? "bootstrap"
      : connectionIdentityKey(connection.origin, connection.identity.userId);
  return resolve(dataHome, "runtimes", name);
}

export async function readConnectionState(path: string): Promise<WorkspaceConnectionState> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: CONNECTION_STATE_VERSION };
    }
    throw error;
  }
  return parseConnectionState(JSON.parse(raw) as unknown);
}

export function readConnectionStateSync(path: string): WorkspaceConnectionState {
  try {
    return parseConnectionState(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: CONNECTION_STATE_VERSION };
    }
    throw error;
  }
}

export async function writeConnectionState(
  path: string,
  active: WorkspaceConnection | undefined,
): Promise<void> {
  await updateConnectionState(path, (current) => ({
    version: CONNECTION_STATE_VERSION,
    ...(current.configuredOrigin === undefined
      ? {}
      : { configuredOrigin: current.configuredOrigin }),
    ...(active === undefined ? {} : { active: normalizeConnection(active) }),
  }));
}

export async function writeConfiguredOrigin(path: string, origin: string): Promise<void> {
  const configuredOrigin = canonicalWorkspaceOrigin(origin);
  await updateConnectionState(path, (current) => ({
    version: CONNECTION_STATE_VERSION,
    configuredOrigin,
    ...(current.active === undefined ? {} : { active: current.active }),
  }));
}

async function updateConnectionState(
  path: string,
  update: (current: WorkspaceConnectionState) => WorkspaceConnectionState,
): Promise<void> {
  const target = resolve(path);
  const previous = stateWrites.get(target) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const state = update(await readConnectionState(target));
      await persistConnectionState(target, state);
    });
  stateWrites.set(target, current);
  try {
    await current;
  } finally {
    if (stateWrites.get(target) === current) stateWrites.delete(target);
  }
}

async function persistConnectionState(
  path: string,
  state: WorkspaceConnectionState,
): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

export function parseConnectionState(value: unknown): WorkspaceConnectionState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace connection state must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== CONNECTION_STATE_VERSION) {
    throw new Error(`Unsupported Workspace connection state version: ${String(record.version)}`);
  }
  const configuredOrigin =
    record.configuredOrigin === undefined
      ? undefined
      : canonicalWorkspaceOrigin(
          requiredString(record.configuredOrigin, "Workspace configured origin"),
        );
  if (record.active === undefined) {
    return {
      version: CONNECTION_STATE_VERSION,
      ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
    };
  }
  if (record.active === null || typeof record.active !== "object" || Array.isArray(record.active)) {
    throw new Error("Workspace connection state active entry is invalid");
  }
  return {
    version: CONNECTION_STATE_VERSION,
    ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
    active: normalizeConnection(record.active as Record<string, unknown>),
  };
}

function normalizeConnection(value: {
  readonly origin?: unknown;
  readonly identity?: unknown;
  readonly sessionToken?: unknown;
}): WorkspaceConnection {
  const identity = value.identity;
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error("Workspace connection identity is invalid");
  }
  const identityRecord = identity as Record<string, unknown>;
  const userId = requiredString(identityRecord.userId, "Workspace user id");
  const username = requiredString(identityRecord.username, "Workspace username");
  const displayName = optionalString(identityRecord.displayName, "Workspace display name");
  const sessionToken = requiredString(value.sessionToken, "Workspace session token");
  return {
    origin: canonicalWorkspaceOrigin(requiredString(value.origin, "Workspace origin")),
    identity: {
      userId,
      username,
      ...(displayName === undefined ? {} : { displayName }),
    },
    sessionToken,
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is invalid`);
  return value.trim();
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
