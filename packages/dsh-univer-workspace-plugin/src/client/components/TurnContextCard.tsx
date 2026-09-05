/**
 * In-message Turn-context card. One `wt:<id>` Turn projection renders as one
 * Worktree turn card (header + per-Unit accordion over THIS Turn's Units);
 * an independent trunk `res:<id>` projection renders as one Resource turn
 * card. The embedded Viewer reuses the shared kernel
 * (`PanelViewer` → `ViewerMount`) without the lifecycle bar; lifecycle actions
 * live in the Worktree header and are driven only by server capabilities.
 * All Turn-membership decisions are presentation projections computed in
 * `turn-context-card-model.ts`; the domain Turn log is never rewritten.
 * @module dsh-univer-workspace-plugin/client/components/TurnContextCard
 */

import * as React from "react";
import {
  Badge,
  BasesMultiIcon,
  BoardsMultiIcon,
  Button,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ConfirmDialog,
  DocsMultiIcon,
  ExternalLinkIcon,
  FileIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  Segmented,
  SendIcon,
  SheetsMultiIcon,
  SlidesMultiIcon,
  TrashIcon,
  type SegmentedOption,
  type WorkspaceIconComponent,
} from "@univerjs/univer-workspace-ui";
import type {
  DocumentFileState,
  DocumentWorktreeState,
  WorktreeAction,
  WorktreeUnitView,
} from "../../shared/state.ts";
import type { UniverTurnOperation } from "../conversation/univer-turn-definition.ts";
import { postWorktreeAction } from "../api/univer-api.ts";
import type { UniverLocaleKey } from "../locales.ts";
import type { WorkspaceNavigationStore } from "../navigation/workspace-navigation.ts";
import { PanelViewer, type ViewerRuntimeProps, type ViewerTarget } from "./review-panel.tsx";
import {
  actionDialogCopy,
  activeViewerMode,
  canViewMergePreview,
  canViewTrunk,
  defaultExpandedUnits,
  formatOptionalDateTime,
  mergeResultLabel,
  mergeResultVariant,
  resolveTurnViewer,
  selectTurnUnits,
  statusLabel,
  statusVariant,
  unitChangeLabel,
  unitTypeLabel,
  viewerKey,
  viewerUnitTypeOf,
  type TurnCardStatus,
  type TurnViewMode,
} from "./turn-context-card-model.ts";
import css from "./TurnContextCard.module.scss";
import { WorktreeBranchIcon } from "./worktree-review/WorktreeBranchIcon.tsx";

export interface TurnContextCardProps extends ViewerRuntimeProps {
  readonly docKey: string;
  readonly worktreeId: string | null;
  readonly resourceId: string | null;
  /** The Turn projection's operations for this aggregate (presentation input). */
  readonly operations: readonly UniverTurnOperation[];
  readonly label: string | null;
  readonly unitType: string | null;
  readonly preferredUnitId: string | null;
  readonly state: DocumentFileState | undefined;
  readonly stateError?: string | undefined;
  readonly historical: boolean;
  /** The first Worktree card in this Turn starts expanded; others collapse. */
  readonly initiallyExpanded: boolean;
  readonly navigation: WorkspaceNavigationStore;
}

/** Dispatch one Turn projection to its Worktree or trunk Resource card. */
export function TurnContextCard(props: TurnContextCardProps): React.ReactElement {
  if (props.worktreeId !== null) {
    return <WorktreeTurnCard {...props} worktreeId={props.worktreeId} />;
  }
  return <ResourceTurnCard {...props} />;
}

