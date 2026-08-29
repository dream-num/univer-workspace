/**
 * Authenticated carrier for the stock DSH browser connection.
 *
 * DSH deliberately keeps its transport-agnostic ApiProxy and its WebSocket
 * downlinks separate.  The stock connection plugin only has a Host trust
 * fence, which is sufficient for a single-user CLI but not for this
 * multi-account service.  This adapter keeps the public DSH wire envelope and
 * the collaboration transport opaque, while adding the harness cookie and a
 * projection at the two process-global event streams.
 *
 * The collaboration WebSocket (`/univer-workspace/collab/connect`) is owned by
 * the capability plugin and remains a byte-for-byte proxy; this file only
 * handles DSH's browser event downlinks (`/api/events.*`).
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import type { Context } from "@deepseek-ai/cordis";
import { RpcId, toFetchHandler } from "@deepseek-ai/dsh-host-apiproxy";
import type {
  ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest,
} from "@deepseek-ai/dsh-host-apiproxy/api";
// Import the package for its public Context augmentation.  The host-side
// `connection` service is provided by DSH's stock client-connection row; this
// adapter only consumes its documented shared-handler seam and never reaches
// into DSH internals.
import type {} from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { parseCookies, parseSessionCookie } from "./auth.ts";
import {
  buildScope, ownSession, ownWorkspace, pathInUserRoot, SCOPED_RPC_PATHS, trustedRequest, type Scope,
} from "./scoped-api.ts";
import type { ScopedApiConfig } from "./scoped-api.ts";

/** HTTP body cap shared with the stock Connection carrier (300 MiB default). */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024;
const MUX_EVENTS_PATH = "/api/events.mux";
const HOST_EVENTS_PATH = "/api/events.host";
const API_PATH = "/api";
const RESPOND_PATH = "/api/respond";
const SESSION_EXPORT_PATH = "/api/session.export";
// These endpoints are provided by DSH's optional Cordis runner.  They are
// still process-global host routes, so the authenticated carrier must allow
// them through to the stock ApiProxy instead of treating them as unknown.
// Omitting them makes the stock client emit a 404 on every inventory/manifest
// refresh even though the runner plugin is installed in the profile.
const DYNAMIC_CORDIS_PATHS = new Set([
  "/api/dynamicCordisRunner/inventory",
  "/api/dynamicCordisRunner/syncInspectManifest",
]);
/** Typert endpoints intentionally exposed by the authenticated carrier.
 *
 * The browser's command palette calls these through the public Typert
 * gateway, not through the legacy `ApiProxy` method map.  Keep the allowlist
 * narrow: optional remotes (notably dynamicCordis) are not part of this
 * service's contract and must remain unavailable.
 */
const TYPERT_COMMAND_ENDPOINTS: ReadonlySet<string> = new Set([
  "commands/list",
  "commands/execute",
]);
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_RESPONSES = 4096;

export interface ScopedConnectionConfig extends ScopedApiConfig {
  readonly maxRequestBodyBytes?: number;
}

type DownlinkFrame = MuxFrame | HostFrame;
type DownlinkRequest = RpcRequest<DownlinkFrame>;

/** Minimal public Fetch-handler shape exposed by DSH's connection service. */
interface FetchHandler {
  fetch(request: Request): Promise<Response>;
}

