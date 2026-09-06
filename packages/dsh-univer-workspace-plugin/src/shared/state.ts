/**
 * Worktree state wire types shared by the plugin's host routes and browser
 * surfaces — the remote-Workspace counterpart of the dsh-univer-office
 * FileState model.
 * @module dsh-univer-workspace-plugin/shared/state
 */

/** Lifecycle states of a Workspace Worktree. */
export type WorktreeStatus = "draft" | "ready" | "merging" | "merged" | "discarded";

/** How one worktree unit differs from its trunk baseline. */
export type UnitChangeKind = "modified" | "added" | "deleted" | "unchanged";

/** Server-authoritative lifecycle actions for one Worktree. */
export interface WorktreeCapabilities {
  readonly review: boolean;
  readonly editDraft: boolean;
  readonly addUnit: boolean;
  readonly changeVisibility: boolean;
  readonly markReady: boolean;
  readonly reopen: boolean;
  readonly merge: boolean;
  readonly discard: boolean;
}

export interface WorktreeCreator {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface WorktreeTeamSpace {
  readonly id: string;
  readonly type: "team";
  readonly name: string;
}

/** A changed Univer unit shown in the worktree switcher. */
export interface ChangedUnit {
  readonly unitId: string;
  readonly resourceId: string;
  readonly nodeId?: string;
  readonly name: string;
  readonly unitType: string;
  /** Whether this Unit is inherited from trunk or created in the Worktree. */
  readonly source?: "trunk" | "worktree";
  /** Target Space for a Worktree-local Unit, when supplied by the product. */
  readonly target?: { readonly spaceId: string; readonly parentNodeId: string | null } | null;
  readonly kind: UnitChangeKind;
  readonly draftHeadRevision: number;
  /** Workspace review page for editing a draft Unit. */
  readonly worktreeUrl?: string;
  /** Workspace review page for a ready Unit's merge preview. */
  readonly mergeUrl?: string;
}

/** A complete Unit entry returned by the origin-level Worktree list. */
export interface WorktreeUnitView extends ChangedUnit {
  readonly nodeId: string;
  readonly source: "trunk" | "worktree";
  readonly target: { readonly spaceId: string; readonly parentNodeId: string | null } | null;
  readonly mergeResult: "pending" | "merged" | "unchanged" | "conflict" | "failed";
  readonly activationState:
    | "notApplicable"
    | "waitingForMerge"
    | "pending"
    | "completed"
    | "failed"
    | "discarded";
}

/** One origin-level Worktree with the full product metadata needed by browser surfaces. */
export interface WorktreeStateView {
  readonly worktreeId: string;
  readonly name: string;
  readonly status: WorktreeStatus;
  readonly summary: string | null;
  readonly kind: "user" | "team";
  readonly teamSpace: WorktreeTeamSpace | null;
  readonly visibility: "private" | "space";
  readonly creator: WorktreeCreator;
  readonly unitCount: number;
  readonly processedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly capabilities: WorktreeCapabilities;
  readonly units: readonly WorktreeUnitView[];
}

/** Embedded-editor mount carried where office uses opaque viewer URLs. */
export interface ViewerTarget {
  readonly unitId: string;
  readonly unitType: string;
  readonly readOnly: boolean;
}

/** Complete Worktree product state plus the browser Viewer targets derived by the Harness. */
export interface DocumentWorktreeState extends WorktreeStateView {
  readonly worktreeTarget: ViewerTarget | null;
  readonly mergeTarget: ViewerTarget | null;
  /** Workspace Worktree dashboard deep link for this task. */
  readonly openUrl: string | null;
}

/** Collaboration state for ONE document. */
export interface DocumentFileState {
  readonly ok: true;
  /** Canonical Workspace origin that owns this projection. */
  readonly workspaceOrigin: string;
  readonly resourceId: string;
  /** Canonical Workspace browser URL for the document, never an internal docKey. */
  readonly workspaceUrl: string | null;
  readonly gatewayRunning: true;
  readonly viewerTarget: ViewerTarget | null;
  readonly worktrees: readonly DocumentWorktreeState[];
}

/** Reviewable transitions exposed by `POST /univer-workspace/api/worktrees/{id}/{action}`. */
export type WorktreeAction = "ready" | "reopen" | "merge" | "discard";
