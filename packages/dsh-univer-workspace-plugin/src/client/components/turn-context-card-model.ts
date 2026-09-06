/**
 * Pure presentation derivations for the in-message Turn-context card. Every
 * helper here projects existing Turn operations and live Worktree state into
 * what the card displays; none of them rewrite the domain Turn projection or
 * the Worktree model.
 * @module dsh-univer-workspace-plugin/client/components/turn-context-card-model
 */

import type {
  UniverTurnFile,
  UniverTurnOperation,
} from "../conversation/univer-turn-definition.ts";
import type {
  DocumentWorktreeState,
  WorktreeAction,
  WorktreeStatus,
  WorktreeUnitView,
} from "../../shared/state.ts";
import type { BadgeProps } from "@univerjs/univer-workspace-ui";
import type { UniverLocaleKey } from "../locales.ts";
import type { ViewerUnitType } from "../viewer-engine.ts";
import type { ViewerTarget } from "./review-panel.tsx";

/** The three embedded-Viewer modes offered by one Worktree Unit accordion. */
export type TurnViewMode = "trunk" | "agent" | "preview";

/**
 * Presentation-layer dedup: drop trunk `res:` projections whose resourceId or
 * unitId is already carried by a Worktree operation of the same Turn; their
 * evidence lives on the Worktree turn card. Independent trunk operations keep
 * their Resource card. The underlying Turn projection is left untouched.
 */
export function absorbWorktreeCoveredTrunkFiles(
  files: readonly UniverTurnFile[],
): UniverTurnFile[] {
  const coveredResourceIds = new Set<string>();
  const coveredUnitIds = new Set<string>();
  for (const file of files) {
    if (!file.docKey.startsWith("wt:")) continue;
    for (const operation of file.operations) {
      if (operation.phase !== "succeeded") continue;
      if (operation.worktreeId === null) continue;
      if (operation.resourceId !== null) coveredResourceIds.add(operation.resourceId);
      if (operation.unitId !== null) coveredUnitIds.add(operation.unitId);
    }
  }
  return files.filter((file) => {
    if (!file.docKey.startsWith("res:")) return true;
    if (coveredResourceIds.has(file.docKey.slice(4))) return false;
    return !file.operations.some(
      (operation) => operation.unitId !== null && coveredUnitIds.has(operation.unitId),
    );
  });
}

/**
 * Select which Units of a Worktree belong to this Turn's review surface. Only
 * succeeded operations contribute: concrete unit/resource operations pin the
 * shown Units by unitId/resourceId; a whole-Worktree lifecycle action
 * (ready/merge/discard/reopen), a lone create, or the absence of any
 * resolvable Unit identity makes the whole Worktree the review object.
 * failed/pending operations never widen the set.
 */
export function selectTurnUnits(
  units: readonly WorktreeUnitView[],
  operations: readonly UniverTurnOperation[],
): WorktreeUnitView[] {
  const unitIds = new Set<string>();
  const resourceIds = new Set<string>();
  let wholeWorktree = false;
  let hasSucceededOperation = false;
  for (const operation of operations) {
    if (operation.phase !== "succeeded") continue;
    hasSucceededOperation = true;
    if (operation.name === "worktree") {
      // Whole-Worktree lifecycle actions make every Unit this Turn's review
      // object. create carries no Unit identity of its own: with no other
      // concrete operation the whole Worktree is reviewed, otherwise the
      // concrete identities below decide.
      if (
        operation.action === "ready" ||
        operation.action === "merge" ||
        operation.action === "discard" ||
        operation.action === "reopen"
      )
        wholeWorktree = true;
      continue;
    }
    if (operation.unitId !== null) unitIds.add(operation.unitId);
    if (operation.resourceId !== null) resourceIds.add(operation.resourceId);
  }
  if (wholeWorktree) return [...units];
  if (!hasSucceededOperation) return [];
  if (unitIds.size === 0 && resourceIds.size === 0) return [...units];
  return units.filter((unit) => unitIds.has(unit.unitId) || resourceIds.has(unit.resourceId));
}

/**
 * Conversation Changes cards keep every Unit accordion collapsed by default.
 * The first Worktree card itself may be expanded, but its Unit details are a
 * separate disclosure from the middle Worktree review page (where Units start
 * expanded). Keeping this projection empty prevents the two surfaces from
 * accidentally sharing a default and mounting a Viewer in the transcript.
 */
export function defaultExpandedUnits(
  _units: readonly WorktreeUnitView[],
  _preferredUnitId: string | null,
  _historical: boolean,
): readonly string[] {
  return [];
}

/* ————— Viewer mode availability (Workspace review rules) ————— */

/** The trunk (official) version exists only for trunk-sourced or fully merged Units. */
export function canViewTrunk(unit: WorktreeUnitView): boolean {
  return unit.source === "trunk" || unit.activationState === "completed";
}

/** Merge preview exists only while the Worktree is ready and produced a merge target. */
export function canViewMergePreview(worktree: DocumentWorktreeState): boolean {
  return worktree.status === "ready" && worktree.mergeTarget !== null;
}

/** Agent Draft exists only while the Worktree exposes a draft target. */
export function canViewAgentDraft(worktree: DocumentWorktreeState): boolean {
  return (
    (worktree.status === "draft" || worktree.status === "ready") && worktree.worktreeTarget !== null
  );
}

/** Fall back to the agent draft whenever the requested mode is unavailable. */
export function activeViewerMode(
  requested: TurnViewMode,
  worktree: DocumentWorktreeState,
  unit: WorktreeUnitView,
): TurnViewMode {
  if (requested === "trunk" && canViewTrunk(unit)) return "trunk";
  if (requested === "preview" && canViewMergePreview(worktree)) return "preview";
  if (canViewAgentDraft(worktree)) return "agent";
  if (canViewMergePreview(worktree)) return "preview";
  if (canViewTrunk(unit)) return "trunk";
  return "agent";
}

