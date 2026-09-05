/**
 * Workspace Device Authorization protocol used by the local Harness.
 *
 * This module knows only the remote Workspace exchange. It does not create a
 * local user, cookie, permission, or browser session.
 *
 * @module @univerjs/univer-workspace-harness/device-authorization
 */

import type { UwhIdentity } from "./contract.ts";

const WORKSPACE_DEVICE_START_PATH = "/api/auth/cli/authorizations";
const WORKSPACE_DEVICE_EXCHANGE_PATH = "/api/auth/cli/authorizations/exchange";

export interface DeviceAuthorizationStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly expiresAt: number;
  readonly intervalMs: number;
  readonly origin: string;
}

export type DeviceAuthorizationCompletion =
  | { readonly status: "pending" }
  | {
      readonly status: "authenticated";
      readonly identity: UwhIdentity;
      readonly sessionToken: string;
    };

export async function startDeviceAuthorization(
  workspaceOrigin: string,
  now: () => number = Date.now,
): Promise<DeviceAuthorizationStart> {
  const origin = canonicalOrigin(workspaceOrigin);
  const response = await fetch(new URL(WORKSPACE_DEVICE_START_PATH, origin), { method: "POST" });
  if (!response.ok) {
    throw new Error(`workspace device authorization answered ${response.status}`);
  }
  const raw: unknown = await response.json();
  if (raw === null || typeof raw !== "object") {
    throw new Error("workspace device authorization response is invalid");
  }
  const body = raw as Record<string, unknown>;
  const deviceCode = stringValue(body.deviceCode);
  const userCode = stringValue(body.userCode);
  const verificationUri =
    stringValue(body.verificationUriComplete) ?? stringValue(body.verificationUri);
  const expiresIn = typeof body.expiresIn === "number" ? body.expiresIn : 0;
  const interval = typeof body.interval === "number" ? body.interval : 5;
  if (
    deviceCode === undefined ||
    userCode === undefined ||
    verificationUri === undefined ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error("workspace device authorization response is invalid");
  }
  const verificationUrl = new URL(verificationUri, origin);
  if (
    verificationUrl.origin !== origin ||
    verificationUrl.username !== "" ||
    verificationUrl.password !== ""
  ) {
    throw new Error("workspace device verification URL is cross-origin");
  }
  return {
    deviceCode,
    userCode,
    verificationUrl: verificationUrl.href,
    expiresAt: now() + Math.floor(expiresIn * 1000),
    intervalMs: Math.max(1000, Math.floor(interval * 1000)),
    origin,
  };
}

export async function completeDeviceAuthorization(
  pending: DeviceAuthorizationStart,
  now: () => number = Date.now,
): Promise<DeviceAuthorizationCompletion> {
  if (now() >= pending.expiresAt) throw new Error("workspace device authorization expired");
  const response = await fetch(new URL(WORKSPACE_DEVICE_EXCHANGE_PATH, pending.origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceCode: pending.deviceCode }),
  });
  if (response.status === 202) return { status: "pending" };
  if (!response.ok) throw new Error(`workspace device exchange answered ${response.status}`);
  const raw: unknown = await response.json();
  if (raw === null || typeof raw !== "object") {
    throw new Error("workspace device exchange response is invalid");
  }
  const body = raw as Record<string, unknown>;
  const user =
    body.user !== null && typeof body.user === "object"
      ? (body.user as Record<string, unknown>)
      : body;
  const userId = firstString(user, "id", "userId", "sub");
  const username = firstString(user, "username", "name", "displayName");
  const cookiePair = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  const sessionToken = cookiePair.startsWith("workspace_session=")
    ? cookiePair.slice("workspace_session=".length)
    : "";
  if (userId === undefined || username === undefined || sessionToken === "") {
    throw new Error("workspace device exchange did not return an authenticated session");
  }
  const displayName = firstString(user, "displayName", "display_name");
  return {
    status: "authenticated",
    identity: {
      userId,
      username,
      ...(displayName === undefined ? {} : { displayName }),
    },
    sessionToken,
  };
}

function canonicalOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("workspace origin must use http or https");
  }
  return url.origin;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}

function firstString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}
