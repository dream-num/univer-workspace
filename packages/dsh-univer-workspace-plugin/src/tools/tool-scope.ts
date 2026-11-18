/**
 * Shared authorization scope for every Workspace tool.
 *
 * A DSH session uses either a linked Space directory or the account directory.
 * Linked Spaces remain the default target; account sessions default to the
 * authenticated account's personal Space, while the Workspace OAuth identity remains authoritative
 * for any explicitly selected Space.  The session link is routing context, not
 * an ACL boundary. Writes are narrower than ACL: a conversation changes only
 * the Worktrees it created, so two conversations never share one Worktree.
 *
 * @module dsh-univer-workspace-plugin/tools/tool-scope
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { SpaceScope } from "../service/univer-workspace-service.ts";
import { toolWorkspaceCwd } from "./workspace-path.ts";
import { UniverError } from "./errors.ts";

/** The resolved scope carried by one tool invocation. */
export interface ToolSpaceScope extends SpaceScope {
  /** The DSH session workspace that established the scope. */
  readonly cwd: string;
}

/**
 * Resolve the authenticated default Space for the calling DSH session.
 *
 * Failing closed here is important: tools can be invoked by background or
 * synthetic executions that do not carry a session cwd.  Such executions do
 * not identify a supported Workspace directory and must not receive a client.
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

/** `ownEvents` omits fork-inherited events, so a forked or template conversation owns none of its parent's Worktrees. */
export function conversationWorktreeIds(exec: ToolRunContext): ReadonlySet<string> {
  const creates = new Set<string>();
  const ids = new Set<string>();
  for (const event of exec.agent?.session.ownEvents() ?? []) {
    if (event.type === "tool/call") {
      if (event.data.name === "univer_worktree" && createAction(parseJson(event.data.arguments)))
        creates.add(event.data.callId);
    } else if (event.type === "tool/result") {
      const [block] = event.data.message.content;
      if (creates.has(block.toolCallId) && block.isError !== true) addCreatedId(ids, block.content);
    } else if (event.type === "tool/ptc-dispatch") {
      if (event.data.name === "univer_worktree" && createAction(event.data.arguments) && !event.data.isError)
        addCreatedId(ids, event.data.content);
    }
  }
  return ids;
}

export function assertWorktreeWritable(exec: ToolRunContext, worktreeId: string): void {
  if (conversationWorktreeIds(exec).has(worktreeId)) return;
  throw new UniverError(
    "This Worktree was not created in this conversation, so this conversation can read it but not change it. Create a new Worktree for this task with univer_worktree action create.",
    "WORKTREE_NOT_IN_CONVERSATION",
  );
}

function createAction(args: unknown): boolean {
  return typeof args === "object" && args !== null && (args as { action?: unknown }).action === "create";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function addCreatedId(ids: Set<string>, content: readonly ContentBlock[]): void {
  const text = content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  const value = parseJson(text.slice(Math.max(0, text.indexOf("{"))));
  const id = typeof value === "object" && value !== null ? (value as { id?: unknown }).id : undefined;
  if (typeof id === "string" && id !== "") ids.add(id);
}
