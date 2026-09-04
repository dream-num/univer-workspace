/**
 * The Univer Workspace service: the capability plugin's own cordis Service
 * that sibling host plugins (tools, skills, web routes) consume. It mirrors
 * the Service/Provider layering of dsh-univer-office, on the remote-Unit
 * model.
 * @module dsh-univer-workspace-plugin/service
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { CollaborationRuntimeValue, CollaborationUnitData } from "@univer-cli/univer-collaboration-runtime";
import type { ContentInspectionResult } from "@univer-cli/content-inspection";
import type {
  CreatedDocument, CreateWorktreeLocalUnitInput, OpenedWorktreeUnit, WorktreeStateView, WorktreeSummary, WorktreeUnitDescriptor,
} from "../provider/workspace-api.ts";
import type { WorkspaceRuntimeScope } from "../runtime/target.js";
import type { DocumentListOptions, WorkspaceDocument, WorkspaceDocumentOpen, WorkspaceSpace } from "../shared/wire.ts";
import type { DocumentFileState } from "../shared/state.ts";

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
  /** Optional expected head revision; omitted means synchronize to the current head. */
  readonly revision?: number;
  readonly code: string;
}

/** Input for the structured, read-only content inspection surface. */
export interface InspectUnitInput {
  readonly scope: WorkspaceRuntimeScope;
  readonly unitId: string;
  readonly unitType: "sheet" | "doc" | "slide" | "base" | "board";
  readonly revision?: number;
  /** Office-style selector, e.g. `'Sheet 1'!A1:D20`; omitted means overview. */
  readonly range?: string;
}

/** The public surface of the Univer Workspace capability service. */
export abstract class UniverWorkspaceService extends Service {
  constructor(ctx: Context) {
    super(ctx, "univerWorkspace");
  }

  /** List the current User's Spaces, reconciling each with a dsh workspace. */
  abstract listSpaces(userId: string): Promise<ReconciledSpaces>;

  /** List a Space's Nodes, with optional hierarchy/search/resource filters. */
  abstract listDocuments(userId: string, spaceId: string, options?: DocumentListOptions): Promise<readonly WorkspaceDocument[]>;

  /** Open one Resource's editor descriptor. */
  abstract openDocument(userId: string, resourceId: string): Promise<WorkspaceDocumentOpen>;

  /** Resolve a trunk Unit id to its Resource/Space descriptor for ACL checks. */
  abstract resolveUnitResource(userId: string, unitId: string): Promise<WorkspaceDocumentOpen>;

  /** Create a Univer document in a Space. */
  abstract createDocument(userId: string, input: CreateDocumentInput): Promise<CreatedDocument>;

  /** Create a User Worktree. */
  abstract createWorktree(userId: string, input: { name: string; summary: string | null }): Promise<WorktreeSummary>;

  /** Fetch a complete Worktree descriptor after a lifecycle mutation. */
  abstract getWorktreeDetail(userId: string, worktreeId: string): Promise<WorktreeStateView>;

  /** Add an existing trunk Resource to a Worktree and return its mapped Unit. */
  abstract addWorktreeTrunkUnit(userId: string, worktreeId: string, resourceId: string): Promise<WorktreeUnitDescriptor>;

  /** Create a new Unit owned by a Worktree. */
  abstract createWorktreeLocalUnit(userId: string, input: CreateWorktreeLocalUnitInput): Promise<WorktreeUnitDescriptor>;

  /** Open a Worktree Unit. */
  abstract openWorktreeUnit(userId: string, worktreeId: string, unitId: string, mode: "draft" | "trunk" | "mergePreview"): Promise<OpenedWorktreeUnit>;

  /** Mark a Worktree ready to merge. */
  abstract markWorktreeReady(userId: string, worktreeId: string): Promise<WorktreeSummary>;

  /** Discard a Worktree. */
  abstract discardWorktree(userId: string, worktreeId: string): Promise<WorktreeSummary>;

  /** Merge a Worktree. */
  abstract mergeWorktree(userId: string, worktreeId: string): Promise<WorktreeSummary>;

  /** Reopen a merged/discarded Worktree back to draft. */
  abstract reopenWorktree(userId: string, worktreeId: string): Promise<WorktreeSummary>;

  /** Collaboration state for one document (trunk viewer + related worktrees). */
  abstract getFileState(userId: string, resourceId: string): Promise<DocumentFileState>;

  /** Collaboration state for one worktree key (first unit anchors the viewer). */
  abstract getWorktreeFileState(userId: string, worktreeId: string): Promise<DocumentFileState>;

  /** Drive a review transition from the browser surfaces. */
  abstract transitionWorktree(userId: string, worktreeId: string, action: "ready" | "reopen" | "merge" | "discard"): Promise<WorktreeSummary>;

  /** Read one Unit's data with the Facade API. */
  abstract readUnit(userId: string, input: EditUnitInput): Promise<CollaborationRuntimeValue>;

  /** Inspect stable structured Unit content with the SDK inspection contract. */
  abstract inspectUnit(userId: string, input: InspectUnitInput): Promise<ContentInspectionResult>;

  /** Export synchronized UnitData for local Office conversion. */
  abstract exportUnitData(userId: string, input: {
    readonly scope: WorkspaceRuntimeScope;
    readonly unitId: string;
    readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
    readonly revision?: number;
  }): Promise<CollaborationUnitData>;

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
