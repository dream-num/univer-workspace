/**
 * Shared host/client contract for the univer-workspace-harness core bundle.
 *
 * This module is imported by BOTH the node host half and the browser client
 * half, so it must stay free of node-only and browser-only references — it
 * carries only plain types and path constants. The route handlers live on the
 * host; the client fetches them. The workspace JSON view is deliberately a
 * plain object mirror of the wire Workspace view, not a `dsh-workspace`
 * entity, so the browser half never imports a host service.
 */
import type { WorkspaceId, WorkspaceView } from "@deepseek-ai/dsh-client-connection/client";

/** Route path that starts the OAuth login flow (redirects to the Workspace authorize endpoint). */
export const UWH_LOGIN_PATH = "/auth/login";

/** Route path the Workspace authorize endpoint redirects back to with the authorization code. */
export const UWH_CALLBACK_PATH = "/auth/callback";

/** Route path for the harness authenticated identity/workspace endpoint. */
export const UWH_ME_PATH = "/api/uwh/me";

/** Route path for the harness authenticated template-fork endpoint. */
export const UWH_TEMPLATE_FORK_PATH = "/api/uwh/template-fork";

/** Route path for the guarded browser prompt endpoint. */
export const UWH_SESSION_PROMPT_PATH = "/api/uwh/session-prompt";

/** Version tag written into the browser-local session state. */
export const UWH_STATE_VERSION = 1;

/** localStorage key namespace prefix (browser-local partition per user). */
export const UWH_STATE_KEY_PREFIX = "univer-workspace-harness:v1";

/** One configured template: a stable `key` the client stores its fork under,
 * the `sessionId` to fork on first use, and optional display metadata. */
export interface UwhTemplate {
  /** Stable template key (the localStorage `templateForks` map key). */
  key: string;
  /** Source session id that is forked on first use. */
  sessionId: string;
  /** Optional display label; falls back to `key`. */
  label?: string;
  /** Optional preset applied to a template fork (defaults to the deployment default). */
  agentPreset?: string;
  /** One-sentence description shown to the user. */
  description?: string;
}

/** The identity a signed session cookie carries, after validation. */
export interface UwhIdentity {
  /** Opaque Workspace user id (never used directly as a path segment). */
  userId: string;
  /** Human-readable username. */
  username: string;
  /** Optional display name. */
  displayName?: string;
}

/** Browser-local session state partitioned by user id. */
export interface UwhState {
  version: number;
  /** Template key -> the forked session created in THIS browser for THIS user. */
  templateForks: Record<string, string>;
  /** Session ids the current user created in THIS browser. */
  createdSessionIds: string[];
}

/** Full response of the harness identity route. */
export interface UwhMeView {
  identity: UwhIdentity;
  /** The per-user workspace this user is bound to (idempotently created). */
  workspace: WorkspaceView;
  /** Whether the configured admin list contains this user id. */
  admin: boolean;
  /** The effective workspace origin the harness is authenticated against. */
  workspaceOrigin: string;
  /** Templates configured for this deployment. */
  templates: UwhTemplate[];
}

/** Empty initial browser-local state for a user. */
export function emptyUwhState(): UwhState {
  return { version: UWH_STATE_VERSION, templateForks: {}, createdSessionIds: [] };
}

/** The local storage partition key for one user id. */
export function stateKeyFor(userId: string): string {
  return `${UWH_STATE_KEY_PREFIX}:${userId}`;
}

/** Read a branded WorkspaceId from a raw string (client never brands host ids). */
export function asWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId;
}

export type { WorkspaceId };
