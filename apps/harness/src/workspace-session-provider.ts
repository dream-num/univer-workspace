/**
 * Concrete `workspaceSession` service: resolves the signed harness session
 * cookie into a verified Workspace identity for sibling plugins.
 * @module @univerjs/univer-workspace-harness/workspace-session-provider
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import { parseCookies, parseSessionCookie } from "./auth.ts";
import type { UwhIdentity } from "./contract.ts";
import { WorkspaceSessionService } from "./workspace-session.ts";

export interface WorkspaceSessionConfig {
  sessionCookieName: string;
  sessionSecret: string;
}

/** The class-plugin provider for the workspaceSession service. */
export class WorkspaceSessionProvider extends WorkspaceSessionService {
  static readonly inject: string[] = [];

  constructor(
    ctx: Context,
    private readonly config: WorkspaceSessionConfig,
  ) {
    super(ctx);
  }

  currentUser(cookieHeader: string | undefined): UwhIdentity | undefined {
    return parseSessionCookie(
      parseCookies(cookieHeader).get(this.config.sessionCookieName),
      this.config.sessionSecret,
    );
  }
}
