/**
 * The `workspaceSession` service: the seam the capability plugin consumes to
 * learn which Workspace User the current browser request belongs to, without
 * holding the harness session-signing secret.
 *
 * The harness core owns authentication and this service resolves the signed
 * harness session cookie into the verified Workspace identity; sibling
 * plugins only receive the resolved identity.
 * @module @univerjs/univer-workspace-harness/workspace-session
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { UwhIdentity } from "./contract.ts";

/** The public surface of the workspaceSession service. */
export abstract class WorkspaceSessionService extends Service {
  constructor(ctx: Context) {
    super(ctx, "workspaceSession");
  }

  /** Resolve the verified identity for a request, or `undefined` when unauthenticated. */
  abstract currentUser(cookieHeader: string | undefined): UwhIdentity | undefined;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    workspaceSession: WorkspaceSessionService;
  }
}