function WorktreeTurnCard(
  props: TurnContextCardProps & { readonly worktreeId: string },
): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(!props.initiallyExpanded);
  // null = the user has not toggled yet; derive the default expanded Unit from
  // the live state so late-arriving polls still expand the relevant Unit once.
  const [expandedIds, setExpandedIds] = React.useState<readonly string[] | null>(null);
  const [viewByUnitId, setViewByUnitId] = React.useState<Readonly<Record<string, TurnViewMode>>>(
    {},
  );
  const wasHistorical = React.useRef(props.historical);

  React.useEffect(() => {
    if (!wasHistorical.current && props.historical) setCollapsed(true);
    wasHistorical.current = props.historical;
  }, [props.historical]);

  const worktree = props.state?.worktrees.find((entry) => entry.worktreeId === props.worktreeId);
  const status: TurnCardStatus =
    props.state === undefined
      ? props.stateError === undefined
        ? "loading"
        : "unavailable"
      : (worktree?.status ?? "unavailable");
  // Only the Units this Turn actually touched are this card's review surface;
  // worktree.unitCount describes the whole Worktree and must not pose as the
  // per-Turn count.
  const turnUnits = worktree === undefined ? [] : selectTurnUnits(worktree.units, props.operations);
  const expandedUnitIds =
    expandedIds ?? defaultExpandedUnits(turnUnits, props.preferredUnitId, props.historical);
  const toggleUnit = (unitId: string): void => {
    setExpandedIds(
      expandedUnitIds.includes(unitId)
        ? expandedUnitIds.filter((id) => id !== unitId)
        : [...expandedUnitIds, unitId],
    );
  };

  const title = worktree?.name ?? props.label ?? props.t("card.title");
  const updatedAt = worktree === undefined ? null : formatOptionalDateTime(worktree.updatedAt);
  const metaParts: string[] = [];
  if (worktree !== undefined) {
    if (worktree.kind === "team" && worktree.teamSpace !== null)
      metaParts.push(worktree.teamSpace.name);
    metaParts.push(worktree.creator.displayName);
    if (updatedAt !== null) metaParts.push(updatedAt);
  }

  // The middle Workspace surface opens the whole Worktree; the in-card preview
  // keeps its own expansion state and is never collapsed by this action.
  const canOpenMiddle =
    props.state !== undefined && worktree !== undefined && worktree.name.trim() !== "";
  const openMiddle = (): void => {
    if (!canOpenMiddle || props.state === undefined || worktree === undefined) return;
    props.navigation.dispatch({
      type: "open-content",
      contentSurface: {
        kind: "worktree",
        workspaceOrigin: props.state.workspaceOrigin,
        worktreeId: props.worktreeId,
        name: worktree.name,
        unitId: null,
      },
    });
  };

  return (
    <article
      className={css.card}
      data-turn-context-card=""
      data-worktree-id={props.worktreeId}
      data-status={status}
      aria-label={title}
    >
      <div className={css.ribbon}>
        <Badge variant="outline">{props.t("turn.ribbon")}</Badge>
      </div>
      <header className={css.header}>
        <div className={css.titleBlock}>
          <div className={css.titleRow}>
            <WorktreeBranchIcon status={status} />
            <h3 className={css.title}>{title}</h3>
            <Badge variant={statusVariant(status)}>{statusLabel(status, props.t)}</Badge>
          </div>
          {metaParts.length > 0 ? <p className={css.meta}>{metaParts.join(" · ")}</p> : null}
          {worktree !== undefined && worktree.summary !== null && worktree.summary !== "" ? (
            <p className={css.summary}>{worktree.summary}</p>
          ) : null}
        </div>
        <div className={css.actions}>
          {worktree === undefined ? null : <WorktreeActions worktree={worktree} t={props.t} />}
          <Button variant="ghost" size="sm" disabled={!canOpenMiddle} onClick={openMiddle}>
            <ExternalLinkIcon />
            {props.t("task.openMiddle")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-label={props.t(collapsed ? "dock.expand" : "dock.fold")}
            title={props.t(collapsed ? "dock.expand" : "dock.fold")}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          </Button>
        </div>
      </header>
      {collapsed ? null : (
        <div className={css.body}>
          {renderWorktreeBody({
            props,
            worktree,
            turnUnits,
            expandedUnitIds,
            viewByUnitId,
            toggleUnit,
            setViewByUnitId,
          })}
        </div>
      )}
    </article>
  );
}