/** Resolve the embedded-editor target for one Unit and one explicit mode. */
export function resolveTurnViewer(
  worktree: DocumentWorktreeState,
  unit: WorktreeUnitView,
  mode: TurnViewMode,
): ViewerTarget | undefined {
  const unitType = viewerUnitTypeOf(unit.unitType);
  const unsupported =
    unitType === "unsupported" ? { unsupportedType: rawUnitType(unit.unitType) } : {};
  if (mode === "trunk") {
    if (!canViewTrunk(unit)) return undefined;
    return {
      unitId: unit.unitId,
      unitType,
      editable: false,
      scope: { kind: "trunk" },
      ...unsupported,
    };
  }
  if (mode === "preview") {
    if (!canViewMergePreview(worktree)) return undefined;
    return {
      unitId: unit.unitId,
      unitType,
      editable: false,
      scope: { kind: "mergePreview", worktreeId: worktree.worktreeId },
      ...unsupported,
    };
  }
  if (unit.kind === "deleted" || !canViewAgentDraft(worktree)) return undefined;
  return {
    unitId: unit.unitId,
    unitType,
    editable: false,
    scope: { kind: "worktree", worktreeId: worktree.worktreeId },
    ...unsupported,
  };
}

/** A missing type is a contract error, not permission to mount a Sheet viewer. */
export function viewerUnitTypeOf(raw: string | null): ViewerUnitType | "unsupported" {
  if (raw === "sheet" || raw === "doc" || raw === "slide" || raw === "board" || raw === "base")
    return raw;
  return "unsupported";
}

export function rawUnitType(value: string | null): string {
  return value === null || value === "" ? "unknown" : value;
}

/** Remount key: switching Unit or scope must rebuild the embedded editor. */
export function viewerKey(viewer: ViewerTarget): string {
  return viewer.scope.kind === "trunk"
    ? `${viewer.unitId}:trunk`
    : `${viewer.unitId}:${viewer.scope.kind}:${viewer.scope.worktreeId}`;
}

/* ————— Label, variant, and dialog-copy derivations (locale-driven) ————— */

/** Aggregate status shown on a Turn-context card header. */
export type TurnCardStatus = WorktreeStatus | "trunk" | "loading" | "unavailable";

/** Format a real ISO timestamp; unparseable placeholder slots are omitted. */
export function formatOptionalDateTime(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** ConfirmDialog copy per lifecycle action; discard is the only danger action. */
export function actionDialogCopy(
  action: WorktreeAction,
  t: (key: UniverLocaleKey) => string,
): {
  readonly title: string;
  readonly description: string;
  readonly confirmText: string;
  readonly danger: boolean;
} {
  if (action === "ready")
    return {
      title: t("viewer.readyTitle"),
      description: t("viewer.readyBody"),
      confirmText: t("viewer.readyConfirm"),
      danger: false,
    };
  if (action === "merge")
    return {
      title: t("viewer.mergeTitle"),
      description: t("viewer.mergeBody"),
      confirmText: t("viewer.mergeConfirm"),
      danger: false,
    };
  if (action === "reopen")
    return {
      title: t("turn.reopenTitle"),
      description: t("turn.reopenBody"),
      confirmText: t("turn.reopenConfirm"),
      danger: false,
    };
  return {
    title: t("viewer.discardTitle"),
    description: t("viewer.discardBody"),
    confirmText: t("viewer.discardConfirm"),
    danger: true,
  };
}

export function statusVariant(status: TurnCardStatus): NonNullable<BadgeProps["variant"]> {
  if (status === "draft") return "outline";
  if (status === "ready") return "success";
  if (status === "merging") return "violet";
  if (status === "merged") return "violet";
  if (status === "discarded" || status === "unavailable") return "danger";
  return "outline";
}

export function statusLabel(status: TurnCardStatus, t: (key: UniverLocaleKey) => string): string {
  if (status === "draft") return t("dock.draft");
  if (status === "ready") return t("dock.mergeReady");
  if (status === "merging") return t("dock.merging");
  if (status === "merged") return t("dock.merged");
  if (status === "discarded") return t("dock.discarded");
  if (status === "loading") return t("dock.loading");
  if (status === "unavailable") return t("dock.unavailable");
  return t("dock.currentVersion");
}

export function unitChangeLabel(kind: string, t: (key: UniverLocaleKey) => string): string {
  if (kind === "added") return t("turn.unit.added");
  if (kind === "deleted") return t("turn.unit.deleted");
  if (kind === "modified") return t("turn.unit.modified");
  return t("turn.unit.unchanged");
}

export function mergeResultLabel(
  result: WorktreeUnitView["mergeResult"],
  t: (key: UniverLocaleKey) => string,
): string {
  if (result === "merged") return t("dock.merged");
  if (result === "unchanged") return t("turn.unit.unchanged");
  if (result === "conflict") return t("dock.unit.conflict");
  if (result === "failed") return t("turn.merge.failed");
  return t("dock.loading");
}

export function mergeResultVariant(
  result: WorktreeUnitView["mergeResult"],
): NonNullable<BadgeProps["variant"]> {
  return result === "merged" || result === "unchanged" ? "success" : "danger";
}

/** Localized Unit type label; unknown types render no label (never the raw key). */
export function unitTypeLabel(
  type: string | null,
  t: (key: UniverLocaleKey) => string,
): string | null {
  if (type === "sheet") return t("turn.type.sheet");
  if (type === "doc") return t("turn.type.doc");
  if (type === "slide") return t("turn.type.slide");
  if (type === "board") return t("turn.type.board");
  if (type === "base") return t("turn.type.base");
  return null;
}