/** The public host service method used to compose the Typert gateway. */
interface SharedConnection {
  createSharedFetchHandler(channel: "/api", fallback: FetchHandler): FetchHandler;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function rejectUpgrade(socket: Duplex): void {
  socket.end([
    "HTTP/1.1 403 Forbidden",
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Length: 9",
    "",
    "forbidden",
  ].join("\r\n"));
}

function requestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name === "host" || name === "connection"
      || name === "content-length" || name === "transfer-encoding") continue;
    headers.set(name, Array.isArray(value) ? value.join(",") : value);
  }
  return headers;
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declaredLength = header(req, "content-length");
  if (declaredLength !== undefined && Number(declaredLength) > maxBytes) {
    throw new Error("request_body_too_large");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.byteLength;
    if (received > maxBytes) throw new Error("request_body_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sessionId(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function workspaceId(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Return the relative Typert endpoint for a request path, or `undefined` when
 * the path is not one of the command remotes owned by this carrier.  Keeping
 * this as a pure seam makes the route policy auditable without loading DSH.
 */
export function typertCommandEndpoint(pathname: string): "commands/list" | "commands/execute" | undefined {
  if (!pathname.startsWith(`${API_PATH}/`)) return undefined;
  const endpoint = pathname.slice(`${API_PATH}/`.length);
  return TYPERT_COMMAND_ENDPOINTS.has(endpoint)
    ? endpoint as "commands/list" | "commands/execute"
    : undefined;
}

/**
 * Extract the account-bearing selector from the public Typert client envelope.
 * Typert's gateway receives `{ args: { agentId, ... } }` as the request
 * payload.  Missing or malformed fields deliberately return `undefined` so
 * the gateway remains the source of canonical `bad-request` responses.
 */
export function typertCommandAgentId(body: unknown): string | undefined {
  const message = object(body);
  if (message?.type !== "client-request") return undefined;
  const payload = object(message.payload);
  const args = object(payload?.args);
  return sessionId(args?.agentId);
}

/** Admit a newly-created account-local session without trusting its id alone. */
function allowSession(scope: Scope, idValue: unknown, cwdValue?: unknown): boolean {
  const id = sessionId(idValue);
  if (id === undefined) return false;
  if (ownSession(scope, id)) return true;
  if (typeof cwdValue !== "string" || !pathInUserRoot(scope.sessionRootPath, cwdValue)) return false;
  (scope.sessionIds as Set<string>).add(id);
  return true;
}

/** Admit a newly-created account-local Workspace and its session membership. */
function allowWorkspace(scope: Scope, value: unknown): boolean {
  const item = object(value);
  if (item === undefined) return false;
  const id = workspaceId(item.workspaceId);
  const path = item.path;
  if (id === undefined || typeof path !== "string" || !pathInUserRoot(scope.sessionRootPath, path)
    || path === scope.sessionRootPath) return false;
  (scope.workspaceIds as Set<string>).add(id);
  (scope.workspacePaths as Set<string>).add(path);
  const byId = scope.workspacePathById as Map<string, string> | undefined;
  byId?.set(id, path);
  const members = new Set<string>();
  if (Array.isArray(item.sessionIds)) {
    for (const candidate of item.sessionIds) {
      if (allowSession(scope, candidate)) members.add(String(candidate));
    }
  }
  (scope.workspaceSessionsById as Map<string, ReadonlySet<string>> | undefined)?.set(id, members);
  return true;
}

/**
 * Filter one public DSH event payload.  Unknown/remote frames are dropped by
 * default because the remote-event contract intentionally carries arbitrary
 * process-level arguments and has no account key.
 */
export function projectDownlinkFrame(
  scope: Scope,
  frame: DownlinkRequest,
  pending: Map<string, { sessionId: string; expiresAt: number }>,
): DownlinkRequest | undefined {
  const payload = object(frame.payload);
  if (payload === undefined || typeof payload.type !== "string") return undefined;
  const type = payload.type;
  if (type === "stream/error") {
    // DSH's native error text can contain host paths and provider details.  A
    // reconnect signal is all the browser needs; keep the account boundary
    // from becoming a diagnostic side channel.
    return {
      ...frame,
      payload: {
        type: "stream/error",
        error: { code: "internal", message: "connection stream unavailable", details: {} },
      },
    } as DownlinkRequest;
  }

  if (type === "session/event" || type === "session/subscribed" || type === "session/queue"
    || type === "session/jobs" || type === "session/projection" || type === "approval/resolved"
    || type === "question/resolved") {
    return allowSession(scope, payload.sessionId) ? frame : undefined;
  }
  if (type === "approval/requested" || type === "question/requested") {
    if (!allowSession(scope, payload.sessionId)) return undefined;
    pending.set(String(frame.rpcId), {
      sessionId: String(payload.sessionId),
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
    return frame;
  }

  if (type === "host/session-added") {
    return allowSession(scope, payload.sessionId, payload.cwd) ? frame : undefined;
  }
  if (type === "host/session-removed" || type === "host/session-status" || type === "host/agent-error") {
    const id = sessionId(payload.sessionId);
    if (id === undefined || !ownSession(scope, id)) return undefined;
    if (type === "host/session-removed") (scope.sessionIds as Set<string>).delete(id);
    return frame;
  }
  if (type === "host/workspace-changed") {
    if (!allowWorkspace(scope, payload.workspace)) return undefined;
    const workspace = object(payload.workspace);
    if (workspace === undefined) return undefined;
    // `sessionIds` is process-global registry state.  Keep the native frame
    // shape, but remove memberships that this account cannot address.
    const sessionIds = Array.isArray(workspace.sessionIds)
      ? workspace.sessionIds.filter(candidate => ownSession(scope, candidate))
      : [];
    return {
      ...frame,
      payload: { ...payload, workspace: { ...workspace, sessionIds } },
    } as DownlinkRequest;
  }
  if (type === "host/workspace-removed") {
    const id = workspaceId(payload.workspaceId);
    if (id === undefined || !ownWorkspace(scope, id)) return undefined;
    (scope.workspaceIds as Set<string>).delete(id);
    (scope.workspacePathById as Map<string, string> | undefined)?.delete(id);
    (scope.workspaceSessionsById as Map<string, ReadonlySet<string>> | undefined)?.delete(id);
    return frame;
  }
  if (type === "host/workspace-order-changed") {
    const ids = Array.isArray(payload.workspaceIds)
      ? payload.workspaceIds.filter(id => ownWorkspace(scope, id))
      : [];
    return { ...frame, payload: { ...payload, workspaceIds: ids } } as DownlinkRequest;
  }
  if (type === "host/archived-sessions-changed") {
    const ids = Array.isArray(payload.archivedSessionIds)
      ? payload.archivedSessionIds.filter(id => ownSession(scope, id))
      : [];
    return { ...frame, payload: { ...payload, archivedSessionIds: ids } } as DownlinkRequest;
  }
  // host/remote-event has no account-bearing field and can contain arbitrary
  // serialized arguments.  Never forward it through a multi-tenant stream.
  if (type === "host/remote-event") return undefined;
  return undefined;
}

function serverRequest(frame: DownlinkRequest): ServerRequest {
  const payload = frame.payload as DownlinkFrame;
  return {
    type: "server-request",
    rpcId: frame.rpcId,
    method: payload.type,
    payload,
  };
}

function failureFrame(error: unknown): DownlinkRequest {
  // Never put the thrown value on a multi-tenant event stream.  DSH provider
  // errors commonly include absolute host paths, request headers, or adapter
  // details.  The browser only needs the stable reconnect signal; the host
  // logger remains the place for the private diagnostic.
  void error;
  return {
    rpcId: RpcId(randomUUID()),
    payload: {
      type: "stream/error",
      error: { code: "internal", message: "connection stream unavailable", details: {} },
    } as HostFrame,
  };
}

class ScopedDownlinks {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly pumps = new Set<Promise<void>>();
  /** Pending approval/question ids admitted on an account-local stream. */
  private readonly pending = new Map<string, { sessionId: string; expiresAt: number }>();

  constructor(private readonly api: ApiProxy) {}

  rememberPending(rpcId: string, sessionId: string): void {
    const now = Date.now();
    for (const [id, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(id);
    }
    while (this.pending.size >= MAX_PENDING_RESPONSES) {
      const oldest = this.pending.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
    this.pending.set(rpcId, { sessionId, expiresAt: now + PENDING_TTL_MS });
  }

  responseAllowed(rpcId: string, scope: Scope): boolean {
    const pending = this.pending.get(rpcId);
    if (pending === undefined) return false;
    if (pending.expiresAt <= Date.now()) {
      this.pending.delete(rpcId);
      return false;
    }
    return ownSession(scope, pending.sessionId);
  }

  consumeResponse(rpcId: string, scope: Scope): boolean {
    if (!this.responseAllowed(rpcId, scope)) return false;
    this.pending.delete(rpcId);
    return true;
  }

  handle(
    kind: "mux" | "host",
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    scope: Scope,
    refreshScope: () => Promise<Scope>,
  ): void {
    this.server.handleUpgrade(req, socket, head, (websocket) => {
      const abort = new AbortController();
      websocket.once("close", () => abort.abort());
      websocket.once("error", () => abort.abort());
      websocket.once("message", () => websocket.close(1008, "downlink only"));
      const source: AsyncIterable<DownlinkRequest> = kind === "mux"
        ? this.api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, abort.signal) as AsyncIterable<DownlinkRequest>
        : this.api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, abort.signal) as AsyncIterable<DownlinkRequest>;
      const pump = this.pump(websocket, source, abort, scope, refreshScope);
      this.pumps.add(pump);
      void pump.then(() => this.pumps.delete(pump), () => this.pumps.delete(pump));
    });
  }

  async close(): Promise<void> {
    for (const socket of this.server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => {
      try {
        this.server.close(error => {
          if (error !== undefined && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
          else resolve();
        });
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === "ERR_SERVER_NOT_RUNNING") resolve();
        else reject(error);
      }
    });
    await Promise.all(this.pumps);
  }

  private async pump(
    socket: WebSocket,
    frames: AsyncIterable<DownlinkRequest>,
    abort: AbortController,
    scope: Scope,
    refreshScope: () => Promise<Scope>,
  ): Promise<void> {
    let currentScope = scope;
    let lastScopeRefresh = 0;
    try {
      for await (const candidate of frames) {
        let frame = projectDownlinkFrame(currentScope, candidate as DownlinkRequest, this.pending);
        const payload = object(candidate.payload);
        const candidateType = payload?.type;
        const candidateSession = sessionId(payload?.sessionId);
        // The mux and host downlinks are separate sockets. A newly-created
        // session can therefore publish its first mux event before the host
        // socket's session-added frame updates this connection's scope. Refresh
        // only for an unknown session-bearing frame, with a small throttle; the
        // refreshed scope still applies the same account-root ACL checks.
        if (frame === undefined && candidateSession !== undefined
          && (candidateType === "session/event" || candidateType === "session/subscribed"
            || candidateType === "session/queue" || candidateType === "session/jobs"
            || candidateType === "session/projection")
          && !currentScope.sessionIds.has(candidateSession)
          && Date.now() - lastScopeRefresh >= 250) {
          lastScopeRefresh = Date.now();
          try {
            currentScope = await refreshScope();
            frame = projectDownlinkFrame(currentScope, candidate as DownlinkRequest, this.pending);
          } catch {
            // Keep the frame dropped if reconciliation is temporarily unavailable.
          }
        }
        if (frame === undefined) continue;
        const framePayload = object(frame.payload);
        if (framePayload?.type === "approval/requested" || framePayload?.type === "question/requested") {
          const requestedSession = sessionId(framePayload.sessionId);
          if (requestedSession !== undefined) this.rememberPending(String(frame.rpcId), requestedSession);
        }
        if (socket.readyState !== WebSocket.OPEN) break;
        await new Promise<void>((resolve, reject) => {
          socket.send(JSON.stringify(serverRequest(frame)), error => error ? reject(error) : resolve());
        });
      }
    } catch (error: unknown) {
      if (!abort.signal.aborted && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify(serverRequest(failureFrame(error)))); } catch { /* socket won race */ }
      }
    } finally {
      abort.abort();
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }
  }
}

function responseRpcId(body: unknown): string | undefined {
  const input = object(body);
  return typeof input?.type === "string" && input.type === "client-response"
    && typeof input.rpcId === "string" ? input.rpcId : undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

type RegisteredRoute = {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
};

type RegisteredUpgrade = {
  readonly path: string;
  readonly handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
};

function sessionIdentity(req: IncomingMessage, config: ScopedConnectionConfig): string | undefined {
  return parseSessionCookie(
    parseCookies(req.headers.cookie).get(config.sessionCookieName),
    config.sessionSecret,
  )?.userId;
}

function rejectHttp(res: ServerResponse, status: number, error: string): void {
  json(res, status, { error });
}

/** Write a Fetch response while retaining the DSH carrier status/envelope. */
async function writeFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(body);
}

/**
 * Build the stock Connection shared handler.  `TypertGatewayService` installs
 * its `/api` interceptor on this exact service; calling the documented helper
 * is therefore the only supported way for a replacement HTTP carrier to
 * reach `commands/list` and `commands/execute`.  The ApiProxy remains the
 * fallback for any endpoint the gateway does not claim.
 */
function createSharedTypertHandler(ctx: Context, api: ApiProxy): FetchHandler {
  const connection = ctx.get("connection") as unknown as SharedConnection | undefined;
  if (connection === undefined || typeof connection.createSharedFetchHandler !== "function") {
    throw new Error("uwh: DSH connection shared handler is unavailable");
  }
  const fallback = toFetchHandler(api);
  return connection.createSharedFetchHandler(API_PATH, {
    fetch: request => fallback.fetch(request),
  });
}

/** Return the canonical DSH business error used for a foreign agent id. */
function rejectForeignTypertAgent(res: ServerResponse, rpcId: unknown, agentId: string): void {
  json(res, 200, {
    type: "server-response",
    rpcId: typeof rpcId === "string" ? rpcId : "invalid-request",
    result: {
      ok: false,
      error: {
        code: "session-not-found",
        message: "session does not belong to the authenticated user",
        details: { sessionId: agentId },
      },
    },
  });
}

/**
 * Authenticate, account-scope, and forward one public Typert command call.
 * We must buffer once to inspect `payload.args.agentId`; rebuilding a WHATWG
 * Request preserves the original DSH envelope and lets the shared handler
 * keep all Typert schema validation/error mapping in the upstream package.
 */
async function handleTypertCommand(
  ctx: Context,
  config: ScopedConnectionConfig,
  endpoint: "commands/list" | "commands/execute",
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  userId: string,
  getSharedHandler: () => FetchHandler,
): Promise<void> {
  let body: Buffer;
  try {
    body = await readBody(req, maxBodyBytes);
  } catch {
    rejectHttp(res, 413, "request_body_too_large");
    return;
  }

  let parsed: unknown;
  try {
    parsed = body.byteLength === 0 ? undefined : JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    // Do not invent a protocol error.  Forward the original bytes so the
    // public DSH fetch handler emits its canonical 400 carrier response.
    parsed = undefined;
  }
  const message = object(parsed);
  if (message?.type === "client-request" && message.method === endpoint) {
    const agentId = typertCommandAgentId(message);
    if (agentId !== undefined) {
      let scope: Scope;
      try {
        scope = await buildScope(ctx, config, userId);
      } catch {
        rejectHttp(res, 503, "workspace_scope_unavailable");
        return;
      }
      if (!ownSession(scope, agentId)) {
        rejectForeignTypertAgent(res, message.rpcId, agentId);
        return;
      }
    }
  }

  let shared: FetchHandler;
  try {
    shared = getSharedHandler();
  } catch {
    rejectHttp(res, 503, "typert_gateway_unavailable");
    return;
  }
  const abort = new AbortController();
  const onClose = (): void => {
    if (!res.writableEnded) abort.abort();
  };
  res.once("close", onClose);
  try {
    const url = new URL(req.url ?? `${API_PATH}/${endpoint}`, "http://dsh.internal");
    const response = await shared.fetch(new Request(url, {
      method: req.method ?? "POST",
      headers: requestHeaders(req),
      ...(body.byteLength === 0 ? {} : { body: body.toString("utf8") }),
      signal: abort.signal,
    }));
    await writeFetchResponse(res, response);
  } catch (error: unknown) {
    if (!abort.signal.aborted) {
      rejectHttp(res, 500, `typert_rpc_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    res.off("close", onClose);
  }
}

/**
 * Install the authenticated replacement for DSH's stock `/api` carrier.
 *
 * The public WebSocket contract remains DSH-owned.  We only replace its two
 * downlink handlers in the host registry (the stock package does not expose a
 * hook for an auth-aware downlink), and add the same cookie check to the
 * response endpoint.  The collaboration socket is deliberately not touched.
 */
export function installScopedConnection(ctx: Context, config: ScopedConnectionConfig): () => void {
  const webServer = ctx.get("webServer") as Context["webServer"];
  const api = ctx.get("apiProxy") as unknown as ApiProxy | undefined;
  if (api === undefined) throw new Error("uwh: apiProxy is unavailable; refusing to start without an auth boundary");
  const downlinks = new ScopedDownlinks(api);
  const upgrades = (webServer as unknown as {
    upgrades?: Map<string, RegisteredUpgrade>;
  }).upgrades;
  const prefixes = (webServer as unknown as { prefixes?: Map<string, RegisteredRoute> }).prefixes;
  if (upgrades === undefined || prefixes === undefined) {
    throw new Error("uwh: DSH webServer route registries are unavailable; refusing to start without an auth boundary");
  }

  const originals = new Map<string, RegisteredUpgrade>();
  const replacements = new Map<string, RegisteredUpgrade>();
  const upgrade = (kind: "mux" | "host") => (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (!trustedRequest(req, config.publicOrigin)) { rejectUpgrade(socket); return; }
    const userId = sessionIdentity(req, config);
    if (userId === undefined) { rejectUpgrade(socket); return; }
    const refreshScope = (): Promise<Scope> => buildScope(ctx, config, userId);
    void refreshScope().then(scope => {
      downlinks.handle(kind, req, socket, head, scope, refreshScope);
    }).catch(() => rejectUpgrade(socket));
  };
  for (const [path, kind] of [[MUX_EVENTS_PATH, "mux"], [HOST_EVENTS_PATH, "host"]] as const) {
    const original = upgrades.get(path);
    if (original === undefined) {
      throw new Error(`uwh: stock DSH connection did not register ${path}`);
    }
    originals.set(path, original);
    const replacement = { ...original, handler: upgrade(kind) };
    replacements.set(path, replacement);
    upgrades.set(path, replacement);
  }

  const originalPrefix = prefixes.get(API_PATH);
  if (originalPrefix === undefined) {
    throw new Error("uwh: stock DSH connection did not register /api");
  }
  const maxBodyBytes = config.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  // Construct this lazily: Cordis may install the stock Connection service
  // immediately after this composition effect.  The first Typert request is
  // still routed through the same service instance (and therefore the gateway
  // interceptor), while a missing service yields an honest 503 below.
  let sharedTypertHandler: FetchHandler | undefined;
  const getSharedTypertHandler = (): FetchHandler => {
    if (sharedTypertHandler !== undefined) return sharedTypertHandler;
    sharedTypertHandler = createSharedTypertHandler(ctx, api);
    return sharedTypertHandler;
  };

  // Keep the stock bridge for the exact RPC routes that the harness registers
  // separately, but make every unmatched `/api/*` request authenticate and
  // deny unknown paths.  This closes newly-added DSH routes by default instead
  // of silently inheriting a process-global operation.
  const originalPrefixHandler = originalPrefix.handler;
  const prefixReplacement: RegisteredRoute = {
    ...originalPrefix,
    handler: async (req, res): Promise<void> => {
      if (!trustedRequest(req, config.publicOrigin)) {
        rejectHttp(res, 403, "forbidden");
        return;
      }
      if (sessionIdentity(req, config) === undefined) {
        rejectHttp(res, 401, "missing_or_invalid_session");
        return;
      }
      const pathname = new URL(req.url ?? API_PATH, "http://dsh.internal").pathname;
      if (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH) {
        rejectHttp(res, 426, "upgrade_required");
        return;
      }
      const typertEndpoint = typertCommandEndpoint(pathname);
      if (typertEndpoint !== undefined) {
        const userId = sessionIdentity(req, config);
        // The identity was checked above; keep the second lookup explicit so
        // the helper cannot ever be called with an unchecked value if the
        // carrier's auth branch changes later.
        if (userId === undefined) {
          rejectHttp(res, 401, "missing_or_invalid_session");
          return;
        }
        await handleTypertCommand(
          ctx,
          config,
          typertEndpoint,
          req,
          res,
          maxBodyBytes,
          userId,
          getSharedTypertHandler,
        );
        return;
      }
      if (!SCOPED_RPC_PATHS.has(pathname)
        && !DYNAMIC_CORDIS_PATHS.has(pathname)
        && pathname !== RESPOND_PATH
        && pathname !== SESSION_EXPORT_PATH) {
        rejectHttp(res, 404, "not_found");
        return;
      }
      await originalPrefixHandler(req, res);
    },
  };
  prefixes.set(API_PATH, prefixReplacement);

  const respondRoute: RegisteredRoute = {
    kind: "exact",
    path: RESPOND_PATH,
    handler: async (req, res): Promise<void> => {
      if (!trustedRequest(req, config.publicOrigin)) {
        rejectHttp(res, 403, "forbidden");
        return;
      }
      if (req.method !== "POST") {
        rejectHttp(res, 405, "method_not_allowed");
        return;
      }
      const userId = sessionIdentity(req, config);
      if (userId === undefined) {
        rejectHttp(res, 401, "missing_or_invalid_session");
        return;
      }
      let scope: Scope;
      try {
        scope = await buildScope(ctx, config, userId);
      } catch {
        rejectHttp(res, 503, "workspace_scope_unavailable");
        return;
      }
      let body: Buffer;
      try {
        body = await readBody(req, maxBodyBytes);
      } catch {
        rejectHttp(res, 413, "request_body_too_large");
        return;
      }
      let parsed: unknown;
      try {
        parsed = body.byteLength === 0 ? undefined : JSON.parse(body.toString("utf8")) as unknown;
      } catch {
        json(res, 200, { accepted: false, reason: "bad-response" });
        return;
      }
      const rpcId = responseRpcId(parsed);
      if (rpcId === undefined) {
        json(res, 200, { accepted: false, reason: "bad-response" });
        return;
      }
      // Do not let a caller probe or answer another account's pending
      // approval/question.  The stock API still validates the response shape
      // after this account check.
      if (!downlinks.responseAllowed(rpcId, scope)) {
        json(res, 200, { accepted: false, reason: "not-pending" });
        return;
      }
      try {
        const response = await toFetchHandler(api).fetch(new Request(`http://dsh.internal${RESPOND_PATH}`, {
          method: "POST",
          headers: requestHeaders(req),
          body: body.toString("utf8"),
        }));
        const responseBody = await response.arrayBuffer();
        if (response.status === 200 && response.headers.get("content-type")?.includes("json")) {
          try {
            const receipt = JSON.parse(Buffer.from(responseBody).toString("utf8")) as { accepted?: unknown };
            if (receipt.accepted === true) downlinks.consumeResponse(rpcId, scope);
          } catch {
            // Preserve the stock body below; malformed proxy output is not an
            // authorization decision.
          }
        }
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(responseBody));
      } catch (error: unknown) {
        rejectHttp(res, 500, `scoped_response_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
  if ((webServer as unknown as { exact?: Map<string, RegisteredRoute> }).exact?.has(RESPOND_PATH)) {
    throw new Error(`uwh: duplicate exact route ${RESPOND_PATH}`);
  }
  const disposeRespond = webServer.register(respondRoute);

  return () => {
    for (const [path, original] of originals) {
      if (upgrades.get(path) === replacements.get(path)) upgrades.set(path, original);
    }
    if (prefixes.get(API_PATH) === prefixReplacement) prefixes.set(API_PATH, originalPrefix);
    disposeRespond();
    void downlinks.close().catch((error: unknown) => {
      console.warn("univer-workspace-harness: downlink disposer failed", error);
    });
  };
}

/**
 * The stock connection plugin registers its two upgrade routes from a nested
 * `ctx.inject(["apiProxy"])` effect.  Harness itself also depends on
 * `apiProxy`, so both effects can become runnable in the same loader turn; a
 * direct map lookup would then race the stock registration and abort startup.
 * Wait for the owning effect to publish the routes, but keep a finite timeout
 * so a genuinely incomplete DSH composition still fails with a useful error.
 */
export async function waitForStockConnectionRoutes(ctx: Context, timeoutMs = 5000): Promise<void> {
  const webServer = ctx.get("webServer") as Context["webServer"];
  const upgrades = (webServer as unknown as { upgrades?: Map<string, unknown> }).upgrades;
  const prefixes = (webServer as unknown as { prefixes?: Map<string, unknown> }).prefixes;
  if (upgrades === undefined || prefixes === undefined) {
    throw new Error("uwh: DSH webServer route registries are unavailable; refusing to start without an auth boundary");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (upgrades.has(MUX_EVENTS_PATH) && upgrades.has(HOST_EVENTS_PATH) && prefixes.has(API_PATH)) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error("uwh: stock DSH connection routes did not register within the startup deadline");
}
