/**
 * The capability plugin's browser-facing API routes.
 *
 * Registered on the DSH web server (no separate gateway): JSON state for the
 * current process identity's Spaces. The local Harness has no browser-user
 * authentication layer; the prefix route dispatches on the sub-path.
 * @module dsh-univer-workspace-plugin/webServer
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionEvent, SessionId } from "@deepseek-ai/dsh-session";
import type { Workspace } from "@deepseek-ai/dsh-workspace";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "../provider/workspace-contract.ts";
import type { JsonValue } from "../json-value.ts";
import { originUserDirectoryPath } from "../provider/workspace-contract.ts";
import type { WorkspaceSessionContextService } from "../session-context.ts";
import {
  WORKSPACE_ME_PATH,
  WORKSPACE_TEMPLATE_FORK_PATH,
  type WorkspaceTemplate,
} from "../client/workspace-contract.ts";

const PREFIX = "/univer-workspace/api";
const CLIENT_CSS_PATH = "/plugins/dsh-univer-workspace-plugin/client.css";

/**
 * Keep the immutable stylesheet cacheable while changing its URL whenever the
 * compiled Vite output changes. The hash is computed from the packaged asset,
 * not from source timestamps, so profile copies and container layers agree.
 */
const CLIENT_CSS_REVISION = (() => {
  try {
    return createHash("sha256")
      .update(readFileSync(new URL("./client.css", import.meta.url)))
      .digest("hex")
      .slice(0, 12);
  } catch {
    return "dev";
  }
})();
const CLIENT_CSS_URL = `${CLIENT_CSS_PATH}?rev=${CLIENT_CSS_REVISION}`;

export interface WebServerConfig {
  /** The resolved Univer runtime license, shared with the browser viewer. */
  license: string;
  /** Mechanical root used for account-local DSH workspaces. */
  workspaceRoot: string;
  /** Workspace product origin used by the authenticated routes. */
  workspaceOrigin: string;
  /** Public harness origin used for same-origin request validation. */
  publicOrigin: string;
  /** Deployment-configured templates exposed by the capability. */
  templates: readonly WorkspaceTemplate[];
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
  details?: Record<string, unknown>,
): void {
  let output = body;
  if (status >= 500) {
    const diagnosticId = randomUUID();
    console.error(
      `[uwh-web] ${JSON.stringify({
        event: "http-error",
        diagnosticId,
        status,
        ...details,
        body: typeof body === "string" ? body : undefined,
        at: new Date().toISOString(),
      })}`,
    );
    output =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? { ...(body as Record<string, unknown>), diagnosticId }
        : { error: String(body), diagnosticId };
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(output));
}

/** Resolve the authenticated Workspace user for a request, or answer 401. */
function authenticatedUser(
  ctx: Context,
): { userId: string; displayName: string; avatarUrl: string | null } | null {
  const identity = ctx.get("workspaceAuth")!.currentIdentity();
  if (identity === undefined) return null;
  return {
    userId: identity.userId,
    displayName: identity.displayName ?? identity.username,
    avatarUrl: null,
  };
}

function effectiveWorkspaceOrigin(ctx: Context, config: WebServerConfig): string {
  return (
    (
      ctx.get("workspaceAuth") as { effectiveOrigin?: () => string } | undefined
    )?.effectiveOrigin?.() ?? config.workspaceOrigin
  );
}

function trustedRequest(req: IncomingMessage, publicOrigin: string): boolean {
  const authority = req.headers.host;
  if (typeof authority !== "string") return false;
  let host: URL;
  let configured: URL;
  try {
    host = new URL(`http://${authority}`);
    configured = new URL(publicOrigin);
  } catch {
    return false;
  }
  if (
    host.host !== configured.host &&
    host.hostname !== "localhost" &&
    !host.hostname.startsWith("127.")
  )
    return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    try {
      if (new URL(origin).host !== host.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function readJsonBody(req: IncomingMessage, maxBytes = 8 * 1024): Promise<unknown> {
  return (async () => {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.byteLength;
      if (length > maxBytes) throw new Error("request body too large");
      chunks.push(bytes);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return text.trim() === "" ? {} : (JSON.parse(text) as unknown);
  })();
}

function contextPayload(value: unknown): { resourceId?: string } | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "resourceId")) return undefined;
  if (record.resourceId !== undefined && typeof record.resourceId !== "string") return undefined;
  const resourceId = record.resourceId?.trim();
  return resourceId === undefined || resourceId === "" ? {} : { resourceId };
}

