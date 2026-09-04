/**
 * Authentication-aware projections for the stock DSH list endpoints.
 *
 * The DSH WorkspaceBrowser remains the owner of rendering and interaction.
 * This seam only narrows the data returned by the two list RPCs so a browser
 * cannot receive another account's Workspace or Session rows merely because
 * the DSH registry is process-global.  The verified user's derived DSH root
 * is the account boundary; linked product Spaces and manually adopted child
 * Workspaces share that namespace.  The client-side snapshot projection is
 * still kept for host WebSocket frames, whose transport contract has no
 * request-cookie argument.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { toFetchHandler } from "@deepseek-ai/dsh-host-apiproxy";
import type {} from "@deepseek-ai/dsh-host-apiproxy";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-workspace";
import { parseCookies, parseSessionCookie } from "./auth.ts";
import { workspacePathFor } from "./identity.ts";

/** The only settings namespace whose browser writes are safe in a shared
 * harness process.  DSH's settings and credentials providers are profile
 * global; forwarding arbitrary namespaces would let one account change the
 * model/runtime configuration seen by every other account. */
export const HARNESS_SETTINGS_NAMESPACE = "univer-workspace-harness";

/** The one DSH product-onboarding field needed to dismiss the stock notice. */
export const ONBOARDING_SETTINGS_NAMESPACE = "ui-onboarding";
const ONBOARDING_ACK_FIELD = "welcomeNoticeVersion";

/** Settings namespaces owned by the two DSH model adapters.  These are the
 * only profile-global settings the local/dev harness may expose; all other
 * namespaces can change permissions, plugins, or host behavior for every
 * account and stay hidden behind the harness boundary. */
export const MODEL_SETTINGS_NAMESPACES = new Set(["llm-deepseek", "llm-pi-ai"]);

/** Every DSH unary route is claimed here so an authenticated request is the
 * only way to reach the process-global host services.  Keeping this list in
 * the harness (instead of changing DSH) also means the stock browser keeps its
 * complete interaction model. */
export const SCOPED_RPC_METHODS = [
  "session.list", "session.search", "session.create", "session.history", "session.models",
  "session.selectModel", "session.rename", "session.fork", "session.prompt", "session.attachment",
  "session.updateQueue", "session.cancel", "subagent.list", "subagent.history", "subagent.prompt",
  "subagent.interrupt", "host.describe", "host.pickDirectory", "host.listDirectory",
  "host.createDirectory", "host.openPath", "workspace.list", "workspace.create", "workspace.rename",
  "workspace.delete", "workspace.insertBefore", "workspace.insertSessionBefore", "workspace.archiveSession",
  "skill.list", "agentPreset.list", "agentPreset.select", "agentPreset.read", "agentPreset.copy",
  "agentPreset.openDocument", "agentPreset.remove", "goal.create", "goal.edit", "goal.pause", "goal.resume",
  "goal.complete", "goal.clear", "settings.describe", "settings.openDocument", "settings.update",
  "settings.replace", "settings.mutate", "credentials.describe", "credentials.set", "credentials.unset",
  "llm.providers", "llm.models", "llm.discoverModels",
] as const;
export type ScopedRpcMethod = typeof SCOPED_RPC_METHODS[number];
/** Exact API paths owned by the authenticated carrier. */
export const SCOPED_RPC_PATHS = new Set<string>(SCOPED_RPC_METHODS.map(method => `/api/${method}`));
const SESSION_EXPORT_PATH = "/api/session.export";
const LIST_BODY_LIMIT = 8 * 1024 * 1024;

export interface ScopedApiConfig {
  readonly workspaceRoot: string;
  readonly publicOrigin: string;
  /** Workspace origin allowed in the profile-global harness settings row. */
  readonly workspaceOrigin?: string;
  readonly sessionCookieName: string;
  readonly sessionSecret: string;
  /** Whether this deployment deliberately exposes profile-global model setup.
   * Production deployments should leave this false and inject the provider
   * credential through their secret manager; local single-user profiles can
   * opt in so the stock Models page remains usable. */
  readonly modelSettingsEnabled?: boolean;
}

interface RegistryWorkspace {
  readonly id: string;
  readonly path: string;
  readonly sessionIds: readonly string[];
}

export interface Scope {
  /** Canonical derived directory owned by the authenticated Workspace user. */
  readonly sessionRootPath: string;
  readonly workspaceIds: ReadonlySet<string>;
  readonly workspacePaths: ReadonlySet<string>;
  readonly sessionIds: ReadonlySet<string>;
  /** Optional richer indexes; kept optional so pure projection consumers remain backwards compatible. */
  readonly workspacePathById?: ReadonlyMap<string, string>;
  readonly workspaceSessionsById?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly sessionCwds?: ReadonlyMap<string, string | undefined>;
  /** System-owned presets available to every account. User-authored presets
   * live in the profile-global DSH home and are deliberately not exposed. */
  readonly agentPresetIds: ReadonlySet<string>;
  /** The profile default must also be one of the system-owned presets before
   * an unqualified session can be created. */
  readonly defaultAgentPresetId: string;
  /** Local/dev opt-in for the profile-global model settings surface. */
  readonly modelSettingsEnabled?: boolean;
  /** Deployment Workspace origin, when settings writes are enabled. */
  readonly allowedWorkspaceOrigin?: string;
}

interface RpcEnvelope {
  readonly result?: {
    readonly ok?: boolean;
    readonly value?: unknown;
  };
}

interface WorkspaceListValue {
  readonly items?: readonly Record<string, unknown>[];
  readonly archivedSessionIds?: readonly unknown[];
}

