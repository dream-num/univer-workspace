/**
 * Shared host/client contract for the univer-workspace-harness core bundle.
 *
 * This module is imported by BOTH the node host half and the browser client
 * half, so it must stay free of node-only and browser-only references — it
 * carries only plain types and path constants. Authentication/session guard
 * routes live on the host; capability routes live in their owning plugin.
 */
/** Local host endpoints for the Workspace Device Authorization flow. */
export const UWH_DEVICE_START_PATH = "/auth/device/start";
export const UWH_DEVICE_COMPLETE_PATH = "/auth/device/complete";
export const UWH_DEVICE_LOGOUT_PATH = "/auth/device/logout";
export const UWH_OAUTH_START_PATH = "/auth/oauth/start";
export const UWH_OAUTH_CALLBACK_PATH = "/auth/oauth/callback";

/** Route path for the guarded browser prompt endpoint. */
export const UWH_SESSION_PROMPT_PATH = "/api/uwh/session-prompt";

/** The remote Workspace identity bound to one local Harness process. */
export interface UwhIdentity {
  /** Opaque Workspace user id (never used directly as a path segment). */
  userId: string;
  /** Human-readable username. */
  username: string;
  /** Optional display name. */
  displayName?: string;
}
