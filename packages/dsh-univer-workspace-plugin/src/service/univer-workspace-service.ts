/**
 * The Univer Workspace service: the capability plugin's own cordis Service
 * that sibling host plugins (tools, skills, web routes) consume. It mirrors
 * the Service/Provider layering of dsh-univer-office, on the remote-Unit
 * model.
 * @module dsh-univer-workspace-plugin/service
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { CollaborationRuntimeValue } from "@univer-cli/univer-collaboration-runtime";
import type {
  CreatedDocument, OpenedWorktreeUnit, WorktreeSummary,
} from "../provider/workspace-api.ts";
import type { WorkspaceRuntimeScope } from "../runtime/target.js";
import type { WorkspaceDocument, WorkspaceDocumentOpen, WorkspaceSpace } from "../shared/wire.ts";

/** The current User's accessible Univer Workspace Spaces, reconciled against dsh workspaces. */
export interface ReconciledSpaces {
  readonly spaces: readonly WorkspaceSpace[];
}

/** A session's resolved Space scope. */
export interface SpaceScope {
  readonly userId: string;
  readonly spaceId: string;
}

/** Input for creating a Univer document. */
export interface CreateDocumentInput {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly name: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
}

/** Input for running the Facade API against a Unit. */
export interface EditUnitInput {
  readonly scope: WorkspaceRuntimeScope;
  readonly unitId: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
  readonly revision: number;
  readonly code: string;
}

/** The public surface of the Univer Workspace capability service. */
export abstract class UniverWorkspaceService extends Service {
  constructor(ctx: Context) {
    super(ctx, "univerWorkspace");
  }

  /** List the current User's Spaces, reconciling each with a dsh workspace. */
  abstract listSpaces(userId: string): Promise<ReconciledSpaces>;

  /** List a Space's root documents. */
  abstract listDocuments(userId: string, spaceId: string): Promise<readonly WorkspaceDocument[]>;

  /** Open one Resource's editor descriptor. */
  abstract openDocument(userId: string, resourceId: string): Promise<WorkspaceDocumentOpen>;

  /** Create a Univer document in a Space. */
  abstract createDocument(userId: string, input: CreateDocumentInput): Promise<CreatedDocument>;

  /** Create a User Worktree. */
  abstract createWorktree(userId: string, input: { name: string; summary: string | null }): Promise<WorktreeSummary>;

  /** Add an existing trunk Resource to a Worktree. */
  abstract addWorktreeTrunkUnit(userId: string, worktreeId: string, resourceId: string): Promise<void>;

  /** Open a Worktree Unit. */
  abstract openWorktreeUnit(userId: string, worktreeId: string, unitId: string, mode: "draft" | "trunk" | "mergePreview"): Promise<OpenedWorktreeUnit>;

  /** Mark a Worktree ready to merge. */
  abstract markWorktreeReady(userId: string, worktreeId: string): Promise<WorktreeSummary>;

  /** Discard a Worktree. */
  abstract discardWorktree(userId: string, worktreeId: string): Promise<WorktreeSummary>;

  /** Merge a Worktree. */
  abstract mergeWorktree(userId: string, worktreeId: string): Promise<WorktreeSummary>;

  /** Read one Unit's data with the Facade API. */
  abstract readUnit(userId: string, input: EditUnitInput): Promise<CollaborationRuntimeValue>;

  /** Execute a write in Worktree scope and commit the resulting changeset. */
  abstract editUnit(userId: string, input: EditUnitInput): Promise<{ committed: boolean; value: CollaborationRuntimeValue; revision?: number }>;

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
