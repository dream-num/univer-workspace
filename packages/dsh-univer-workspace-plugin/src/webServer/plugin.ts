/**
 * The capability plugin's browser-facing API routes.
 *
 * Registered on the DSH web server (no separate gateway): JSON state for the
 * current User's Spaces, guarded by the harness session cookie through the
 * workspaceSession service. The prefix route dispatches on the sub-path.
 * @module dsh-univer-workspace-plugin/webServer
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "../provider/workspace-contract.ts";

const PREFIX = "/univer-workspace/api";

export interface WebServerConfig {
  /** The resolved Univer runtime license, shared with the browser viewer. */
  license: string;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Resolve the authenticated Workspace user for a request, or answer 401. */
function authenticatedUser(ctx: Context, req: IncomingMessage): { userId: string; displayName: string; avatarUrl: string | null } | null {
  const identity = ctx.get("workspaceSession")!.currentUser(req.headers.cookie);
  if (identity === undefined) return null;
  return {
    userId: identity.userId,
    displayName: identity.displayName ?? identity.username,
    avatarUrl: null,
  };
}

/** Build the prefix route handler. */
function createHandler(ctx: Context, config: WebServerConfig): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://x");
    const subPath = url.pathname.slice(PREFIX.length);
    if (req.method === "GET" && subPath === "/spaces") {
      const user = authenticatedUser(ctx, req);
      if (user === null) {
        jsonResponse(res, 401, { error: "missing_or_invalid_session" });
        return;
      }
      try {
        const result = await ctx.get("univerWorkspace")!.listSpaces(user.userId);
        jsonResponse(res, 200, { spaces: result.spaces });
      } catch (error) {
        jsonResponse(res, 502, { error: error instanceof Error ? error.message : "workspace unreachable" });
      }
      return;
    }
    if (req.method === "GET" && subPath === "/viewer-bootstrap") {
      const user = authenticatedUser(ctx, req);
      if (user === null) {
        jsonResponse(res, 401, { error: "missing_or_invalid_session" });
        return;
      }
      jsonResponse(res, 200, {
        user: { id: user.userId, displayName: user.displayName, avatarUrl: user.avatarUrl },
        license: config.license,
      });
      return;
    }
    if (req.method === "GET" && subPath === "/file-state") {
      const user = authenticatedUser(ctx, req);
      if (user === null) {
        jsonResponse(res, 401, { error: "missing_or_invalid_session" });
        return;
      }
      const resourceId = url.searchParams.get("resourceId");
      const worktreeId = url.searchParams.get("worktreeId");
      if ((resourceId === null || resourceId === "") && (worktreeId === null || worktreeId === "")) {
        jsonResponse(res, 400, { error: "resourceId_or_worktreeId_required" });
        return;
      }
      try {
        const state = worktreeId !== null && worktreeId !== ""
          ? await ctx.get("univerWorkspace")!.getWorktreeFileState(user.userId, worktreeId)
          : await ctx.get("univerWorkspace")!.getFileState(user.userId, resourceId!);
        jsonResponse(res, 200, state);
      } catch (error) {
        const message = error instanceof Error ? error.message : "workspace unreachable";
        const apiStatus = error !== null && typeof error === "object" && "status" in error
          && typeof error.status === "number" ? error.status : undefined;
        const status = apiStatus === 404 || message.includes("404") || message.includes("Not Found") ? 404 : 502;
        jsonResponse(res, status, { error: message });
      }
      return;
    }
    const actionMatch = /^\/worktrees\/([A-Za-z0-9-]+)\/(ready|reopen|merge|discard)$/.exec(subPath);
    if (req.method === "POST" && actionMatch !== null) {
      const user = authenticatedUser(ctx, req);
      if (user === null) {
        jsonResponse(res, 401, { error: "missing_or_invalid_session" });
        return;
      }
      try {
        const summary = await ctx.get("univerWorkspace")!.transitionWorktree(user.userId, actionMatch[1]!, actionMatch[2] as "ready" | "reopen" | "merge" | "discard");
        jsonResponse(res, 200, { worktree: summary });
      } catch (error) {
        jsonResponse(res, 502, { error: error instanceof Error ? error.message : "workspace unreachable" });
      }
      return;
    }
    jsonResponse(res, 404, { error: "not_found" });
  };
}

export const name = "univer-workspace-web";

// workspaceSession/univerWorkspace resolve lazily per request via ctx.get.
export const inject = ["webServer", "univerWorkspace"];

export function apply(ctx: Context, config: WebServerConfig): void {
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: PREFIX,
    handler: createHandler(ctx, config),
  }), "univer-workspace: browser api routes");
}
