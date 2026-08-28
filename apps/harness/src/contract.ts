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

/** Prefix for authenticated Harness operations on Workspace Spaces. */
export const UWH_SPACES_PATH = "/api/uwh/spaces";

/** Browser-facing Space catalogue owned by the capability plugin. */
export const UNIVER_WORKSPACE_SPACES_PATH = "/univer-workspace/api/spaces";

/** Route path for the guarded browser prompt endpoint. */
export const UWH_SESSION_PROMPT_PATH = "/api/uwh/session-prompt";

/** A Workspace Space reconciled to its mechanical DSH Workspace carrier. */
export interface UwhWorkspaceSpace {
  readonly spaceId: string;
  readonly type: "personal" | "team";
  readonly name: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  readonly dshWorkspaceId: string;
}

/** Response returned by the capability plugin's authenticated Space list. */
export interface UwhWorkspaceSpaceList {
  readonly spaces: readonly UwhWorkspaceSpace[];
}

/** Narrow response returned after the Harness has renamed one Space. */
export interface UwhSpaceRenameResult {
  readonly space: {
    readonly spaceId: string;
    readonly name: string;
  };
}

/** One configured template: a stable `key`, the `sessionId` to fork on first
 * use, and optional display metadata. */
export interface UwhTemplate {
  /** Stable template key. */
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

/** Read a branded WorkspaceId from a raw string (client never brands host ids). */
export function asWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId;
}

export type { WorkspaceId };
