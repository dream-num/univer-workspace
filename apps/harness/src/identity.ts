/**
 * Pure host-side helpers for the generic account-scope boundary.
 *
 * These functions are deliberately free of cordis dependencies (only
 * `node:crypto` and `node:path` for safe child-path derivation), so they are
 * unit-testable and reused by both the route handler and the focused host test.
 *
 * Ownership boundary: the generic Harness host derives and validates the
 * account-local directory from the verified Workspace user id. Capability
 * plugins may use this boundary to resolve their own Workspace records.
 * @module @univerjs/univer-workspace-harness/identity
 */

import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";

/** Full SHA-256 hex digest length (64 hex chars) — the workspace child name scheme. */
export const SHA_256_HEX_LENGTH = 64;

/**
 * Derive the canonical per-user workspace directory name for an opaque user id.
 * The name is a pure function of the user id, so the directory path is stable
 * across Pod replacement and is never influenced by client input.
 */
export function workspacePathName(userId: string): string {
  return createHash("sha256").update(userId, "utf8").digest("hex");
}

/**
 * Whether a candidate path is one DIRECT SHA-256-named child of a root.
 */
export function isDirectSha256Child(workspaceRoot: string, candidate: string): boolean {
  const root = resolve(workspaceRoot);
  const normalized = resolve(candidate);
  if (dirname(normalized) !== root) return false;
  return new RegExp(`^[0-9a-f]{${SHA_256_HEX_LENGTH}}$`).test(basename(normalized));
}

/**
 * Derive and validate the per-user directory path for a verified user id.
 * The path is `<workspaceRoot>/<sha256(userId)>` and is a direct child of the
 * configured root.
 */
export function workspacePathFor(
  workspaceRoot: string,
  userId: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (userId === "") return { ok: false, reason: "missing user id" };
  const path = resolve(workspaceRoot, workspacePathName(userId));
  if (!isDirectSha256Child(workspaceRoot, path)) {
    return { ok: false, reason: "derived workspace path is not a direct SHA-256-named child of the configured workspace root" };
  }
  return { ok: true, path };
}

/**
 * Derive the canonical per-Space directory name for an opaque Space id. Like
 * the user directory name, it is a pure function of the id so it is stable and
 * never influenced by client input, and the SHA-256 hex digest cannot escape
 * its parent directory.
 */
export function spaceDirectoryName(spaceId: string): string {
  return createHash("sha256").update(spaceId, "utf8").digest("hex");
}

/**
 * Derive the per-user, per-Space directory under the workspace root. The user
 * owns every direct child of their user directory; each child carries one
 * Univer Workspace Space.
 */
export function spaceDirectoryPath(workspaceRoot: string, userId: string, spaceId: string): string {
  return resolve(workspaceRoot, workspacePathName(userId), spaceDirectoryName(spaceId));
}

/**
 * Whether a candidate path belongs to one user's scope: the user directory
 * itself, or one direct child of it (a per-Space mechanical directory).
 */
export function isUserScopedPath(workspaceRoot: string, userId: string, candidate: string): boolean {
  const userDir = resolve(workspaceRoot, workspacePathName(userId));
  const normalized = resolve(candidate);
  return normalized === userDir || dirname(normalized) === userDir;
}