function workspaceView(workspace: Workspace): Record<string, unknown> {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

async function ensureUserWorkspace(
  ctx: Context,
  config: WebServerConfig,
  userId: string,
  title: string,
): Promise<Workspace> {
  const auth = ctx.get("workspaceAuth") as
    | { effectiveOrigin?: () => string; prepareUser?: (id: string) => Promise<void> }
    | undefined;
  const origin = auth?.effectiveOrigin?.() ?? config.workspaceOrigin;
  await auth?.prepareUser?.(userId);
  const path = originUserDirectoryPath(config.workspaceRoot, origin, userId);
  await mkdir(path, { recursive: true });
  const registry = ctx.get("workspaceRegistry") as {
    resolveByPath(path: string): Promise<Workspace | undefined>;
    create(path: string, title?: string): Promise<Workspace>;
  };
  return (await registry.resolveByPath(path)) ?? (await registry.create(path, title));
}

function balancedLog(events: readonly SessionEvent[]): boolean {
  let turns = 0;
  let steps = 0;
  for (const event of events) {
    if (event.type === "turn/start") turns++;
    else if (event.type === "turn/end") turns--;
    else if (event.type === "step/start") steps++;
    else if (event.type === "step/end") steps--;
    if (turns < 0 || steps < 0) return false;
  }
  return turns === 0 && steps === 0;
}

function seedCut(events: readonly SessionEvent[]): number {
  if (!balancedLog(events)) throw new Error("template source log is not a balanced logical log");
  let boundary = -1;
  for (const event of events) if (event.type === "turn/end") boundary = event.seq;
  if (boundary < 0) throw new Error("template source has no completed turn");
  let cut = boundary + 1;
  while (cut < events.length && events[cut]?.type !== "turn/start") cut++;
  return cut;
}

async function templateFork(
  ctx: Context,
  config: WebServerConfig,
  userId: string,
  template: WorkspaceTemplate,
): Promise<string> {
  const persistence = ctx.get("sessionPersistence") as {
    load(id: SessionId): Promise<{ events: readonly SessionEvent[] }>;
  };
  const sessions = ctx.get("sessions") as {
    create(
      id: SessionId,
      options: { seed: readonly SessionEvent[]; meta: Record<string, unknown> },
    ): unknown;
  };
  const sourceId = template.sessionId as SessionId;
  const source = await persistence.load(sourceId);
  const cut = seedCut(source.events);
  const workspace = await ensureUserWorkspace(ctx, config, userId, userId);
  const childId = `session-${randomUUID()}` as SessionId;
  sessions.create(childId, {
    seed: source.events.slice(0, cut),
    meta: {
      cwd: workspace.path,
      parentSession: sourceId,
      seedLength: cut,
      ...(template.agentPreset === undefined || template.agentPreset === ""
        ? {}
        : { agentPreset: template.agentPreset }),
    },
  });
  await workspace.attachSession(childId);
  return childId;
}

function spaceIdFromRequest(req: IncomingMessage): string | undefined {
  const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
  const prefix = "/api/uwh/spaces/";
  if (!pathname.startsWith(prefix)) return undefined;
  const value = pathname.slice(prefix.length);
  if (value === "" || value.includes("/")) return undefined;
  try {
    const id = decodeURIComponent(value);
    return id === "" || id.includes("/") || id.includes("\\") || id.length > 200 ? undefined : id;
  } catch {
    return undefined;
  }
}

function parseSpacePayload(value: unknown): { name: string } | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.name !== "string") return undefined;
  const name = record.name.trim();
  return name === "" || name.length > 100 ? undefined : { name };
}