interface SessionListValue {
  readonly items?: readonly Record<string, unknown>[];
}

interface SessionSearchValue {
  readonly items?: readonly Record<string, unknown>[];
  readonly hasMore?: unknown;
}

interface SettingsDescribeValue {
  readonly namespaces?: readonly Record<string, unknown>[];
}

interface AgentPresetListValue {
  readonly presets?: readonly Record<string, unknown>[];
  readonly authorable?: unknown;
  readonly hasDocument?: unknown;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function isLoopback(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4
    && parts[0] === "127"
    && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}

/** Keep the same DNS-rebinding and cross-site fence as the DSH API carrier. */
export function trustedRequest(req: IncomingMessage, publicOrigin: string): boolean {
  const authority = header(req, "host");
  if (authority === undefined) return false;
  let host: URL;
  let configured: URL;
  try {
    host = new URL(`http://${authority}`);
    configured = new URL(publicOrigin);
  } catch {
    return false;
  }
  if (host.host !== configured.host && !isLoopback(host.hostname)) return false;
  if (header(req, "sec-fetch-site") === "cross-site") return false;
  const origin = header(req, "origin");
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== host.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Canonical lexical path used at the request boundary.  DSH registry paths
 * are realpath-normalized; resolving user input here closes `..` and repeated
 * separator escapes before any account comparison. */
export function normalizedPath(path: string): string {
  const value = path.replaceAll("\\", "/");
  return resolvePath(value);
}

function pathInWorkspace(paths: ReadonlySet<string>, candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate === "") return false;
  const path = normalizedPath(candidate);
  for (const root of paths) {
    const canonicalRoot = normalizedPath(root);
    if (path === canonicalRoot) return true;
    if (canonicalRoot === "/" ? path.startsWith("/") : path.startsWith(`${canonicalRoot}/`)) return true;
  }
  return false;
}

/** True for the account root itself and every canonical descendant. */
export function pathInUserRoot(rootPath: string, candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate === "") return false;
  const root = normalizedPath(rootPath);
  const path = normalizedPath(candidate);
  if (path === root) return true;
  return root === "/" ? path.startsWith("/") : path.startsWith(`${root}/`);
}

/**
 * Resolve an existing path (or the deepest existing parent plus its missing
 * suffix) through the filesystem.  Lexical `resolve()` is not enough for an
 * account boundary: a symlink below one user's root can otherwise point at a
 * different account or the host filesystem.  `undefined` means an ancestor
 * could not be resolved safely.
 */
export async function canonicalPath(path: string): Promise<string | undefined> {
  let candidate = normalizedPath(path);
  const missing: string[] = [];
  while (true) {
    try {
      const root = normalizedPath(await realpath(candidate));
      return normalizedPath(join(root, ...missing));
    } catch (error: unknown) {
      const code = error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (code !== "ENOENT" && code !== "ENOTDIR") return undefined;
      const parent = dirname(candidate);
      if (parent === candidate) return undefined;
      missing.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

/**
 * The DSH registry is process-global, while a harness account owns one
 * derived directory.  Keep every strict descendant of that directory (this
 * includes a manually adopted DSH Workspace), but never expose the private
 * root row itself.  Registry paths are canonicalized by DSH before they reach
 * this seam, so a separator-aware comparison is sufficient and avoids
 * platform-specific `node:path` code in the request handler.
 */
function visibleUserWorkspacePath(rootPath: string, candidate: unknown): string | undefined {
  if (typeof candidate !== "string" || candidate === "") return undefined;
  const root = normalizedPath(rootPath);
  const path = normalizedPath(candidate);
  if (path === root || !pathInUserRoot(root, path)) return undefined;
  return path;
}

function workspaceIdOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function sessionIdOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function workspaceViewAllowed(scope: Scope, item: Record<string, unknown>): boolean {
  const id = workspaceIdOf(item.workspaceId);
  if (id === undefined || !scope.workspaceIds.has(id)) return false;
  // The id is only a join key from this request's registry snapshot; the path
  // is the account boundary and prevents a stale/corrupt row from crossing it.
  if (scope.workspacePathById !== undefined) {
    const expected = scope.workspacePathById.get(id);
    if (expected === undefined) return false;
    return typeof item.path === "string" && normalizedPath(item.path) === normalizedPath(expected);
  }
  return pathInWorkspace(scope.workspacePaths, item.path);
}

function sessionViewAllowed(scope: Scope, item: Record<string, unknown>): boolean {
  const id = sessionIdOf(item.sessionId);
  // A cwd is authoritative whenever the Host supplied one.  The registry
  // membership is only a short-lived fallback for a just-created live row
  // whose session summary has not arrived yet; trusting an attached id after
  // a header is known would let a stale/corrupt Workspace record cross users.
  if (typeof item.cwd === "string" && item.cwd !== "") {
    return pathInUserRoot(scope.sessionRootPath, item.cwd);
  }
  return id !== undefined && scope.sessionIds.has(id);
}

export function ownWorkspace(scope: Scope, id: unknown): boolean {
  return typeof id === "string" && id !== "" && scope.workspaceIds.has(id);
}

export function ownSession(scope: Scope, id: unknown): boolean {
  if (typeof id !== "string" || id === "") return false;
  if (scope.sessionIds.has(id)) return true;
  // A newly-created Session can emit its first `session/event` before the
  // host/session-added frame updates the account-local id set.  buildScope
  // already indexed the live/durable header and its cwd, so use that
  // authoritative account-root check to avoid dropping the initial stream.
  const cwd = scope.sessionCwds?.get(id);
  return cwd !== undefined && pathInUserRoot(scope.sessionRootPath, cwd);
}

function ownSessionForWorkspace(scope: Scope, workspaceId: unknown, sessionId: unknown): boolean {
  if (typeof workspaceId !== "string" || typeof sessionId !== "string") return false;
  const sessions = scope.workspaceSessionsById?.get(workspaceId);
  return sessions !== undefined && sessions.has(sessionId) && scope.sessionIds.has(sessionId);
}

export function projectWorkspaceListValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as WorkspaceListValue;
  const items = Array.isArray(input.items)
    ? input.items.filter(item => workspaceViewAllowed(scope, item)).map(item => ({
      ...item,
      sessionIds: Array.isArray(item.sessionIds)
        ? (item.sessionIds as unknown[]).filter(sessionId => scope.sessionIds.has(String(sessionId)))
        : [],
    }))
    : [];
  return {
    ...input,
    items,
    archivedSessionIds: Array.isArray(input.archivedSessionIds)
      ? input.archivedSessionIds.filter(sessionId => scope.sessionIds.has(String(sessionId)))
      : [],
  };
}

export function projectSessionListValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as SessionListValue;
  return {
    ...input,
    items: Array.isArray(input.items) ? input.items.filter(item => sessionViewAllowed(scope, item)) : [],
  };
}

/**
 * Content search has no cwd in its wire result, so the session id is the only
 * safe join key.  `buildScope` accounts both registry attachments and
 * persisted headers below; this keeps ungrouped descendants searchable while
 * never forwarding a snippet belonging to another account.
 */
export function projectSessionSearchValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as SessionSearchValue;
  return {
    ...input,
    items: Array.isArray(input.items)
      ? input.items.filter(item => {
        const id = sessionIdOf(item.sessionId);
        return id !== undefined && scope.sessionIds.has(id);
      })
      : [],
  };
}

function projectHostDirectoryValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as {
    path?: unknown;
    home?: unknown;
    crumbs?: unknown;
    entries?: unknown;
    truncated?: unknown;
  };
  const path = typeof input.path === "string" && pathInUserRoot(scope.sessionRootPath, input.path)
    ? normalizedPath(input.path)
    : scope.sessionRootPath;
  const entries = Array.isArray(input.entries)
    ? input.entries.filter(entry => {
      if (entry === null || typeof entry !== "object") return false;
      const candidate = (entry as Record<string, unknown>).path;
      return pathInUserRoot(scope.sessionRootPath, candidate) && normalizedPath(String(candidate)) !== scope.sessionRootPath;
    }).map(entry => ({ ...(entry as Record<string, unknown>), path: normalizedPath(String((entry as Record<string, unknown>).path)) }))
    : [];
  const crumbs = Array.isArray(input.crumbs)
    ? input.crumbs.filter(crumb => crumb !== null && typeof crumb === "object" && pathInUserRoot(scope.sessionRootPath, (crumb as Record<string, unknown>).path))
      .map(crumb => ({ ...(crumb as Record<string, unknown>), path: normalizedPath(String((crumb as Record<string, unknown>).path)) }))
    : [];
  return { ...input, path, home: scope.sessionRootPath, crumbs, entries };
}

export function projectHostDescribeValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  // `attachedSessions` is a host-global count in DSH.  Returning it verbatim
  // would let one account infer activity belonging to every other account.
  // The exact live-agent subset is intentionally not part of the public host
  // contract, so cap the count at the sessions this scope can address.
  const attachedSessions = typeof input.attachedSessions === "number" && Number.isFinite(input.attachedSessions)
    ? Math.max(0, Math.min(Math.floor(input.attachedSessions), scope.sessionIds.size))
    : 0;
  return {
    ...input,
    cwd: scope.sessionRootPath,
    home: scope.sessionRootPath,
    attachedSessions,
  };
}

/** Keep the stock host picker shape while removing a path outside this user. */
export function projectHostPickDirectoryValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const selected = input.path;
  return {
    ...input,
    path: typeof selected === "string" && pathInUserRoot(scope.sessionRootPath, selected)
      ? normalizedPath(selected)
      : null,
  };
}

/** Project full-snapshot order responses before they reach the browser. */
export function projectWorkspaceOrderValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  return {
    ...input,
    workspaceIds: Array.isArray(input.workspaceIds)
      ? input.workspaceIds.filter(id => ownWorkspace(scope, id))
      : [],
  };
}

/** Project the registry-global archive snapshot to this account. */
export function projectArchivedSessionsValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  return {
    ...input,
    archivedSessionIds: Array.isArray(input.archivedSessionIds)
      ? input.archivedSessionIds.filter(id => ownSession(scope, id))
      : [],
  };
}

function projectSubagentListValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as { entries?: unknown };
  return {
    ...input,
    entries: Array.isArray(input.entries)
      ? input.entries.filter(entry => entry !== null && typeof entry === "object" && ownSession(scope, (entry as Record<string, unknown>).id))
      : [],
  };
}

/** Keep the stock settings shell usable without exposing process-global model
 * and plugin settings.  The harness namespace contains only the deployment
 * origin and is validated again on writes below. */
export function projectSettingsDescribeValue(value: unknown, modelSettingsEnabled = false): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as SettingsDescribeValue;
  return {
    ...input,
    namespaces: Array.isArray(input.namespaces)
      ? input.namespaces.filter(namespace => namespace.ns === HARNESS_SETTINGS_NAMESPACE
        || modelSettingsEnabled && (namespace.ns === ONBOARDING_SETTINGS_NAMESPACE
          || typeof namespace.ns === "string" && MODEL_SETTINGS_NAMESPACES.has(namespace.ns)))
      : [],
  };
}

