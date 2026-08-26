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

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Resolve the authenticated Workspace user for a request, or answer 401. */
function authenticatedUser(ctx: Context, req: IncomingMessage): string | null {
  const identity = ctx.workspaceSession.currentUser(req.headers.cookie);
  if (identity === undefined) return null;
  return identity.userId;
}

/** Build the prefix route handler. */
function createHandler(ctx: Context): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://x");
    const subPath = url.pathname.slice(PREFIX.length);
    if (req.method === "GET" && subPath === "/spaces") {
      const userId = authenticatedUser(ctx, req);
      if (userId === null) {
        jsonResponse(res, 401, { error: "missing_or_invalid_session" });
        return;
      }
      try {
        const result = await ctx.univerWorkspace.listSpaces(userId);
        jsonResponse(res, 200, { spaces: result.spaces });
      } catch (error) {
        jsonResponse(res, 502, { error: error instanceof Error ? error.message : "workspace unreachable" });
      }
      return;
    }
    jsonResponse(res, 404, { error: "not_found" });
  };
}

export const name = "univer-workspace-web";

export const inject = ["webServer", "workspaceSession", "univerWorkspace"];

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: PREFIX,
    handler: createHandler(ctx),
  }), "univer-workspace: browser api routes");
}