/** Body gate: loading / error / unavailable / no review permission / no Units. */
function renderWorktreeBody(input: {
  readonly props: TurnContextCardProps & { readonly worktreeId: string };
  readonly worktree: DocumentWorktreeState | undefined;
  readonly turnUnits: readonly WorktreeUnitView[];
  readonly expandedUnitIds: readonly string[];
  readonly viewByUnitId: Readonly<Record<string, TurnViewMode>>;
  readonly toggleUnit: (unitId: string) => void;
  readonly setViewByUnitId: React.Dispatch<
    React.SetStateAction<Readonly<Record<string, TurnViewMode>>>
  >;
}): React.ReactNode {
  const { props, worktree, turnUnits } = input;
  if (props.state === undefined) {
    return (
      <div className={css.notice} role={props.stateError === undefined ? "status" : "alert"}>
        {props.stateError === undefined
          ? props.t("dock.loading")
          : `${props.t("window.loadFailed")}: ${props.stateError}`}
      </div>
    );
  }
  if (worktree === undefined) {
    return (
      <div className={css.notice} role="status">
        {props.t("dock.unavailable")}
      </div>
    );
  }
  if (!worktree.capabilities.review) {
    return (
      <div className={css.notice} role="status">
        {props.t("turn.noReview")}
      </div>
    );
  }
  if (turnUnits.length === 0) {
    return (
      <div className={css.notice} role="status">
        {props.t("turn.noUnits")}
      </div>
    );
  }
  return (
    <ul className={css.accordionList}>
      {turnUnits.map((unit) => (
        <TurnUnitItem
          key={unit.unitId}
          worktree={worktree}
          unit={unit}
          expanded={input.expandedUnitIds.includes(unit.unitId)}
          view={input.viewByUnitId[unit.unitId] ?? "agent"}
          runtime={props}
          onToggle={() => input.toggleUnit(unit.unitId)}
          onViewChange={(mode) =>
            input.setViewByUnitId((current) => ({ ...current, [unit.unitId]: mode }))
          }
        />
      ))}
    </ul>
  );
}