/**
 * DSH's preset roster and user preset directory are profile-global.  A
 * shared harness exposes only deployment-owned (`system`) presets; otherwise
 * one Workspace user could read, author, or delete another user's preset.
 */
export function projectAgentPresetListValue(scope: Scope, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const input = value as AgentPresetListValue;
  const presets = Array.isArray(input.presets)
    ? input.presets.filter(preset => {
      const id = preset.id;
      return typeof id === "string" && scope.agentPresetIds.has(id) && preset.trust === "system";
    })
    : [];
  return {
    ...input,
    presets,
    authorable: false,
    hasDocument: false,
  };
}

function projectEnvelope(method: string, envelope: unknown, scope: Scope): unknown {
  if (envelope === null || typeof envelope !== "object") return envelope;
  const body = envelope as RpcEnvelope;
  if (body.result?.ok !== true) return envelope;
  let value = body.result.value;
  if (method === "workspace.list") value = projectWorkspaceListValue(scope, value);
  else if (method === "session.list") value = projectSessionListValue(scope, value);
  else if (method === "session.search") value = projectSessionSearchValue(scope, value);
  else if (method === "subagent.list") value = projectSubagentListValue(scope, value);
  else if (method === "host.describe") value = projectHostDescribeValue(scope, value);
  else if (method === "host.pickDirectory") value = projectHostPickDirectoryValue(scope, value);
  else if (method === "host.listDirectory") value = projectHostDirectoryValue(scope, value);
  else if (method === "workspace.insertBefore") value = projectWorkspaceOrderValue(scope, value);
  else if (method === "workspace.archiveSession") value = projectArchivedSessionsValue(scope, value);
  else if (method === "agentPreset.list") value = projectAgentPresetListValue(scope, value);
  else if (method === "settings.describe") value = projectSettingsDescribeValue(value, scope.modelSettingsEnabled === true);
  return {
    ...body,
    result: {
      ...body.result,
      value,
    },
  };
}

export interface ScopedAuthorizationError {
  readonly code:
    | "session-not-found"
    | "workspace-not-found"
    | "workspace-invalid-path"
    | "workspace-move-invalid"
    | "directory-unreadable"
    | "directory-create-failed"
    | "subagent-not-found"
    | "agent-preset-not-found"
    | "agent-preset-authoring-disabled"
    | "settings-rejected"
    | "credential-rejected";
  readonly message: string;
  readonly details: Record<string, unknown>;
}

export type ScopedAuthorization =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly error: ScopedAuthorizationError };

function deniedError(
  code: ScopedAuthorizationError["code"],
  message: string,
  details: Record<string, unknown>,
): ScopedAuthorization {
  return { ok: false, error: { code, message, details } };
}

function objectPayload(payload: unknown): Record<string, unknown> | undefined {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
}

function ownSystemAgentPreset(scope: Scope, value: unknown): boolean {
  return typeof value === "string" && value !== "" && scope.agentPresetIds.has(value);
}

function agentPresetDenied(
  code: "agent-preset-not-found" | "agent-preset-authoring-disabled",
  message: string,
  value: unknown,
): ScopedAuthorization {
  return deniedError(code, message, { agentPreset: String(value ?? "") });
}

function safeWorkspaceOriginValue(value: unknown, scope: Scope): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  if (scope.allowedWorkspaceOrigin === undefined) return false;
  try {
    const candidate = new URL(value).toString().replace(/\/$/u, "");
    const configured = new URL(scope.allowedWorkspaceOrigin).toString().replace(/\/$/u, "");
    return candidate === configured;
  } catch {
    return false;
  }
}

function authorizeHarnessSettingsPayload(
  method: string,
  input: Record<string, unknown>,
  scope: Scope,
): ScopedAuthorization {
  if (input.ns !== HARNESS_SETTINGS_NAMESPACE) {
    return deniedError("settings-rejected", "only the harness settings namespace is writable", { ns: String(input.ns ?? "") });
  }
  if (method === "settings.update" || method === "settings.replace") {
    const section = method === "settings.update" ? input.patch : input.section;
    if (section === null || typeof section !== "object" || Array.isArray(section)) {
      return deniedError("settings-rejected", "invalid harness settings section", {});
    }
    const values = section as Record<string, unknown>;
    const keys = Object.keys(values);
    if (keys.some(key => key !== "workspaceOrigin") || !safeWorkspaceOriginValue(values.workspaceOrigin, scope)) {
      return deniedError("settings-rejected", "workspace origin must equal the deployment origin", {});
    }
    return { ok: true, payload: input };
  }
  const ops = input.ops;
  if (!Array.isArray(ops) || ops.length === 0) {
    return deniedError("settings-rejected", "empty or invalid harness settings mutation", {});
  }
  for (const op of ops) {
    if (op === null || typeof op !== "object" || Array.isArray(op)) {
      return deniedError("settings-rejected", "invalid harness settings mutation", {});
    }
    const candidate = op as Record<string, unknown>;
    const path = candidate.path;
    if (!Array.isArray(path) || path.length !== 1 || path[0] !== "workspaceOrigin"
      || candidate.op !== "set" || !safeWorkspaceOriginValue(candidate.value, scope)) {
      return deniedError("settings-rejected", "workspace origin mutation is not allowed", {});
    }
  }
  return { ok: true, payload: input };
}

/**
 * The stock Models onboarding step owns this single profile-global fact.  It
 * is harmless to share, but the rest of the namespace must stay private so a
 * Workspace user cannot mutate unrelated DSH settings.
 */
