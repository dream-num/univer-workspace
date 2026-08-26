/**
 * The Univer Workspace service: the capability plugin's own cordis Service
 * that sibling host plugins (tools, skills, web routes) consume. It mirrors
 * the Service/Provider layering of dsh-univer-office, on the remote-Unit
 * model.
 * @module dsh-univer-workspace-plugin/service
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { WorkspaceSpace } from "../shared/wire.ts";

/** The current User's accessible Univer Workspace Spaces, reconciled against dsh workspaces. */
export interface ReconciledSpaces {
  readonly spaces: readonly WorkspaceSpace[];
}

/** A session's resolved Space scope. */
export interface SpaceScope {
  readonly userId: string;
  readonly spaceId: string;
}

/** The public surface of the Univer Workspace capability service. */
export abstract class UniverWorkspaceService extends Service {
  constructor(ctx: Context) {
    super(ctx, "univerWorkspace");
  }

  /** List the current User's Spaces, reconciling each with a dsh workspace. */
  abstract listSpaces(userId: string): Promise<ReconciledSpaces>;

  /**
   * Resolve a session's Space scope from its working directory. The dsh
   * workspace registry canonicalizes the path; the space-links table then
   * yields `{ userId, spaceId }`.
   */
  abstract resolveSpaceForSession(cwd: string): Promise<SpaceScope | undefined>;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    univerWorkspace: UniverWorkspaceService;
  }
}
