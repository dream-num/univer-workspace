/**
 * The `workspaceAuth` service: the seam sibling plugins (the capability
 * plugin) consume to reach the effective Workspace origin and to obtain an
 * authenticated HTTP client for the authorizing User.
 *
 * The harness core owns the credential store and the origin settings
 * namespace; this service only exposes reads and per-User clients. A client
 * is unavailable for a user with no stored (or expired) credential, in which
 * case the caller must direct the user back through the OAuth login flow.
 * @module @univerjs/univer-workspace-harness/workspace-auth
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";

/** The Workspace session cookie name the Workspace product uses. */
export const WORKSPACE_SESSION_COOKIE = "workspace_session";

/** An authenticated client bound to one user's Workspace credential. */
export interface WorkspaceHttpClient {
  /** The effective Workspace origin this client calls. */
  readonly origin: string;
  /**
   * Perform an authenticated request on the Workspace origin. The user's
   * `workspace_session` cookie is attached; mutating calls also carry the
   * origin header. The request rejects when the stored credential is absent
   * or has expired, and resolves to a 401 response when the Workspace has
   * rejected the credential.
   */
  request(path: string, init?: RequestInit): Promise<Response>;
}

/** The public surface of the workspaceAuth service. */
export abstract class WorkspaceAuthService extends Service {
  constructor(ctx: Context) {
    super(ctx, "workspaceAuth");
  }

  /** The effective Workspace origin (composition base overridden by settings). */
  abstract effectiveOrigin(): string;

  /** Whether a non-expired credential is stored for the user. */
  abstract hasCredential(userId: string): boolean;

  /** An authenticated client for the user, or `undefined` without a valid credential. */
  abstract clientFor(userId: string): WorkspaceHttpClient | undefined;

  /** Persist (or replace) the user's Workspace session credential. */
  abstract storeCredential(userId: string, token: string, expiresAtMs: number): Promise<void>;

  /** Remove the user's Workspace session credential. */
  abstract clearCredential(userId: string): Promise<void>;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    workspaceAuth: WorkspaceAuthService;
  }
}
