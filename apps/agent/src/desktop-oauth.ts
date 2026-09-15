import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beginOAuth, exchangeOAuth, type PendingOAuth } from "./oauth-authorization.ts";

function reply(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Desktop-only endpoints retain DSH's public Host/Origin and cookie fence. */
function authorize(ctx: Context, req: IncomingMessage, res: ServerResponse, origin: string): boolean {
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return false; }
  const rejected = ctx.connection.requestRejection(req);
  if (rejected || req.headers.origin !== origin) {
    reply(res, rejected ?? 403, { error: "desktop_login_forbidden" }); return false;
  }
  return true;
}

export function createDesktopOAuthHandlers(ctx: Context, pending: Map<string, PendingOAuth>, publicOrigin: string) {
  return {
    start: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!authorize(ctx, req, res, publicOrigin)) return;
      try { reply(res, 200, beginOAuth(ctx, pending, publicOrigin, true)); }
      catch { reply(res, 429, { error: "too_many_pending_authorizations" }); }
    },
    complete: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!authorize(ctx, req, res, publicOrigin)) return;
      let value: { state?: unknown; code?: unknown };
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += Buffer.byteLength(chunk);
          if (size > 4096) { reply(res, 413, { error: "request_too_large" }); return; }
          chunks.push(Buffer.from(chunk));
        }
        value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object") throw new Error();
      } catch { reply(res, 400, { error: "invalid_callback" }); return; }
      if (typeof value.state !== "string" || typeof value.code !== "string" || !value.code || value.code.length > 2048) {
        reply(res, 400, { error: "invalid_callback" }); return;
      }
      const entry = pending.get(value.state);
      if (!entry?.desktop || entry.completing || entry.expiresAt <= Date.now() || entry.origin !== ctx.workspaceAuth.loginOrigin() ||
          entry.connectionVersion !== ctx.workspaceAuth.connectionVersion()) {
        reply(res, 400, { error: "workspace_authorization_expired" }); return;
      }
      // Mark before the network call; retaining the entry lets a newer start
      // invalidate an exchange that is still in flight.
      entry.completing = true;
      try {
        const result = await exchangeOAuth(ctx, entry, value.code, () => pending.get(entry.state) === entry);
        reply(res, 200, { connected: true, version: result.version });
      } catch { reply(res, 502, { error: "workspace_login_failed" }); }
      finally { pending.delete(entry.state); }
    },
  };
}