function authorizeOnboardingSettingsPayload(input: Record<string, unknown>): ScopedAuthorization {
  const ops = input.ops;
  if (!Array.isArray(ops) || ops.length !== 1) {
    return deniedError("settings-rejected", "only one onboarding acknowledgement mutation is allowed", {});
  }
  const op = ops[0];
  if (op === null || typeof op !== "object" || Array.isArray(op)) {
    return deniedError("settings-rejected", "invalid onboarding acknowledgement mutation", {});
  }
  const candidate = op as Record<string, unknown>;
  const path = candidate.path;
  if (candidate.op !== "set" || !Array.isArray(path) || path.length !== 1
    || path[0] !== ONBOARDING_ACK_FIELD || typeof candidate.value !== "string"
    || candidate.value.length === 0 || candidate.value.length > 128) {
    return deniedError("settings-rejected", "only the onboarding acknowledgement field is writable", {});
  }
  return { ok: true, payload: input };
}

/**
 * Check one stock DSH request against the authenticated account scope.  This
 * function deliberately knows only ids and paths; it does not implement or
 * reinterpret DSH's protocol.  A successful result may return a rewritten
 * payload for the one safe default (`session.create` without a selector).
 */
export function authorizeScopedRequest(
  method: string,
  payload: unknown,
  scope: Scope,
): ScopedAuthorization {
  const input = objectPayload(payload);
  // Let the stock API proxy produce its canonical bad-request envelope for a
  // malformed payload.  ACL checks only run once the relevant address has the
  // expected object shape.
  if (input === undefined) return { ok: true, payload };

  if (method === "workspace.create") {
    const path = input.path;
    if (typeof path === "string" && pathInUserRoot(scope.sessionRootPath, path)
      && normalizedPath(path) !== normalizedPath(scope.sessionRootPath)) return { ok: true, payload: input };
    return deniedError("workspace-invalid-path", "workspace path is outside the authenticated user's root", { path: String(path ?? "") });
  }
  if (method === "workspace.rename" || method === "workspace.delete" || method === "workspace.insertBefore") {
    const workspaceId = input.workspaceId;
    if (!ownWorkspace(scope, workspaceId)) {
      return deniedError("workspace-not-found", "workspace does not belong to the authenticated user", { workspaceId: String(workspaceId ?? "") });
    }
    if (method === "workspace.insertBefore" && input.beforeWorkspaceId !== undefined
      && !ownWorkspace(scope, input.beforeWorkspaceId)) {
      return deniedError("workspace-not-found", "workspace anchor does not belong to the authenticated user", { workspaceId: String(input.beforeWorkspaceId) });
    }
    return { ok: true, payload: input };
  }
  if (method === "workspace.insertSessionBefore") {
    const workspaceId = input.workspaceId;
    const sessionId = input.sessionId;
    if (!ownWorkspace(scope, workspaceId) || !ownSessionForWorkspace(scope, workspaceId, sessionId)
      || (input.beforeSessionId !== undefined && !ownSessionForWorkspace(scope, workspaceId, input.beforeSessionId))) {
      return deniedError("workspace-move-invalid", "session is not accounted by the authenticated workspace", {
        workspaceId: String(workspaceId ?? ""),
        sessionId: String(sessionId ?? ""),
        ...(input.beforeSessionId === undefined ? {} : { beforeSessionId: String(input.beforeSessionId) }),
      });
    }
    return { ok: true, payload: input };
  }
  if (method === "workspace.archiveSession") {
    if (!ownSession(scope, input.sessionId)) {
      return deniedError("session-not-found", "session does not belong to the authenticated user", { sessionId: String(input.sessionId ?? "") });
    }
    return { ok: true, payload: input };
  }

  if (method === "session.create") {
    if (input.workspaceId !== undefined && !ownWorkspace(scope, input.workspaceId)) {
      return deniedError("workspace-not-found", "workspace does not belong to the authenticated user", { workspaceId: String(input.workspaceId) });
    }
    // DSH treats a supplied sessionId as an idempotent resume/reuse request,
    // not as an arbitrary caller-owned identifier.  Never let a browser use
    // that branch to resume another account's transcript.
    if (input.sessionId !== undefined && !ownSession(scope, input.sessionId)) {
      return deniedError("session-not-found", "session does not belong to the authenticated user", { sessionId: String(input.sessionId) });
    }
    if (input.agentPreset !== undefined && !ownSystemAgentPreset(scope, input.agentPreset)) {
      return agentPresetDenied("agent-preset-not-found", "agent preset is not available to the authenticated user", input.agentPreset);
    }
    if (input.agentPreset === undefined && !ownSystemAgentPreset(scope, scope.defaultAgentPresetId)) {
      return agentPresetDenied("agent-preset-not-found", "the profile default agent preset is not available", scope.defaultAgentPresetId);
    }
    if (input.cwd !== undefined) {
      if (typeof input.cwd !== "string" || !pathInUserRoot(scope.sessionRootPath, input.cwd)) {
        return deniedError("workspace-invalid-path", "session cwd is outside the authenticated user's root", { path: String(input.cwd ?? "") });
      }
    }
    // The stock Host default is the process cwd (`/tmp/...` in production),
    // which is not an account boundary.  Pin an omitted selector to the
    // authenticated user's derived root instead.
    if (input.workspaceId === undefined && input.cwd === undefined) {
      return { ok: true, payload: { ...input, cwd: scope.sessionRootPath } };
    }
    return { ok: true, payload: input };
  }

  const sessionAddressMethods = new Set([
    "session.history", "session.models", "session.selectModel", "session.rename", "session.fork",
    "session.prompt", "session.attachment", "session.updateQueue", "session.cancel",
    "skill.list", "agentPreset.select", "goal.create", "goal.edit", "goal.pause", "goal.resume", "goal.complete", "goal.clear",
  ]);
  if (sessionAddressMethods.has(method)) {
    if (!ownSession(scope, input.sessionId)) {
      return deniedError("session-not-found", "session does not belong to the authenticated user", { sessionId: String(input.sessionId ?? "") });
    }
    if (method === "agentPreset.select" && !ownSystemAgentPreset(scope, input.agentPreset)) {
      return agentPresetDenied("agent-preset-not-found", "agent preset is not available to the authenticated user", input.agentPreset);
    }
    return { ok: true, payload: input };
  }
  if (method.startsWith("subagent.")) {
    const parent = input.parentSessionId;
    const child = input.childSessionId;
    if (!ownSession(scope, parent) || (child !== undefined && !ownSession(scope, child))) {
      return deniedError("subagent-not-found", "subagent address does not belong to the authenticated user", {
        parentSessionId: String(parent ?? ""),
        ...(child === undefined ? {} : { childSessionId: String(child) }),
      });
    }
    return { ok: true, payload: input };
  }
  if (method.startsWith("host.")) {
    if (method === "host.listDirectory" || method === "host.openPath") {
      if (method === "host.listDirectory" && input.path === undefined) {
        return { ok: true, payload: { ...input, path: scope.sessionRootPath } };
      }
      if (input.path !== undefined && (typeof input.path !== "string" || !pathInUserRoot(scope.sessionRootPath, input.path))) {
        return deniedError("directory-unreadable", "directory path is outside the authenticated user's root", { path: String(input.path ?? "") });
      }
    } else if (method === "host.createDirectory") {
      const path = input.path;
      const name = input.name;
      if (typeof path !== "string" || !pathInUserRoot(scope.sessionRootPath, path)
        || typeof name !== "string" || name === "" || name === "." || name === ".." || /[\\/]/u.test(name)) {
        return deniedError("directory-create-failed", "directory target is outside the authenticated user's root", { path: String(path ?? "") });
      }
    }
    return { ok: true, payload: input };
  }

  if (method === "agentPreset.read") {
    if (!ownSystemAgentPreset(scope, input.agentPreset)) {
      return agentPresetDenied("agent-preset-not-found", "agent preset is not available to the authenticated user", input.agentPreset);
    }
    return { ok: true, payload: input };
  }
  if (method === "agentPreset.copy" || method === "agentPreset.openDocument" || method === "agentPreset.remove") {
    return agentPresetDenied(
      "agent-preset-authoring-disabled",
      "profile-global agent preset authoring is disabled in the shared harness",
      input.agentPreset ?? input.from,
    );
  }

  // Settings and credentials are profile-global DSH services.  The harness
  // origin namespace is always safe and constrained to the deployment origin
  // so one account cannot redirect all other users' Workspace calls.  Model
  // namespaces/credentials are a deliberate local-dev opt-in: the stock DSH
  // Models page is the supported way to recover a key that was configured in
  // an isolated profile.  Every other global namespace remains denied.
  if (method === "settings.update" || method === "settings.replace" || method === "settings.mutate") {
    if (input.ns === HARNESS_SETTINGS_NAMESPACE) return authorizeHarnessSettingsPayload(method, input, scope);
    if (method === "settings.mutate" && input.ns === ONBOARDING_SETTINGS_NAMESPACE) {
      if (scope.modelSettingsEnabled === true) return authorizeOnboardingSettingsPayload(input);
      return deniedError("settings-rejected", "onboarding settings are not exposed by the shared harness", {});
    }
    if (scope.modelSettingsEnabled === true && typeof input.ns === "string" && MODEL_SETTINGS_NAMESPACES.has(input.ns)) {
      return { ok: true, payload: input };
    }
    return deniedError("settings-rejected", "only the harness or enabled model settings namespace is writable", { ns: String(input.ns ?? "") });
  }
  if (method === "settings.openDocument") {
    return deniedError("settings-rejected", "the shared settings document is not exposed", {});
  }
  if (method === "credentials.describe" || method === "credentials.set" || method === "credentials.unset") {
    if (scope.modelSettingsEnabled === true) return { ok: true, payload: input };
    return deniedError("credential-rejected", "profile-global credentials are not exposed by the shared harness", {});
  }

  // Lists, skills, presets, and the read-only LLM catalog are still behind the
  // harness authentication route.  Their domain implementations own payload
  // validation; no account id is accepted here.
  return { ok: true, payload: input };
}

