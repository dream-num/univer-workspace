/**
 * Structural seam between the capability plugin and the harness.
 *
 * The capability package is intentionally reusable and is loaded by the
 * harness as an out-of-tree DSH plugin.  It must not import the application
 * package (even for types): the harness owns the concrete services and this
 * package only consumes their small, stable public surface through Cordis.
 * Keep this file limited to plain contracts and pure helpers.
 * @module dsh-univer-workspace-plugin/provider/workspace-contract
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";

/** An authenticated Workspace HTTP client supplied by the harness. */
export interface WorkspaceHttpClient {
  readonly origin: string;
  readonly sessionToken: string;
  request(path: string, init?: RequestInit): Promise<Response>;
}

/** The authenticated-client service supplied by the harness. */
export interface WorkspaceAuthService {
  effectiveOrigin(): string;
  currentIdentity(): WorkspaceSessionIdentity | undefined;
  currentClient(): WorkspaceHttpClient | undefined;
  restartRequired(): boolean;
  pendingIdentity(): WorkspaceSessionIdentity | undefined;
}

/** The verified browser-session identity service supplied by the harness. */
export interface WorkspaceSessionIdentity {
  readonly userId: string;
  readonly username: string;
  readonly displayName?: string;
}

/** Derive the account-local mechanical DSH workspace directory. */
export function userDirectoryPath(workspaceRoot: string, userId: string): string {
  return resolve(workspaceRoot, createHash("sha256").update(userId, "utf8").digest("hex"));
}

export function originUserDirectoryPath(
  workspaceRoot: string,
  origin: string,
  userId: string,
): string {
  const originKey = createHash("sha256").update(new URL(origin).origin, "utf8").digest("hex");
  const userKey = createHash("sha256").update(userId, "utf8").digest("hex");
  return resolve(workspaceRoot, originKey, userKey);
}

/**
 * Derive the mechanical per-Space directory used by the harness.
 *
 * This is duplicated as a pure compatibility helper rather than imported
 * from `apps/harness`; keeping the hash contract here prevents a package →
 * application dependency while preserving stable workspace reconciliation.
 */
export function spaceDirectoryPath(workspaceRoot: string, userId: string, spaceId: string): string {
  const user = createHash("sha256").update(userId, "utf8").digest("hex");
  const space = createHash("sha256").update(spaceId, "utf8").digest("hex");
  return resolve(workspaceRoot, user, space);
}

export function originSpaceDirectoryPath(
  workspaceRoot: string,
  origin: string,
  userId: string,
  spaceId: string,
): string {
  return resolve(
    originUserDirectoryPath(workspaceRoot, origin, userId),
    createHash("sha256").update(spaceId, "utf8").digest("hex"),
  );
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    workspaceAuth: WorkspaceAuthService;
  }
}
