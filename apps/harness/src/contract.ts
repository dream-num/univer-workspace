/**
 * Shared host/client contract for the univer-workspace-harness core bundle.
 *
 * This module is imported by BOTH the node host half and the browser client
 * half, so it must stay free of node-only and browser-only references — it
 * carries only plain types and path constants. Authentication/session guard
 * routes live on the host; capability routes live in their owning plugin.
 */
/** Route path that starts the OAuth login flow (redirects to the Workspace authorize endpoint). */
export const UWH_LOGIN_PATH = "/auth/login";

/** Route path the Workspace authorize endpoint redirects back to with the authorization code. */
export const UWH_CALLBACK_PATH = "/auth/callback";

/** Route path for the guarded browser prompt endpoint. */
export const UWH_SESSION_PROMPT_PATH = "/api/uwh/session-prompt";

/** The identity a signed session cookie carries, after validation. */
export interface UwhIdentity {
  /** Opaque Workspace user id (never used directly as a path segment). */
  userId: string;
  /** Human-readable username. */
  username: string;
  /** Optional display name. */
  displayName?: string;
}
