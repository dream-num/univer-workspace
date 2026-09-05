/**
 * Shared authorization scope for every Workspace tool.
 *
 * A DSH session is mechanically backed by one Space directory.  That Space is
 * the default target, while the Workspace OAuth identity remains authoritative
 * for any explicitly selected Space.  The session link is routing context, not
 * an ACL boundary.
 *
 * @module dsh-univer-workspace-plugin/tools/tool-scope
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { SpaceScope } from "../service/univer-workspace-service.ts";
import { toolWorkspaceCwd } from "./workspace-path.ts";
import { UniverError } from "./errors.ts";

/** The resolved scope carried by one tool invocation. */
export interface ToolSpaceScope extends SpaceScope {
  /** The DSH session workspace that established the scope. */
  readonly cwd: string;
}

/**
 * Resolve the authenticated Space represented by the calling DSH session.
 *
 * Failing closed here is important: tools can be invoked by background or
 * synthetic executions that do not carry a session cwd.  Such executions do
 * not have a product Space boundary and must not receive a user-wide client.
 */
export async function resolveToolScope(
  ctx: Context,
  exec: ToolRunContext,
): Promise<ToolSpaceScope> {
  const cwd = toolWorkspaceCwd(exec);
  const service = ctx.get("univerWorkspace");
  if (service === undefined) {
    throw new UniverError(
      "The Univer Workspace service is unavailable.",
      "WORKSPACE_SERVICE_UNAVAILABLE",
    );
  }
  const resolved = await service.resolveSpaceForSession(cwd);
  if (resolved === undefined) {
    throw new UniverError(
      "The current DSH workspace is not linked to a Univer Workspace Space; select a Workspace entry before using Univer tools.",
      "SESSION_SCOPE_UNAVAILABLE",
    );
  }
  return { ...resolved, cwd };
}

/**
 * Resolve an optional target Space.  The linked Space is only the default;
 * requests for another Space go through the same authenticated Workspace
 * client, whose server-side ACL is the authority for access.
 */
export function resolveTargetSpace(scope: ToolSpaceScope, requested?: string): string {
  if (requested === undefined) return scope.spaceId;
  const value = requested.trim();
  if (value === "") throw new UniverError("Space id must be non-empty.", "INVALID_REQUEST");
  return value;
}

/**
 * Resolve a Worktree through the authenticated Workspace client.  The public
 * Worktree summary does not need to repeat a session Space link: Workspace
 * ACLs authorize the Worktree and its Units for the current User.
 */
export async function assertWorktreeAccessible(
  ctx: Context,
  scope: ToolSpaceScope,
  worktreeId: string,
): Promise<void> {
  const service = ctx.get("univerWorkspace");
  if (service === undefined) {
    throw new UniverError(
      "The Univer Workspace service is unavailable.",
      "WORKSPACE_SERVICE_UNAVAILABLE",
    );
  }
  // The authenticated Workspace endpoint validates ownership and ACL.  Do not
  // compare the Worktree's Space with the session default: users can operate
  // on any Space they are authorized to access.
  await service.getWorktreeFileState(scope.userId, worktreeId);
}
