/**
 * The collaboration proxy: registers browser-facing Workspace API routes on
 * the DSH web server and forwards them to the Workspace origin with the
 * authorizing User's session cookie.
 *
 * This is the "no separate gateway" landing point. The floating viewer (a
 * client-side Univer collaboration component implemented by this plugin) talks
 * to the DSH origin; this proxy carries each request — HTTP and the
 * collaboration WebSocket — to the Workspace origin with the per-User
 * credential.
 *
 * The DSH webserver only supports exact-path WebSocket upgrade registration,
 * while the Workspace worktree WebSocket path is dynamic
 * (`/universer-api/worktrees/{id}/comb/connect`). The viewer therefore points
 * its WebSocket at one fixed DSH path and passes the Workspace path in a query
 * parameter; the proxy rewrites the target from that parameter. The
 * snapshot/changeset/file/exchange HTTP surface is forwarded verbatim over one
 * DSH prefix.
 * @module dsh-univer-workspace-plugin/collab-proxy
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@univerjs/univer-workspace-harness";

/** The DSH-origin prefix the browser viewer calls for HTTP forwarding. */
const HTTP_PREFIX = "/univer-workspace/collab";

/** The fixed DSH WebSocket path the viewer connects to. */
const WS_PATH = `${HTTP_PREFIX}/connect`;

/** The Workspace API surface forwarded over HTTP; everything else is refused. */
const FORWARD_PREFIXES = [
  "/universer-api/snapshot",
  "/universer-api/comb",
  "/universer-api/user/session-ticket",
  "/universer-api/worktrees",
  "/universer-api/file",
  "/universer-api/exchange",
  "/universer-api/stream",
  "/universer-api/authz",
] as const;

function canForwardHttp(path: string): boolean {
  return FORWARD_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/** The query parameter carrying the Workspace WS path for an upgrade. */
const WS_TARGET_PARAM = "target";

/** Resolve the authenticated User's workspace origin + session token, or undefined. */
function resolveUpstream(ctx: Context, req: IncomingMessage): { origin: string; token: string } | undefined {
  const identity = ctx.get("workspaceSession")!.currentUser(req.headers.cookie);
  if (identity === undefined) return undefined;
  const client = ctx.get("workspaceAuth")!.clientFor(identity.userId);
  if (client === undefined) return undefined;
  return { origin: client.origin, token: client.sessionToken };
}

function stripPrefix(requestPath: string): string {
  return requestPath.slice(HTTP_PREFIX.length) || "/";
}

/** Build the HTTP forwarding handler. */
function createHttpHandler(ctx: Context): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const workspacePath = stripPrefix(path);
    if (!canForwardHttp(workspacePath)) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not_forwarded" }));
      return;
    }
    const upstream = resolveUpstream(ctx, req);
    if (upstream === undefined) {
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "missing_or_invalid_session" }));
      return;
    }
    const target = new URL(workspacePath + url.search, upstream.origin);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (name === "host" || name === "cookie" || name === "connection" || name === "upgrade" || name === "content-length") continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("cookie", `workspace_session=${upstream.token}`);
    headers.set("x-univer-cli-sdk-role", "worker");

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);

    const upstreamResponse = await fetch(target, {
      method: req.method ?? "GET",
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "manual",
    });

    const responseHeaders: Record<string, string> = {
      "content-type": upstreamResponse.headers.get("content-type") ?? "application/octet-stream",
    };
    const contentLength = upstreamResponse.headers.get("content-length");
    if (contentLength !== null) responseHeaders["content-length"] = contentLength;
    res.writeHead(upstreamResponse.status, responseHeaders);
    res.end(new Uint8Array(await upstreamResponse.arrayBuffer()));
  };
}

/** Build the WebSocket upgrade handler that bridges to the Workspace origin. */
function createUpgradeHandler(ctx: Context): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head): void => {
    const url = new URL(req.url ?? "/", "http://x");
    const targetParam = url.searchParams.get(WS_TARGET_PARAM);
    if (targetParam === null || !targetParam.startsWith("/universer-api/")) {
      socket.destroy();
      return;
    }
    const upstream = resolveUpstream(ctx, req);
    if (upstream === undefined) {
      socket.destroy();
      return;
    }
    const wss = new WebSocketServer({ noServer: true });
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
    });
    wss.on("connection", (client: WebSocket) => {
      const target = new URL(targetParam, upstream.origin);
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      const upstreamWs = new WebSocket(target, {
        headers: { cookie: `workspace_session=${upstream.token}` },
      });
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        try { client.close(); } catch { /* noop */ }
        try { upstreamWs.close(); } catch { /* noop */ }
      };
      upstreamWs.on("open", () => {
        client.on("message", (data) => upstreamWs.send(data as Buffer));
        client.on("close", close);
        client.on("error", close);
      });
      upstreamWs.on("message", (data) => client.send(data as Buffer));
      upstreamWs.on("close", close);
      upstreamWs.on("error", close);
    });
  };
}

export const name = "univer-workspace-collab-proxy";

export const inject = ["webServer", "workspaceSession", "workspaceAuth"];

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposeHttp = ctx.webServer.register({
      kind: "prefix",
      path: HTTP_PREFIX,
      handler: createHttpHandler(ctx),
    });
    const disposeUpgrade = ctx.webServer.registerUpgrade({
      path: WS_PATH,
      handler: createUpgradeHandler(ctx),
    });
    return () => {
      disposeUpgrade();
      disposeHttp();
    };
  }, "univer-workspace: collaboration proxy");
}