/**
 * Canonicalize path-bearing payloads before the synchronous ACL check.  The
 * DSH schemas remain the source of malformed-payload errors; this helper only
 * changes valid string paths and rejects paths whose real ancestor escapes the
 * authenticated root.
 */
async function canonicalizeScopedPayload(
  method: string,
  payload: unknown,
  scope: Scope,
): Promise<ScopedAuthorization> {
  const input = objectPayload(payload);
  if (input === undefined) return { ok: true, payload };
  const pathKey = method === "workspace.create"
    ? "path"
    : method === "session.create"
      ? "cwd"
      : method === "host.listDirectory" || method === "host.openPath" || method === "host.createDirectory"
        ? "path"
        : undefined;
  if (pathKey === undefined || input[pathKey] === undefined || typeof input[pathKey] !== "string") {
    return { ok: true, payload: input };
  }
  const canonical = await canonicalPath(input[pathKey]);
  if (canonical === undefined || !pathInUserRoot(scope.sessionRootPath, canonical)) {
    const code: ScopedAuthorizationError["code"] = method === "workspace.create"
      ? "workspace-invalid-path"
      : method === "host.listDirectory" || method === "host.openPath"
        ? "directory-unreadable"
        : method === "host.createDirectory"
          ? "directory-create-failed"
          : "workspace-invalid-path";
    return deniedError(code, "path is outside the authenticated user's root", {
      path: String(input[pathKey]),
    });
  }
  return { ok: true, payload: { ...input, [pathKey]: canonical } };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > LIST_BODY_LIMIT) throw new Error("list request body is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function requestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    // The body may be rewritten (session.create's default cwd), so forwarding
    // hop-by-hop framing headers would make the in-process Request truncate or
    // reject the new JSON payload.
    if (name === "content-length" || name === "transfer-encoding" || name === "connection" || name === "host") continue;
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(","));
  }
  return headers;
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, headers);
  res.end(body);
}

