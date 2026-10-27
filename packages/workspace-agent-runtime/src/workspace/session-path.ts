/**
 * Canonical session-workspace path authorization shared by file-based tools.
 *
 * Lexical `startsWith` checks are insufficient because a file below the
 * session directory can be a symlink to another user's path. Existing paths
 * are resolved with `realpath`; new outputs canonicalize their nearest
 * existing ancestor before the containment decision.
 * @module dsh-univer-workspace-plugin/tools/workspace-path
 */

import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
export class SessionPathError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) { super(message, options); }
}

export interface AuthorizedSessionPath {
  readonly workspace: string;
  readonly path: string;
}

/** Resolve an input or output below the native Session workspace. */
export async function authorizedSessionPath(cwd: string | undefined, value: string, mustExist: boolean): Promise<AuthorizedSessionPath> {
  if (cwd === undefined || cwd.trim() === "") throw new SessionPathError("Univer tools require a calling agent with a workspace.", "SESSION_SCOPE_UNAVAILABLE");
  return authorizedPath(cwd, value, mustExist);
}

async function authorizedPath(
  cwd: string,
  value: string,
  mustExist: boolean,
): Promise<AuthorizedSessionPath> {
  if (value.trim() === "")
    throw new SessionPathError("Session workspace path is required.", "INVALID_FILE_PATH");
  let workspace: string;
  try {
    workspace = await realpath(cwd);
  } catch (error) {
    throw new SessionPathError(
      "The session workspace cannot be resolved.",
      "SESSION_SCOPE_UNAVAILABLE",
      { cause: error },
    );
  }
  const candidate = isAbsolute(value) ? resolve(value) : resolve(workspace, value);
  let canonical: string;
  try {
    canonical = mustExist ? await realpath(candidate) : await canonicalizePotentialPath(candidate);
  } catch (error) {
    throw new SessionPathError(
      mustExist
        ? "The session workspace input does not exist or cannot be resolved."
        : "The session workspace output cannot be resolved.",
      "INVALID_FILE_PATH",
      { cause: error },
    );
  }
  const fromWorkspace = relative(workspace, canonical);
  if (fromWorkspace === ".." || fromWorkspace.startsWith(`..${sep}`) || isAbsolute(fromWorkspace)) {
    throw new SessionPathError("Path must stay inside the session workspace.", "SESSION_SCOPE_DENIED");
  }
  return { workspace, path: canonical };
}

async function canonicalizePotentialPath(candidate: string): Promise<string> {
  let ancestor = candidate;
  for (;;) {
    try {
      const canonicalAncestor = await realpath(ancestor);
      return resolve(canonicalAncestor, relative(ancestor, candidate));
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}
