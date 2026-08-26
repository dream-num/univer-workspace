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
import type {} from "@univerjs/univer-workspace-harness";

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
  const identity = ctx.workspaceSession.currentUser(req.headers.cookie);
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
        const result = await ctx.univerWorkspace.listSpaces(user.userId);
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
    jsonResponse(res, 404, { error: "not_found" });
  };
}

export const name = "univer-workspace-web";

export const inject = ["webServer", "workspaceSession", "univerWorkspace"];

export function apply(ctx: Context, config: WebServerConfig): void {
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: PREFIX,
    handler: createHandler(ctx, config),
  }), "univer-workspace: browser api routes");
}
