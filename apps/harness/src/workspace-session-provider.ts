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

class WorkspaceSessionServiceImpl extends WorkspaceSessionService {
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

export const name = "univer-workspace-harness-session";

export function apply(ctx: Context, config: WorkspaceSessionConfig): void {
  new WorkspaceSessionServiceImpl(ctx, config);
}