function carrierErrorResponse(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error }));
}

function rpcErrorBody(rpcId: unknown, error: ScopedAuthorizationError): Record<string, unknown> {
  return {
    type: "server-response",
    rpcId: typeof rpcId === "string" ? rpcId : "invalid-request",
    result: { ok: false, error },
  };
}

function businessErrorResponse(res: ServerResponse, rpcId: unknown, error: ScopedAuthorizationError): void {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(rpcErrorBody(rpcId, error)));
}

export async function buildScope(
  ctx: Context,
  config: ScopedApiConfig,
  userId: string,
): Promise<Scope> {
  const derived = workspacePathFor(config.workspaceRoot, userId);
  if (!derived.ok) throw new Error(derived.reason);
  const canonicalRoot = await canonicalPath(derived.path);
  if (canonicalRoot === undefined) throw new Error("authenticated workspace root could not be resolved");
  const registry = ctx.get("workspaceRegistry") as unknown as { list(): readonly RegistryWorkspace[] };
  const workspaceIds = new Set<string>();
  const workspacePaths = new Set<string>();
  const workspacePathById = new Map<string, string>();
  const workspaceSessionsById = new Map<string, ReadonlySet<string>>();
  const sessionIds = new Set<string>();
  const sessionCwds = new Map<string, string | undefined>();
  const agentPresetIds = new Set<string>();
  const agentPresets = ctx.get("agentPresets") as unknown as {
    list?: () => Promise<readonly { id?: unknown; trust?: unknown }[]>;
    defaultId?: unknown;
  } | undefined;
  if (agentPresets?.list === undefined || typeof agentPresets.defaultId !== "string" || agentPresets.defaultId === "") {
    throw new Error("agent preset roster is unavailable");
  }
  for (const preset of await agentPresets.list()) {
    if (typeof preset.id === "string" && preset.id !== "" && preset.trust === "system") agentPresetIds.add(preset.id);
  }
  for (const workspace of registry.list()) {
    const id = String(workspace.id);
    const canonicalWorkspacePath = await canonicalPath(workspace.path);
    const path = visibleUserWorkspacePath(canonicalRoot, canonicalWorkspacePath);
    if (path === undefined) continue;
    // Do not require a product Space link here.  The stock DSH “Add
    // workspace” action is allowed to adopt any directory in this user's
    // namespace; linked Space ids are still enforced by the capability tools.
    workspaceIds.add(id);
    workspacePaths.add(path);
    const members = new Set<string>();
    for (const sessionId of workspace.sessionIds) {
      const value = String(sessionId);
      members.add(value);
      sessionIds.add(value);
    }
    workspacePathById.set(id, path);
    workspaceSessionsById.set(id, members);
  }
  // A session can temporarily be ungrouped (for example after its Workspace
  // record was removed) while still living below a linked Space directory.
  // Keep it visible/searchable by consulting the durable header catalogue,
  // without exposing the process-global registry's unrelated cwd entries.
  const persistence = ctx.get("sessionPersistence") as unknown as {
    list(signal?: AbortSignal): Promise<readonly { id: unknown; cwd?: unknown }[]>;
  } | undefined;
  if (persistence !== undefined) {
    const headers = await persistence.list();
    for (const header of headers) {
      const id = sessionIdOf(header.id);
      if (id === undefined) continue;
      const cwd = typeof header.cwd === "string" && header.cwd !== "" ? await canonicalPath(header.cwd) : undefined;
      sessionCwds.set(id, cwd);
      // Include ungrouped sessions as well as sessions still attached to a
      // Workspace.  Workspace deletion intentionally preserves its sessions,
      // and the native browser renders those rows under Ungrouped.
      if (cwd !== undefined && pathInUserRoot(canonicalRoot, cwd)) sessionIds.add(id);
    }
  }
  // A newly-created live session can be visible before persistence has
  // flushed its header.  Use the live list as a bounded second source, while
  // retaining the cwd check whenever it is available.
  const liveSessions = ctx.get("sessions") as unknown as {
    list?: () => readonly { id?: unknown; header?: { cwd?: unknown } }[];
  } | undefined;
  for (const session of liveSessions?.list?.() ?? []) {
    const id = sessionIdOf(session.id);
    if (id === undefined) continue;
    const rawCwd = session.header?.cwd;
    const cwd = typeof rawCwd === "string" && rawCwd !== "" ? await canonicalPath(rawCwd) : undefined;
    if (!sessionCwds.has(id)) sessionCwds.set(id, cwd);
    if (cwd !== undefined && pathInUserRoot(canonicalRoot, cwd)) sessionIds.add(id);
  }
  // Remove registry attachments whose durable header proves they belong to a
  // different account. Unknown ids remain temporarily so a host/session frame
  // race cannot make a newly-created own session disappear before its header
  // is indexed.
  for (const [id, cwd] of sessionCwds) {
    if (cwd !== undefined && !pathInUserRoot(canonicalRoot, cwd)) sessionIds.delete(id);
  }
  return {
    sessionRootPath: canonicalRoot,
    workspaceIds,
    workspacePaths,
    sessionIds,
    workspacePathById,
    workspaceSessionsById,
    sessionCwds,
    agentPresetIds,
    defaultAgentPresetId: agentPresets.defaultId,
    modelSettingsEnabled: config.modelSettingsEnabled === true,
    ...(config.workspaceOrigin === undefined ? {} : { allowedWorkspaceOrigin: config.workspaceOrigin }),
  };
}