/** One Unit accordion item; mounts the real Viewer only while expanded. */
function TurnUnitItem(props: {
  readonly worktree: DocumentWorktreeState;
  readonly unit: WorktreeUnitView;
  readonly expanded: boolean;
  readonly view: TurnViewMode;
  readonly runtime: ViewerRuntimeProps;
  readonly onToggle: () => void;
  readonly onViewChange: (mode: TurnViewMode) => void;
}): React.ReactElement {
  const { worktree, unit } = props;
  const activeView = activeViewerMode(props.view, worktree, unit);
  const previewable = activeView !== "agent" || unit.kind !== "deleted";
  const viewer =
    props.expanded && previewable ? resolveTurnViewer(worktree, unit, activeView) : undefined;

  const ChangeIcon = UNIT_CHANGE_ICONS[unit.kind];
  const mergeResult = unit.mergeResult;
  const viewOptions: SegmentedOption<TurnViewMode>[] = [
    { value: "trunk", label: props.runtime.t("turn.view.trunk"), disabled: !canViewTrunk(unit) },
    { value: "agent", label: props.runtime.t("turn.view.agent") },
    ...(canViewMergePreview(worktree)
      ? [{ value: "preview" as const, label: props.runtime.t("turn.view.preview") }]
      : []),
  ];

  return (
    <li className={css.accordionItem} data-unit-id={unit.unitId}>
      <button
        type="button"
        className={css.accordionHeader}
        aria-expanded={props.expanded}
        data-deleted={unit.kind === "deleted" || undefined}
        onClick={props.onToggle}
      >
        {props.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <UnitTypeIcon type={unit.unitType} />
        <span className={css.unitName}>{unit.name}</span>
        <span className={css.unitChange}>
          {ChangeIcon === undefined ? null : <ChangeIcon aria-hidden="true" />}
          {unitChangeLabel(unit.kind, props.runtime.t)}
        </span>
        {mergeResult === "pending" ? null : (
          <Badge variant={mergeResultVariant(mergeResult)}>
            {mergeResultLabel(mergeResult, props.runtime.t)}
          </Badge>
        )}
      </button>
      {props.expanded ? (
        <div className={css.accordionBody}>
          <div className={css.unitHeader}>
            <div className={css.controls}>
              <Segmented<TurnViewMode>
                aria-label={props.runtime.t("viewer.readOnlyPreview")}
                size="sm"
                value={activeView}
                options={viewOptions}
                onValueChange={props.onViewChange}
              />
            </div>
          </div>
          {!previewable ? (
            <div className={css.deletedEmpty} role="status">
              <TrashIcon aria-hidden="true" />
              <span>{props.runtime.t("turn.deletedPreview")}</span>
            </div>
          ) : viewer === undefined ? (
            <div className={css.notice} role="status">
              {props.runtime.t("dock.unavailable")}
            </div>
          ) : (
            <div className={css.viewerWrap}>
              <div className={css.viewer} data-view-mode={activeView}>
                <PanelViewer key={viewerKey(viewer)} viewer={viewer} runtime={props.runtime} />
              </div>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Capability-driven lifecycle actions on the Worktree header. */
function WorktreeActions(props: {
  readonly worktree: DocumentWorktreeState;
  readonly t: (key: UniverLocaleKey) => string;
}): React.ReactElement {
  const [pending, setPending] = React.useState<WorktreeAction | null>(null);
  const [busy, setBusy] = React.useState<WorktreeAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const capabilities = props.worktree.capabilities;
  const dialog = pending === null ? null : actionDialogCopy(pending, props.t);

  const confirm = (): void => {
    const action = pending;
    if (action === null || busy !== null) return;
    setBusy(action);
    setError(null);
    // The existing state polling converges the card after the transition.
    void postWorktreeAction(props.worktree.worktreeId, action)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setBusy(null));
  };

  return (
    <>
      {capabilities.discard ? (
        <Button
          variant="destructive-ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => setPending("discard")}
        >
          <TrashIcon />
          {props.t("viewer.discard")}
        </Button>
      ) : null}
      {capabilities.reopen ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => setPending("reopen")}
        >
          <RefreshIcon />
          {props.t("turn.reopen")}
        </Button>
      ) : null}
      {capabilities.markReady ? (
        <Button size="sm" disabled={busy !== null} onClick={() => setPending("ready")}>
          <SendIcon />
          {props.t("viewer.submitForReview")}
        </Button>
      ) : null}
      {capabilities.merge ? (
        <Button variant="success" size="sm" disabled={busy !== null} onClick={() => setPending("merge")}>
          <CheckIcon />
          {props.t("viewer.mergeToCurrent")}
        </Button>
      ) : null}
      {error === null ? null : (
        <span className={css.actionError} role="status">
          {error}
        </span>
      )}
      {dialog === null ? null : (
        <ConfirmDialog
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          title={dialog.title}
          description={dialog.description}
          confirmText={dialog.confirmText}
          cancelText={props.t("viewer.cancel")}
          danger={dialog.danger}
          disabled={busy !== null}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

/** Turn card for an independent trunk Resource projection. */
function ResourceTurnCard(props: TurnContextCardProps): React.ReactElement {
  const [open, setOpen] = React.useState(!props.historical);
  const wasHistorical = React.useRef(props.historical);

  React.useEffect(() => {
    if (!wasHistorical.current && props.historical) setOpen(false);
    wasHistorical.current = props.historical;
  }, [props.historical]);

  const status: TurnCardStatus =
    props.state === undefined
      ? props.stateError === undefined
        ? "loading"
        : "unavailable"
      : "trunk";
  const target = props.state?.viewerTarget ?? null;
  const unitId = props.preferredUnitId ?? target?.unitId ?? null;
  const viewer: ViewerTarget | undefined =
    props.state === undefined || target === null || unitId === null
      ? undefined
      : {
          unitId,
          unitType: viewerUnitTypeOf(target.unitType !== "" ? target.unitType : props.unitType),
          editable: !target.readOnly,
          scope: { kind: "trunk" },
        };
  const title = props.label ?? props.t("card.title");

  // The middle Workspace surface opens this Resource; the in-card preview keeps
  // its own expansion state and is never collapsed by this action.
  const canOpenMiddle = props.state !== undefined && props.resourceId !== null;
  const openMiddle = (): void => {
    if (props.state === undefined || props.resourceId === null) return;
    const resourceId = props.resourceId;
    props.navigation.dispatch({
      type: "open-content",
      contentSurface: {
        kind: "resource",
        workspaceOrigin: props.state.workspaceOrigin,
        resourceId,
        docKey: `res:${resourceId}`,
        name: title,
        unitType: props.unitType ?? props.state.viewerTarget?.unitType ?? null,
      },
    });
  };

  return (
    <article
      className={css.card}
      data-turn-context-card=""
      {...(props.resourceId === null ? {} : { "data-resource-id": props.resourceId })}
      data-status={status}
      aria-label={title}
    >
      <div className={css.ribbon}>
        <Badge variant="outline">{props.t("turn.ribbon")}</Badge>
      </div>
      <header className={css.header}>
        <div className={css.titleBlock}>
          <div className={css.titleRow}>
            <UnitTypeIcon type={viewer?.unitType ?? props.unitType ?? ""} />
            <h3 className={css.title}>{title}</h3>
            <Badge variant="outline">{props.t("dock.currentVersion")}</Badge>
          </div>
        </div>
        <div className={css.actions}>
          <Button variant="ghost" size="sm" disabled={!canOpenMiddle} onClick={openMiddle}>
            <ExternalLinkIcon />
            {props.t("task.openMiddle")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={open}
            aria-label={props.t(open ? "dock.fold" : "dock.expand")}
            title={props.t(open ? "dock.fold" : "dock.expand")}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </Button>
        </div>
      </header>
      {open ? (
        <div className={css.body}>
          {props.state === undefined ? (
            <div className={css.notice} role={props.stateError === undefined ? "status" : "alert"}>
              {props.stateError === undefined
                ? props.t("dock.loading")
                : `${props.t("window.loadFailed")}: ${props.stateError}`}
            </div>
          ) : viewer === undefined ? (
            <div className={css.notice} role="status">
              {props.t("dock.unavailable")}
            </div>
          ) : (
            <div className={css.viewerWrap}>
              <div className={css.viewer} data-view-mode="trunk">
                <PanelViewer key={viewerKey(viewer)} viewer={viewer} runtime={props} />
              </div>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

/* ————— Local presentation helpers (icons) ————— */

const UNIT_TYPE_ICONS: Readonly<Record<string, WorkspaceIconComponent>> = {
  sheet: SheetsMultiIcon,
  doc: DocsMultiIcon,
  slide: SlidesMultiIcon,
  board: BoardsMultiIcon,
  base: BasesMultiIcon,
};

function UnitTypeIcon({ type }: { readonly type: string }): React.ReactElement {
  const Icon = UNIT_TYPE_ICONS[type] ?? FileIcon;
  return <Icon className={css.unitIcon} aria-hidden="true" />;
}

const UNIT_CHANGE_ICONS: Readonly<Record<string, WorkspaceIconComponent>> = {
  modified: PencilIcon,
  added: PlusIcon,
  deleted: TrashIcon,
};