/** Routes that belong to the Workspace capability, not the Harness core. */
function createCapabilityHandler(
  ctx: Context,
  config: WebServerConfig,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (!trustedRequest(req, config.publicOrigin)) {
      jsonResponse(res, 403, { error: "forbidden" });
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
    const user = authenticatedUser(ctx);

    if (pathname === WORKSPACE_ME_PATH) {
      if (req.method !== "GET") {
        jsonResponse(res, 405, { error: "method_not_allowed" });
        return;
      }
      if (user === null) {
        jsonResponse(res, 200, {
          workspaceOrigin: effectiveWorkspaceOrigin(ctx, config),
          templates: config.templates,
          connected: false,
          restartRequired: ctx.workspaceAuth.restartRequired(),
          ...(ctx.workspaceAuth.pendingIdentity() === undefined
            ? {}
            : { pendingIdentity: ctx.workspaceAuth.pendingIdentity() }),
        });
        return;
      }
      try {
        const workspace = await ensureUserWorkspace(ctx, config, user.userId, user.displayName);
        jsonResponse(res, 200, {
          identity: {
            userId: user.userId,
            username: user.displayName,
            displayName: user.displayName,
          },
          workspace: workspaceView(workspace),
          admin: false,
          workspaceOrigin: effectiveWorkspaceOrigin(ctx, config),
          templates: config.templates,
          connected: ctx.workspaceAuth.currentClient() !== undefined,
          restartRequired: ctx.workspaceAuth.restartRequired(),
          ...(ctx.workspaceAuth.pendingIdentity() === undefined
            ? {}
            : { pendingIdentity: ctx.workspaceAuth.pendingIdentity() }),
        });
      } catch (error) {
        jsonResponse(
          res,
          502,
          { error: "workspace_unavailable" },
          { route: "identity", error: String(error) },
        );
      }
      return;
    }

    if (user === null) {
      jsonResponse(res, 401, { error: "workspace_connection_required" });
      return;
    }

    if (pathname === WORKSPACE_TEMPLATE_FORK_PATH) {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "method_not_allowed" });
        return;
      }
      let payload: unknown;
      try {
        payload = await readJsonBody(req);
      } catch {
        jsonResponse(res, 400, { error: "invalid_request_body" });
        return;
      }
      const key =
        payload !== null && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).key
          : undefined;
      const template =
        typeof key === "string" ? config.templates.find((item) => item.key === key) : undefined;
      if (template === undefined) {
        jsonResponse(res, 404, { error: "template_not_configured" });
        return;
      }
      try {
        jsonResponse(res, 200, {
          sessionId: await templateFork(ctx, config, user.userId, template),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = /balanced|completed turn/iu.test(message) ? 422 : 502;
        jsonResponse(res, status, { error: message }, { route: "template-fork", error: message });
      }
      return;
    }

    const spaceId = spaceIdFromRequest(req);
    if (spaceId !== undefined) {
      if (req.method !== "PATCH") {
        jsonResponse(res, 405, { error: "method_not_allowed" });
        return;
      }
      const parsed = parseSpacePayload(await readJsonBody(req).catch(() => undefined));
      if (parsed === undefined) {
        jsonResponse(res, 400, { error: "space_name_invalid" });
        return;
      }
      const auth = ctx.get("workspaceAuth");
      const client = auth?.currentClient();
      if (client === undefined) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      try {
        const path = `/api/spaces/${encodeURIComponent(spaceId)}`;
        const current = await client.request(path, { headers: { accept: "application/json" } });
        if (current.status === 401)
          return jsonResponse(res, 401, { error: "workspace_connection_required" });
        if (current.status === 404) return jsonResponse(res, 404, { error: "space_not_found" });
        if (!current.ok) return jsonResponse(res, 502, { error: "workspace_unavailable" });
        const currentBody = (await current.json()) as {
          id?: unknown;
          capabilities?: { renameSpace?: unknown };
        };
        if (currentBody.id !== spaceId)
          return jsonResponse(res, 502, { error: "workspace_unavailable" });
        if (currentBody.capabilities?.renameSpace !== true)
          return jsonResponse(res, 403, { error: "space_rename_forbidden" });
        const updated = await client.request(path, {
          method: "PATCH",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ name: parsed.name }),
        });
        if (updated.status === 400) return jsonResponse(res, 400, { error: "space_name_invalid" });
        if (updated.status === 401)
          return jsonResponse(res, 401, { error: "workspace_connection_required" });
        if (updated.status === 403)
          return jsonResponse(res, 403, { error: "space_rename_forbidden" });
        if (updated.status === 404) return jsonResponse(res, 404, { error: "space_not_found" });
        if (!updated.ok) return jsonResponse(res, 502, { error: "workspace_unavailable" });
        const body = (await updated.json()) as { id?: unknown; name?: unknown };
        if (body.id !== spaceId || typeof body.name !== "string" || body.name === "")
          return jsonResponse(res, 502, { error: "workspace_unavailable" });
        jsonResponse(res, 200, { space: { spaceId, name: body.name } });
      } catch (error) {
        jsonResponse(
          res,
          502,
          { error: "workspace_unavailable" },
          { route: "space-rename", error: String(error) },
        );
      }
      return;
    }
    jsonResponse(res, 404, { error: "not_found" });
  };
}

function upstreamStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/workspace connection is unavailable|workspace connection required/iu.test(message))
    return 401;
  if (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 600
  ) {
    return error.status;
  }
  return 502;
}

const PRODUCT_PROXY_ROUTES = [
  { method: "POST", pattern: /^\/team-spaces$/ },
  { method: "GET", pattern: /^\/users\/search$/ },
  { method: "GET", pattern: /^\/nodes\/[^/]+$/ },
  { method: "GET", pattern: /^\/nodes\/[^/]+\/grants$/ },
  { method: "PUT", pattern: /^\/nodes\/[^/]+\/grants\/[^/]+$/ },
  { method: "DELETE", pattern: /^\/nodes\/[^/]+\/grants\/[^/]+$/ },
  { method: "GET", pattern: /^\/nodes\/[^/]+\/link-sharing$/ },
  { method: "PUT", pattern: /^\/nodes\/[^/]+\/link-sharing$/ },
  { method: "POST", pattern: /^\/blob-upload-sessions$/ },
  { method: "DELETE", pattern: /^\/blob-upload-sessions\/[^/]+$/ },
  { method: "PUT", pattern: /^\/blob-upload-sessions\/[^/]+\/content$/ },
  { method: "POST", pattern: /^\/blob-upload-sessions\/[^/]+\/complete$/ },
  { method: "GET", pattern: /^\/resources\/[^/]+$/ },
  { method: "POST", pattern: /^\/resources\/[^/]+\/open$/ },
  { method: "GET", pattern: /^\/resources\/[^/]+\/open$/ },
  { method: "GET", pattern: /^\/blob-resources\/[^/]+\/content$/ },
  { method: "GET", pattern: /^\/blob-resources\/[^/]+\/download$/ },
  { method: "GET", pattern: /^\/recent-resources$/ },
  { method: "GET", pattern: /^\/owned-by-me$/ },
  { method: "GET", pattern: /^\/shared-with-me$/ },
] as const;

export function productProxyTarget(
  method: string | undefined,
  subPath: string,
): string | undefined {
  const normalizedMethod = method ?? "GET";
  return PRODUCT_PROXY_ROUTES.some(
    (route) => route.method === normalizedMethod && route.pattern.test(subPath),
  )
    ? `/api${subPath}`
    : undefined;
}

async function proxyWorkspaceProductRequest(
  client: { request(path: string, init?: RequestInit): Promise<Response> },
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const name of [
    "accept",
    "content-type",
    "content-length",
    "idempotency-key",
    "range",
    "if-none-match",
  ] as const) {
    const value = req.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  const carriesBody = method !== "GET" && method !== "HEAD";
  const init = {
    method,
    headers,
    ...(carriesBody ? { body: Readable.toWeb(req), duplex: "half" } : {}),
  } as RequestInit;
  const response = await client.request(path, init);
  const responseHeaders: Record<string, string> = {};
  for (const name of [
    "content-type",
    "content-length",
    "content-disposition",
    "etag",
    "content-range",
    "accept-ranges",
  ] as const) {
    const value = response.headers.get(name);
    if (value !== null) responseHeaders[name] = value;
  }
  res.writeHead(response.status, responseHeaders);
  if (response.body === null) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as never).pipe(res);
}

