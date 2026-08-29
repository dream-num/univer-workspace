/**
 * The capability plugin's browser-facing API routes.
 *
 * Registered on the DSH web server (no separate gateway): JSON state for the
 * current User's Spaces, guarded by the harness session cookie through the
 * workspaceSession service. The prefix route dispatches on the sub-path.
 * @module dsh-univer-workspace-plugin/webServer
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionEvent, SessionId } from "@deepseek-ai/dsh-session";
import type { Workspace } from "@deepseek-ai/dsh-workspace";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "../provider/workspace-contract.ts";
import { userDirectoryPath } from "../provider/workspace-contract.ts";
import {
  WORKSPACE_ME_PATH,
  WORKSPACE_TEMPLATE_FORK_PATH,
  type WorkspaceTemplate,
} from "../client/workspace-contract.ts";

const PREFIX = "/univer-workspace/api";

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

function jsonResponse(res: ServerResponse, status: number, body: unknown, details?: Record<string, unknown>): void {
  let output = body;
  if (status >= 500) {
    const diagnosticId = randomUUID();
    console.error(`[uwh-web] ${JSON.stringify({
      event: "http-error",
      diagnosticId,
      status,
      ...details,
      body: typeof body === "string" ? body : undefined,
      at: new Date().toISOString(),
    })}`);
    output = body !== null && typeof body === "object" && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), diagnosticId }
      : { error: String(body), diagnosticId };
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(output));
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
  if (host.host !== configured.host && host.hostname !== "localhost" && !host.hostname.startsWith("127.")) return false;
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
    return text.trim() === "" ? {} : JSON.parse(text) as unknown;
  })();
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

async function ensureUserWorkspace(ctx: Context, config: WebServerConfig, userId: string, title: string): Promise<Workspace> {
  const path = userDirectoryPath(config.workspaceRoot, userId);
  await mkdir(path, { recursive: true });
  const registry = ctx.get("workspaceRegistry") as {
    resolveByPath(path: string): Promise<Workspace | undefined>;
    create(path: string, title?: string): Promise<Workspace>;
  };
  return await registry.resolveByPath(path) ?? await registry.create(path, title);
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

async function templateFork(ctx: Context, config: WebServerConfig, userId: string, template: WorkspaceTemplate): Promise<string> {
  const persistence = ctx.get("sessionPersistence") as { load(id: SessionId): Promise<{ events: readonly SessionEvent[] }> };
  const sessions = ctx.get("sessions") as { create(id: SessionId, options: { seed: readonly SessionEvent[]; meta: Record<string, unknown> }): unknown };
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
      ...(template.agentPreset === undefined || template.agentPreset === "" ? {} : { agentPreset: template.agentPreset }),
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
function createCapabilityHandler(ctx: Context, config: WebServerConfig): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (!trustedRequest(req, config.publicOrigin)) {
      jsonResponse(res, 403, { error: "forbidden" });
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
    const user = authenticatedUser(ctx, req);
    if (user === null) {
      jsonResponse(res, 401, { error: "missing_or_invalid_session" });
      return;
    }

    if (pathname === WORKSPACE_ME_PATH) {
      if (req.method !== "GET") {
        jsonResponse(res, 405, { error: "method_not_allowed" });
        return;
      }
      try {
        const workspace = await ensureUserWorkspace(ctx, config, user.userId, user.displayName);
        jsonResponse(res, 200, {
          identity: { userId: user.userId, username: user.displayName, displayName: user.displayName },
          workspace: workspaceView(workspace),
          admin: false,
          workspaceOrigin: config.workspaceOrigin,
          templates: config.templates,
        });
      } catch (error) {
        jsonResponse(res, 502, { error: "workspace_unavailable" }, { route: "identity", error: String(error) });
      }
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
      const key = payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).key
        : undefined;
      const template = typeof key === "string" ? config.templates.find(item => item.key === key) : undefined;
      if (template === undefined) {
        jsonResponse(res, 404, { error: "template_not_configured" });
        return;
      }
      try {
        jsonResponse(res, 200, { sessionId: await templateFork(ctx, config, user.userId, template) });
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
      const auth = ctx.get("workspaceAuth") as { clientFor(userId: string): { request(path: string, init?: RequestInit): Promise<Response> } | undefined } | undefined;
      const client = auth?.clientFor(user.userId);
      if (client === undefined) {
        jsonResponse(res, 401, { error: "workspace_authentication_required" });
        return;
      }
      try {
        const path = `/api/spaces/${encodeURIComponent(spaceId)}`;
        const current = await client.request(path, { headers: { accept: "application/json" } });
        if (current.status === 401) return jsonResponse(res, 401, { error: "workspace_authentication_required" });
        if (current.status === 404) return jsonResponse(res, 404, { error: "space_not_found" });
        if (!current.ok) return jsonResponse(res, 502, { error: "workspace_unavailable" });
        const currentBody = await current.json() as { id?: unknown; capabilities?: { renameSpace?: unknown } };
        if (currentBody.id !== spaceId) return jsonResponse(res, 502, { error: "workspace_unavailable" });
        if (currentBody.capabilities?.renameSpace !== true) return jsonResponse(res, 403, { error: "space_rename_forbidden" });
        const updated = await client.request(path, {
          method: "PATCH",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ name: parsed.name }),
        });
        if (updated.status === 400) return jsonResponse(res, 400, { error: "space_name_invalid" });
        if (updated.status === 401) return jsonResponse(res, 401, { error: "workspace_authentication_required" });
        if (updated.status === 403) return jsonResponse(res, 403, { error: "space_rename_forbidden" });
        if (updated.status === 404) return jsonResponse(res, 404, { error: "space_not_found" });
        if (!updated.ok) return jsonResponse(res, 502, { error: "workspace_unavailable" });
        const body = await updated.json() as { id?: unknown; name?: unknown };
        if (body.id !== spaceId || typeof body.name !== "string" || body.name === "") return jsonResponse(res, 502, { error: "workspace_unavailable" });
        jsonResponse(res, 200, { space: { spaceId, name: body.name } });
      } catch (error) {
        jsonResponse(res, 502, { error: "workspace_unavailable" }, { route: "space-rename", error: String(error) });
      }
      return;
    }
    jsonResponse(res, 404, { error: "not_found" });
  };
}

function upstreamStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/workspace credential is missing|workspace authentication required|sign in again/iu.test(message)) return 401;
  if (error !== null && typeof error === "object" && "status" in error
    && typeof error.status === "number" && error.status >= 400 && error.status < 600) {
    return error.status;
  }
  return 502;
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
        const status = upstreamStatus(error);
        jsonResponse(res, status, { error: error instanceof Error ? error.message : "workspace unreachable" }, {
          route: "spaces",
          userId: user.userId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
        });
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
        const status = apiStatus === 404 || message.includes("404") || message.includes("Not Found") ? 404 : upstreamStatus(error);
        jsonResponse(res, status, { error: message }, {
          route: "file-state",
          userId: user.userId,
          resourceId: resourceId ?? undefined,
          worktreeId: worktreeId ?? undefined,
          error: message,
          stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
        });
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
        jsonResponse(res, 502, { error: error instanceof Error ? error.message : "workspace unreachable" }, {
          route: "worktree-transition",
          worktreeId: actionMatch[1],
          action: actionMatch[2],
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
        });
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
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/api/uwh",
    handler: createCapabilityHandler(ctx, config),
  }), "univer-workspace: capability-owned identity routes");
}
