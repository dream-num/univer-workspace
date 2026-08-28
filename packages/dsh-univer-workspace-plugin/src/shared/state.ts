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

/** A changed Univer unit shown in the worktree switcher. */
export interface ChangedUnit {
  readonly unitId: string;
  readonly resourceId: string;
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

/** One worktree and its changed units, as rendered by the review surfaces. */
export interface WorktreeStateView {
  readonly worktreeId: string;
  readonly name: string;
  readonly status: WorktreeStatus;
  readonly units: readonly ChangedUnit[];
}

/** A changed Univer unit shown in the worktree switcher (contract alias). */
export interface WorktreeUnitView extends ChangedUnit {}

/** Embedded-editor mount carried where office uses opaque viewer URLs. */
export interface ViewerTarget {
  readonly unitId: string;
  readonly unitType: string;
  readonly readOnly: boolean;
}

/** Collaboration state for ONE document. */
export interface DocumentFileState {
  readonly ok: true;
  readonly resourceId: string;
  /** Canonical Workspace browser URL for the document, never an internal docKey. */
  readonly workspaceUrl: string | null;
  readonly gatewayRunning: true;
  readonly viewerTarget: ViewerTarget | null;
  readonly worktrees: readonly {
    readonly worktreeId: string;
    readonly name: string;
    readonly status: WorktreeStatus;
    readonly units: readonly WorktreeUnitView[];
    readonly worktreeTarget: ViewerTarget | null;
    readonly mergeTarget: ViewerTarget | null;
    /** Workspace Worktree dashboard deep link for this Unit. */
    readonly openUrl: string | null;
  }[];
}

/** Reviewable transitions exposed by `POST /univer-workspace/api/worktrees/{id}/{action}`. */
export type WorktreeAction = "ready" | "reopen" | "merge" | "discard";