/** Build the browser-facing Workspace API prefix handler. */
export function createBrowserApiHandler(
  ctx: Context,
  config: WebServerConfig,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (!trustedRequest(req, config.publicOrigin)) {
      jsonResponse(res, 403, { error: "forbidden" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://x");
    const subPath = url.pathname.slice(PREFIX.length);
    const productTarget = productProxyTarget(req.method, subPath);
    if (productTarget !== undefined) {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      const client = ctx.get("workspaceAuth")?.currentClient();
      if (client === undefined) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      try {
        await proxyWorkspaceProductRequest(client, req, res, `${productTarget}${url.search}`);
      } catch (error) {
        jsonResponse(
          res,
          upstreamStatus(error),
          { error: error instanceof Error ? error.message : "workspace unreachable" },
          { route: "product-proxy", target: productTarget, error: String(error) },
        );
      }
      return;
    }
    if (subPath === "/session-context") {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
      if (sessionId === "" || sessionId.length > 240 || sessionId.includes("/")) {
        jsonResponse(res, 400, { error: "session_id_invalid" });
        return;
      }
      const service = ctx.get("workspaceSessionContext") as
        | WorkspaceSessionContextService
        | undefined;
      if (service === undefined) {
        jsonResponse(res, 503, { error: "session_context_unavailable" });
        return;
      }
      try {
        if (req.method === "GET") {
          jsonResponse(res, 200, { items: await service.list(sessionId) });
          return;
        }
        const parsed = contextPayload(await readJsonBody(req, 4 * 1024).catch(() => undefined));
        if (parsed === undefined || parsed.resourceId === undefined) {
          jsonResponse(res, 400, { error: "resource_id_invalid" });
          return;
        }
        if (req.method === "POST") {
          jsonResponse(res, 200, { items: await service.add(sessionId, parsed.resourceId) });
          return;
        }
        if (req.method === "DELETE") {
          jsonResponse(res, 200, { items: await service.remove(sessionId, parsed.resourceId) });
          return;
        }
        jsonResponse(res, 405, { error: "method_not_allowed" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status =
          message === "workspace_connection_required"
            ? 401
            : message === "workspace_resource_unavailable"
              ? 404
              : 502;
        jsonResponse(res, status, { error: message }, { route: "session-context", sessionId });
      }
      return;
    }
    if (req.method === "GET" && subPath === "/spaces") {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      try {
        const result = await ctx.get("univerWorkspace")!.listSpaces(user.userId);
        jsonResponse(res, 200, { spaces: result.spaces });
      } catch (error) {
        const status = upstreamStatus(error);
        jsonResponse(
          res,
          status,
          { error: error instanceof Error ? error.message : "workspace unreachable" },
          {
            route: "spaces",
            userId: user.userId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
          },
        );
      }
      return;
    }
    if (req.method === "GET" && subPath === "/worktrees") {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      try {
        const worktrees = await ctx.get("univerWorkspace")!.listWorktrees(user.userId);
        jsonResponse(res, 200, { worktrees });
      } catch (error) {
        jsonResponse(
          res,
          upstreamStatus(error),
          { error: error instanceof Error ? error.message : "workspace unreachable" },
          {
            route: "worktrees",
            userId: user.userId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
          },
        );
      }
      return;
    }
    const nodesMatch = /^\/spaces\/([^/]+)\/nodes$/.exec(subPath);
    if (nodesMatch !== null && (req.method === "GET" || req.method === "POST")) {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      try {
        const spaceId = decodeURIComponent(nodesMatch[1]!);
        if (req.method === "GET") {
          const query = url.searchParams.get("query");
          const parentNodeId = url.searchParams.get("parentNodeId");
          const result = await ctx.get("univerWorkspace")!.listDocuments(user.userId, spaceId, {
            recursive: false,
            ...(parentNodeId === null ? {} : { parentNodeId }),
            ...(query === null ? {} : { query }),
          });
          jsonResponse(res, 200, { spaceId, documents: result });
        } else {
          let payload: unknown;
          try {
            payload = await readJsonBody(req);
          } catch {
            jsonResponse(res, 400, { error: "invalid_document" });
            return;
          }
          const record =
            payload !== null && typeof payload === "object"
              ? (payload as Record<string, unknown>)
              : {};
          const name = typeof record.name === "string" ? record.name.trim() : "";
          const unitType = record.unitType;
          const initialData =
            record.initialData !== null &&
            typeof record.initialData === "object" &&
            !Array.isArray(record.initialData)
              ? record.initialData
              : undefined;
          const parentNodeId =
            record.parentNodeId === null || record.parentNodeId === undefined
              ? null
              : typeof record.parentNodeId === "string" && record.parentNodeId.trim() !== ""
                ? record.parentNodeId
                : undefined;
          if (
            name === "" ||
            !["folder", "sheet", "doc", "slide", "board", "base"].includes(String(unitType))
          ) {
            jsonResponse(res, 400, { error: "invalid_document" });
            return;
          }
          if (parentNodeId === undefined) {
            jsonResponse(res, 400, { error: "invalid_parent_node" });
            return;
          }
          if (unitType === "folder") {
            const auth = ctx.get("workspaceAuth");
            const client = auth?.currentClient();
            if (client === undefined) {
              jsonResponse(res, 401, { error: "workspace_connection_required" });
              return;
            }
            const response = await client.request("/api/nodes", {
              method: "POST",
              headers: { accept: "application/json", "content-type": "application/json" },
              body: JSON.stringify({ spaceId, parentNodeId, name }),
            });
            const body = await response.text();
            res.writeHead(response.status, {
              "content-type": response.headers.get("content-type") ?? "application/json",
            });
            res.end(body);
            return;
          }
          const created = await ctx.get("univerWorkspace")!.createDocument(user.userId, {
            spaceId,
            parentNodeId,
            name,
            unitType: unitType as "sheet" | "doc" | "slide" | "board" | "base",
            ...(initialData === undefined ? {} : { initialData: initialData as JsonValue }),
          });
          jsonResponse(res, 201, { spaceId, ...created });
        }
      } catch (error) {
        jsonResponse(res, upstreamStatus(error), {
          error: error instanceof Error ? error.message : "workspace unreachable",
        });
      }
      return;
    }
    const trashListMatch = /^\/spaces\/([^/]+)\/trash$/.exec(subPath);
    if (trashListMatch !== null && req.method === "GET") {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      try {
        const spaceId = decodeURIComponent(trashListMatch[1]!);
        const auth = ctx.get("workspaceAuth");
        const client = auth?.currentClient();
        if (client === undefined) {
          jsonResponse(res, 401, { error: "workspace_connection_required" });
          return;
        }
        const query = url.searchParams.toString();
        const response = await client.request(
          `/api/spaces/${encodeURIComponent(spaceId)}/trash${query === "" ? "" : `?${query}`}`,
          { headers: { accept: "application/json" } },
        );
        const payload = await response.text();
        res.writeHead(response.status, {
          "content-type": response.headers.get("content-type") ?? "application/json",
        });
        res.end(payload);
      } catch {
        jsonResponse(res, 502, { error: "workspace_unavailable" });
      }
      return;
    }
    const trashActionMatch = /^\/trash-batches\/([^/]+)(?:\/(restore))?$/.exec(subPath);
    if (
      trashActionMatch !== null &&
      ((trashActionMatch[2] === "restore" && req.method === "POST") ||
        (trashActionMatch[2] === undefined && req.method === "DELETE"))
    ) {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      try {
        const auth = ctx.get("workspaceAuth");
        const client = auth?.currentClient();
        if (client === undefined) {
          jsonResponse(res, 401, { error: "workspace_connection_required" });
          return;
        }
        const batchId = encodeURIComponent(decodeURIComponent(trashActionMatch[1]!));
        const actionPath =
          trashActionMatch[2] === "restore"
            ? `/api/trash-batches/${batchId}/restore`
            : `/api/trash-batches/${batchId}`;
        const response = await client.request(actionPath, {
          method: req.method,
          headers: { accept: "application/json" },
        });
        const payload = await response.text();
        res.writeHead(response.status, {
          "content-type": response.headers.get("content-type") ?? "application/json",
        });
        res.end(payload);
      } catch {
        jsonResponse(res, 502, { error: "workspace_unavailable" });
      }
      return;
    }
    const nodeMutation = /^\/nodes\/([^/]+)$/.exec(subPath);
    const nodeTrash = /^\/nodes\/([^/]+)\/trash$/.exec(subPath);
    if (
      (nodeMutation !== null && req.method === "PATCH") ||
      (nodeTrash !== null && req.method === "POST")
    ) {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      const auth = ctx.get("workspaceAuth");
      const client = auth?.currentClient();
      if (client === undefined) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      try {
        const nodeId = encodeURIComponent(decodeURIComponent((nodeMutation ?? nodeTrash)![1]!));
        const path = nodeTrash === null ? `/api/nodes/${nodeId}` : `/api/nodes/${nodeId}/trash`;
        const init: RequestInit = { method: req.method, headers: { accept: "application/json" } };
        if (req.method === "PATCH") {
          init.headers = { ...init.headers, "content-type": "application/json" };
          init.body = JSON.stringify(await readJsonBody(req));
        }
        const response = await client.request(path, init);
        const payload = await response.text();
        res.writeHead(response.status, {
          "content-type": response.headers.get("content-type") ?? "application/json",
        });
        res.end(payload);
      } catch {
        jsonResponse(res, 502, { error: "workspace_unavailable" });
      }
      return;
    }
    if (req.method === "GET" && subPath === "/viewer-bootstrap") {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      jsonResponse(res, 200, {
        user: { id: user.userId, displayName: user.displayName, avatarUrl: user.avatarUrl },
        license: config.license,
      });
      return;
    }
    if (req.method === "GET" && subPath === "/file-state") {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      const resourceId = url.searchParams.get("resourceId");
      const worktreeId = url.searchParams.get("worktreeId");
      if (
        (resourceId === null || resourceId === "") &&
        (worktreeId === null || worktreeId === "")
      ) {
        jsonResponse(res, 400, { error: "resourceId_or_worktreeId_required" });
        return;
      }
      try {
        const state =
          worktreeId !== null && worktreeId !== ""
            ? await ctx.get("univerWorkspace")!.getWorktreeFileState(user.userId, worktreeId)
            : await ctx.get("univerWorkspace")!.getFileState(user.userId, resourceId!);
        jsonResponse(res, 200, state);
      } catch (error) {
        const message = error instanceof Error ? error.message : "workspace unreachable";
        const apiStatus =
          error !== null &&
          typeof error === "object" &&
          "status" in error &&
          typeof error.status === "number"
            ? error.status
            : undefined;
        const status =
          apiStatus === 404 || message.includes("404") || message.includes("Not Found")
            ? 404
            : upstreamStatus(error);
        jsonResponse(
          res,
          status,
          { error: message },
          {
            route: "file-state",
            userId: user.userId,
            resourceId: resourceId ?? undefined,
            worktreeId: worktreeId ?? undefined,
            error: message,
            stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
          },
        );
      }
      return;
    }
    const actionMatch = /^\/worktrees\/([A-Za-z0-9-]+)\/(ready|reopen|merge|discard)$/.exec(
      subPath,
    );
    if (req.method === "POST" && actionMatch !== null) {
      const user = authenticatedUser(ctx);
      if (user === null) {
        jsonResponse(res, 401, { error: "workspace_connection_required" });
        return;
      }
      try {
        const summary = await ctx
          .get("univerWorkspace")!
          .transitionWorktree(
            user.userId,
            actionMatch[1]!,
            actionMatch[2] as "ready" | "reopen" | "merge" | "discard",
          );
        jsonResponse(res, 200, { worktree: summary });
      } catch (error) {
        jsonResponse(
          res,
          502,
          { error: error instanceof Error ? error.message : "workspace unreachable" },
          {
            route: "worktree-transition",
            worktreeId: actionMatch[1],
            action: actionMatch[2],
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
          },
        );
      }
      return;
    }
    jsonResponse(res, 404, { error: "not_found" });
  };
}

export const name = "univer-workspace-web";

// workspaceAuth/univerWorkspace resolve lazily per request via ctx.get.
export const inject = ["webServer", "univerWorkspace"];

export function apply(ctx: Context, config: WebServerConfig): void {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: CLIENT_CSS_PATH,
        handler: async (_req, res): Promise<void> => {
          try {
            const css = await readFile(new URL("./client.css", import.meta.url));
            res.writeHead(200, {
              "content-type": "text/css; charset=utf-8",
              "cache-control": "public, max-age=31536000, immutable",
            });
            res.end(css);
          } catch (error) {
            console.error("[uwh-web] unable to read compiled client stylesheet", error);
            jsonResponse(res, 500, { error: "client_stylesheet_unavailable" });
          }
        },
      }),
    "univer-workspace: compiled client stylesheet",
  );
  ctx.on("webserver/index-inject", (table) => {
    table.push({
      kind: "html",
      placement: "head",
      html: `<link rel="stylesheet" href="${CLIENT_CSS_URL}">`,
    });
  });
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: PREFIX,
        handler: createBrowserApiHandler(ctx, config),
      }),
    "univer-workspace: browser api routes",
  );
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: "/api/uwh",
        handler: createCapabilityHandler(ctx, config),
      }),
    "univer-workspace: capability-owned identity routes",
  );
}