interface ClientRequestBody {
  readonly type?: unknown;
  readonly rpcId?: unknown;
  readonly method?: unknown;
  readonly payload?: unknown;
}

function parseClientRequestBody(body: Buffer): ClientRequestBody | undefined {
  if (body.byteLength === 0) return undefined;
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as ClientRequestBody
      : undefined;
  } catch {
    return undefined;
  }
}

/** Register every stock DSH unary route behind the harness account boundary. */
export function registerScopedListRoutes(ctx: Context, config: ScopedApiConfig): Array<() => void> {
  const webServer = ctx.get("webServer") as Context["webServer"];

  const handlePost = (method: ScopedRpcMethod) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!trustedRequest(req, config.publicOrigin)) {
      carrierErrorResponse(res, 403, "forbidden");
      return;
    }
    if (req.method !== "POST") {
      carrierErrorResponse(res, 405, "method_not_allowed");
      return;
    }
    const identity = parseSessionCookie(
      parseCookies(req.headers.cookie).get(config.sessionCookieName),
      config.sessionSecret,
    );
    if (identity === undefined) {
      carrierErrorResponse(res, 401, "missing_or_invalid_session");
      return;
    }
    let scope: Scope;
    try {
      scope = await buildScope(ctx, config, identity.userId);
    } catch (error: unknown) {
      console.warn("univer-workspace-harness: scoped RPC reconciliation failed:", error);
      carrierErrorResponse(res, 503, "workspace_scope_unavailable");
      return;
    }
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      carrierErrorResponse(res, 413, "request_body_too_large");
      return;
    }

    const message = parseClientRequestBody(body);
    let forwardBody = body;
    if (message?.type === "client-request" && message.method === method) {
      const canonical = await canonicalizeScopedPayload(method, message.payload, scope);
      if (!canonical.ok) {
        businessErrorResponse(res, message.rpcId, canonical.error);
        return;
      }
      const authorization = authorizeScopedRequest(method, canonical.payload, scope);
      if (!authorization.ok) {
        businessErrorResponse(res, message.rpcId, authorization.error);
        return;
      }
      if (authorization.payload !== message.payload) {
        forwardBody = Buffer.from(JSON.stringify({ ...message, payload: authorization.payload }), "utf8");
      }
    }

    const proxy = ctx.get("apiProxy");
    if (proxy === undefined) {
      carrierErrorResponse(res, 503, "api_proxy_unavailable");
      return;
    }
    try {
      const request = new Request(`http://dsh.internal/api/${method}`, {
        method: "POST",
        headers: requestHeaders(req),
        ...(forwardBody.byteLength === 0 ? {} : { body: forwardBody.toString("utf8") }),
      });
      const response = await toFetchHandler(proxy).fetch(request);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("json")) {
        await writeResponse(res, response);
        return;
      }
      const text = await response.text();
      let envelope: unknown;
      try {
        envelope = JSON.parse(text) as unknown;
      } catch {
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(text);
        return;
      }
      const projected = projectEnvelope(method, envelope, scope);
      res.writeHead(response.status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(projected));
    } catch (error: unknown) {
      carrierErrorResponse(res, 500, `scoped_rpc_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleExport = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!trustedRequest(req, config.publicOrigin)) {
      carrierErrorResponse(res, 403, "forbidden");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      carrierErrorResponse(res, 405, "method_not_allowed");
      return;
    }
    const identity = parseSessionCookie(
      parseCookies(req.headers.cookie).get(config.sessionCookieName),
      config.sessionSecret,
    );
    if (identity === undefined) {
      carrierErrorResponse(res, 401, "missing_or_invalid_session");
      return;
    }
    let scope: Scope;
    try {
      scope = await buildScope(ctx, config, identity.userId);
    } catch {
      carrierErrorResponse(res, 503, "workspace_scope_unavailable");
      return;
    }
    const url = new URL(req.url ?? SESSION_EXPORT_PATH, "http://dsh.internal");
    const sessionId = url.searchParams.get("sessionId");
    if (!ownSession(scope, sessionId)) {
      carrierErrorResponse(res, 404, "not_found");
      return;
    }
    const proxy = ctx.get("apiProxy");
    if (proxy === undefined) {
      carrierErrorResponse(res, 503, "api_proxy_unavailable");
      return;
    }
    try {
      const response = await toFetchHandler(proxy).fetch(new Request(`http://dsh.internal${url.pathname}${url.search}`, {
        method: req.method,
        headers: requestHeaders(req),
      }));
      await writeResponse(res, response);
    } catch (error: unknown) {
      carrierErrorResponse(res, 500, `scoped_export_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const routes = SCOPED_RPC_METHODS.map(method => webServer.register({
    kind: "exact",
    path: `/api/${method}`,
    handler: handlePost(method),
  }));
  routes.push(webServer.register({ kind: "exact", path: SESSION_EXPORT_PATH, handler: handleExport }));
  return routes;
}
