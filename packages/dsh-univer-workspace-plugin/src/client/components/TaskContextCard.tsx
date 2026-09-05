/**
 * The single persistent session-task card (confirmed variant A). One DSH
 * Conversation renders at most one of these: it aggregates every Worktree the
 * Session touched (left one-level switcher when more than one exists) and
 * falls back to the latest independent trunk Resource only when no Worktree
 * candidate exists. The card is collapsed by default and mounts the shared
 * Univer Viewer only while explicitly expanded. All selection state — pinned
 * Worktree, selected Unit, expanded, navigation toggles — is internal to this
 * component; the Dock only delivers candidates, visibility and focus intents.
 * The in-card preview and the middle Workspace Viewer are independent shells
 * that may coexist; this card deliberately does NOT use useExclusiveViewer.
 * @module dsh-univer-workspace-plugin/client/components/TaskContextCard
 */

import * as React from "react";
import {
  Badge,
  BasesMultiIcon,
  BoardsMultiIcon,
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DocsMultiIcon,
  ExternalLinkIcon,
  FileIcon,
  ListTreeIcon,
  SheetsMultiIcon,
  SlidesMultiIcon,
  type WorkspaceIconComponent,
} from "@univerjs/univer-workspace-ui";
import type {
  DocumentFileState,
  DocumentWorktreeState,
  WorktreeStatus,
} from "../../shared/state.ts";
import type { WorkspaceNavigationStore } from "../navigation/workspace-navigation.ts";
import type { UniverLocaleKey } from "../locales.ts";
import { PanelViewer, resolveViewerTarget, type ViewerRuntimeProps } from "./review-panel.tsx";
import {
  formatOptionalDateTime,
  statusLabel,
  statusVariant,
  unitChangeLabel,
  viewerKey,
  type TurnCardStatus,
} from "./turn-context-card-model.ts";
import {
  defaultCurrentWorktreeId,
  isProcessedWorktreeStatus,
  type SessionCardCandidates,
  type SessionResourceFallback,
  type SessionTaskFocusIntent,
  type SessionWorktreeCandidate,
} from "./session-task-card-model.ts";
import css from "./TaskContextCard.module.scss";

export interface TaskContextCardProps extends ViewerRuntimeProps {
  readonly sessionId?: string;
  readonly candidates: SessionCardCandidates;
  readonly states: Readonly<Record<string, DocumentFileState>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly focusIntent: SessionTaskFocusIntent | null;
  readonly navigation: WorkspaceNavigationStore;
  readonly onDismiss: () => void;
}

export function TaskContextCard(props: TaskContextCardProps): React.ReactElement {
  const t = props.t;
  const [expanded, setExpanded] = React.useState(false);
  const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const dragOrigin = React.useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [navigationOpen, setNavigationOpen] = React.useState(false);
  const [processedOpen, setProcessedOpen] = React.useState(false);
  const [pinnedWorktreeId, setPinnedWorktreeId] = React.useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = React.useState<string | undefined>(undefined);
  const [activity, setActivity] = React.useState<readonly string[]>([]);
  const lastNonce = React.useRef(0);

  const liveWorktreeOf = (candidate: SessionWorktreeCandidate): DocumentWorktreeState | undefined =>
    props.states[candidate.docKey]?.worktrees.find(
      (entry) => entry.worktreeId === candidate.worktreeId,
    );
  const liveStatusOf = (candidate: SessionWorktreeCandidate): WorktreeStatus | undefined =>
    liveWorktreeOf(candidate)?.status;

  const activeWorktrees = props.candidates.worktrees.filter((candidate) => {
    const status = liveStatusOf(candidate);
    return status === undefined || !isProcessedWorktreeStatus(status);
  });
  const processedWorktrees = props.candidates.worktrees.filter((candidate) => {
    const status = liveStatusOf(candidate);
    return status !== undefined && isProcessedWorktreeStatus(status);
  });

  const pinned =
    pinnedWorktreeId !== null &&
    activeWorktrees.some((candidate) => candidate.worktreeId === pinnedWorktreeId)
      ? pinnedWorktreeId
      : null;
  const defaultWorktreeId = defaultCurrentWorktreeId(activeWorktrees, liveStatusOf);
  const currentWorktreeId = pinned ?? defaultWorktreeId;
  const currentCandidate =
    activeWorktrees.find((candidate) => candidate.worktreeId === currentWorktreeId) ?? null;
  const fallback = currentCandidate === null ? props.candidates.fallback : null;

  // Focus intents: a manual open pins and expands; a new Agent operation never
  // steals a pinned selection, it only leaves a restrained "new" marker.
  // Intents targeting neither a known Worktree candidate nor the active
  // Resource fallback never touch selection or activity.
  React.useEffect(() => {
    const intent = props.focusIntent;
    if (intent === null || intent.nonce === lastNonce.current) return;
    lastNonce.current = intent.nonce;
    const targetsCandidateWorktree =
      intent.worktreeId !== null &&
      props.candidates.worktrees.some((candidate) => candidate.worktreeId === intent.worktreeId);
    const targetsFallback =
      intent.worktreeId === null &&
      props.candidates.worktrees.length === 0 &&
      props.candidates.fallback?.docKey === intent.docKey;
    if (intent.source === "manual") {
      if (targetsCandidateWorktree) {
        if (intent.preferredUnitId !== null) setSelectedUnitId(intent.preferredUnitId);
        setPinnedWorktreeId(intent.worktreeId);
        setActivity((previous) => previous.filter((id) => id !== intent.worktreeId));
      } else if (targetsFallback && intent.preferredUnitId !== null) {
        setSelectedUnitId(intent.preferredUnitId);
      }
      setExpanded(true);
      return;
    }
    // Operation intents update the Unit selection only for the active Resource
    // fallback, or for a Worktree candidate while unpinned or pinned to it; an
    // operation for another pinned-away Worktree only marks it new.
    const mayUpdateUnit =
      targetsFallback ||
      (targetsCandidateWorktree &&
        (pinnedWorktreeId === null || intent.worktreeId === pinnedWorktreeId));
    if (mayUpdateUnit && intent.preferredUnitId !== null) setSelectedUnitId(intent.preferredUnitId);
    if (
      targetsCandidateWorktree &&
      pinnedWorktreeId !== null &&
      intent.worktreeId !== pinnedWorktreeId
    ) {
      const worktreeId = intent.worktreeId as string;
      setActivity((previous) =>
        previous.includes(worktreeId) ? previous : [...previous, worktreeId],
      );
    }
  }, [props.focusIntent, props.candidates, pinnedWorktreeId]);

  if (currentCandidate === null && fallback === null) return <></>;

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, textarea"))
      return;
    dragOrigin.current = {
      pointerId: event.pointerId,
      x: event.clientX - dragOffset.x,
      y: event.clientY - dragOffset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const origin = dragOrigin.current;
    if (origin === null || origin.pointerId !== event.pointerId) return;
    setDragOffset({ x: event.clientX - origin.x, y: event.clientY - origin.y });
  };
  const onPointerUp = (event: React.PointerEvent<HTMLElement>): void => {
    if (dragOrigin.current?.pointerId !== event.pointerId) return;
    dragOrigin.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const selectWorktree = (candidate: SessionWorktreeCandidate): void => {
    setPinnedWorktreeId(candidate.worktreeId);
    setSelectedUnitId(candidate.preferredUnitId ?? undefined);
    setActivity((previous) => previous.filter((id) => id !== candidate.worktreeId));
  };

  return (
    <>
      {currentCandidate !== null ? (
        <WorktreeCard
          {...(props.sessionId === undefined ? {} : { sessionId: props.sessionId })}
          candidate={currentCandidate}
          worktree={liveWorktreeOf(currentCandidate)}
          state={props.states[currentCandidate.docKey]}
          stateError={props.errors[currentCandidate.docKey]}
          worktreeNav={
            props.candidates.worktrees.length > 1 ? (
              <WorktreeNavigation
                active={activeWorktrees}
                processed={processedWorktrees}
                processedOpen={processedOpen}
                currentWorktreeId={currentCandidate.worktreeId}
                activity={activity}
                nameOf={(entry) => liveWorktreeOf(entry)?.name || entry.label || t("card.title")}
                statusOf={liveStatusOf}
                t={t}
                onToggleProcessed={() => setProcessedOpen((value) => !value)}
                onSelect={selectWorktree}
              />
            ) : null
          }
          expanded={expanded}
          navigationOpen={navigationOpen}
          selectedUnitId={selectedUnitId}
          navigation={props.navigation}
          runtime={props}
          onExpand={() => setExpanded(true)}
          onCollapse={() => setExpanded(false)}
          onToggleNavigation={() => setNavigationOpen((value) => !value)}
          onSelectUnit={setSelectedUnitId}
          onDismiss={props.onDismiss}
          dragOffset={dragOffset}
          dragging={dragging}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ) : fallback !== null ? (
        <ResourceCard
          fallback={fallback}
          state={props.states[fallback.docKey]}
          stateError={props.errors[fallback.docKey]}
          expanded={expanded}
          navigation={props.navigation}
          runtime={props}
          onExpand={() => setExpanded(true)}
          onCollapse={() => setExpanded(false)}
          onDismiss={props.onDismiss}
          dragOffset={dragOffset}
          dragging={dragging}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ) : null}
    </>
  );
}

/* ————— Worktree mode ————— */

function WorktreeCard(props: {
  readonly sessionId?: string;
  readonly candidate: SessionWorktreeCandidate;
  readonly worktree: DocumentWorktreeState | undefined;
  readonly state: DocumentFileState | undefined;
  readonly stateError: string | undefined;
  readonly worktreeNav: React.ReactNode;
  readonly expanded: boolean;
  readonly navigationOpen: boolean;
  readonly selectedUnitId: string | undefined;
  readonly navigation: WorkspaceNavigationStore;
  readonly runtime: ViewerRuntimeProps;
  readonly onExpand: () => void;
  readonly onCollapse: () => void;
  readonly onToggleNavigation: () => void;
  readonly onSelectUnit: (unitId: string) => void;
  readonly onDismiss: () => void;
  readonly dragOffset: { readonly x: number; readonly y: number };
  readonly dragging: boolean;
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
}): React.ReactElement {
  const { candidate, worktree, state, expanded, runtime } = props;
  const t = runtime.t;
  const status: TurnCardStatus =
    state === undefined
      ? props.stateError === undefined
        ? "loading"
        : "unavailable"
      : (worktree?.status ?? "unavailable");
  const units = worktree?.units ?? [];
  const selectedUnit =
    props.selectedUnitId !== undefined && units.some((unit) => unit.unitId === props.selectedUnitId)
      ? props.selectedUnitId
      : candidate.preferredUnitId !== null &&
          units.some((unit) => unit.unitId === candidate.preferredUnitId)
        ? candidate.preferredUnitId
        : units[0]?.unitId;
  const title = worktree?.name || candidate.label || t("card.title");
  const updatedAt = worktree === undefined ? null : formatOptionalDateTime(worktree.updatedAt);

  const collapsedMeta = null;
  const expandedMetaParts: string[] = [];
  if (worktree !== undefined) {
    if (worktree.kind === "team" && worktree.teamSpace !== null)
      expandedMetaParts.push(worktree.teamSpace.name);
    expandedMetaParts.push(worktree.creator.displayName);
    if (updatedAt !== null) expandedMetaParts.push(updatedAt);
  }

  const canOpenMiddle =
    state !== undefined && worktree !== undefined && worktree.name.trim() !== "";
  const openMiddle = (): void => {
    if (!canOpenMiddle || state === undefined || worktree === undefined) return;
    props.navigation.dispatch({
      type: "open-content",
      contentSurface: {
        kind: "worktree",
        workspaceOrigin: state.workspaceOrigin,
        worktreeId: candidate.worktreeId,
        name: worktree.name,
        unitId: null,
        ...(props.sessionId === undefined ? {} : { sessionId: props.sessionId }),
      },
    });
  };

  const resolvedViewer = expanded
    ? resolveViewerTarget({
        status,
        units,
        selectedUnit,
        state,
        worktree,
        fallbackUnitId: candidate.preferredUnitId,
        fallbackUnitType: candidate.preferredUnitType,
        worktreeId: candidate.worktreeId,
      })
    : undefined;
  const viewer = resolvedViewer === undefined ? undefined : { ...resolvedViewer, editable: false };
  const selectedName = units.find((unit) => unit.unitId === selectedUnit)?.name ?? title;

  const openMiddleButton = (
    <Button variant="ghost" size="sm" disabled={!canOpenMiddle} onClick={openMiddle}>
      <ExternalLinkIcon />
      {t("task.openMiddle")}
    </Button>
  );

  return (
    <section
      className={css.card}
      data-task-context-card=""
      data-expanded={expanded || undefined}
      data-status={status}
      data-worktree-id={candidate.worktreeId}
      data-dragging={props.dragging || undefined}
      style={{ transform: `translate(${props.dragOffset.x}px, ${props.dragOffset.y}px)` }}
      data-nav-worktree={expanded && props.worktreeNav !== null ? true : undefined}
      data-nav-unit={expanded && props.navigationOpen && units.length > 0 ? true : undefined}
      aria-label={title}
    >
      <header
        className={css.header}
        onPointerDown={props.onPointerDown}
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
      >
        <div className={css.identity}>
          <div className={css.titleRow}>
            <strong className={css.title}>{title}</strong>
            <Badge variant={statusVariant(status)}>{statusLabel(status, t)}</Badge>
            <span className={css.fileCount}>
              {t("task.filesCount").replace("{value}", String(worktree?.unitCount ?? units.length))}
            </span>
          </div>
          {expanded ? (
            expandedMetaParts.length > 0 ? (
              <span className={css.meta}>{expandedMetaParts.join(" · ")}</span>
            ) : null
          ) : collapsedMeta !== null ? (
            <span className={css.meta}>{collapsedMeta}</span>
          ) : null}
          {expanded &&
          worktree !== undefined &&
          worktree.summary !== null &&
          worktree.summary !== "" ? (
            <p className={css.summary}>{worktree.summary}</p>
          ) : null}
        </div>
        {expanded ? (
          <div className={css.controls}>
            {units.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={props.navigationOpen}
                title={t(props.navigationOpen ? "task.unitNav.close" : "task.unitNav.open")}
                onClick={props.onToggleNavigation}
              >
                <ListTreeIcon />
                {t(props.navigationOpen ? "task.unitNav.close" : "task.unitNav.open")}
              </Button>
            ) : null}
            {openMiddleButton}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={expanded}
              aria-label={t("task.collapse")}
              title={t("task.collapse")}
              onClick={props.onCollapse}
            >
              <ChevronDownIcon />
            </Button>
            <CloseCardButton t={t} onDismiss={props.onDismiss} />
          </div>
        ) : (
          <CloseCardButton t={t} onDismiss={props.onDismiss} />
        )}
      </header>

      {expanded ? null : (
        <div className={css.actions}>
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={expanded}
            aria-label={t("task.expand")}
            title={t("task.expand")}
            onClick={props.onExpand}
          >
            <ChevronDownIcon className={css.chevronUp} />
            <span className={css.changeSummary}>
              {t("task.filesCount").replace("{value}", String(worktree?.unitCount ?? units.length))}
            </span>
          </Button>
        </div>
      )}

      {expanded ? (
        <div className={css.body}>
          {props.worktreeNav}
          <div className={css.worktreePane}>
            {props.navigationOpen && units.length > 0 ? (
              <nav className={css.unitNavigation} aria-label={t("task.unitNav.aria")}>
                {units.map((unit) => {
                  const selected = unit.unitId === selectedUnit;
                  return (
                    <button
                      key={unit.unitId}
                      type="button"
                      className={css.unitRow}
                      data-selected={selected || undefined}
                      data-deleted={unit.kind === "deleted" || undefined}
                      aria-pressed={selected}
                      onClick={() => props.onSelectUnit(unit.unitId)}
                    >
                      <UnitTypeIcon type={unit.unitType} />
                      <span className={css.unitName}>{unit.name}</span>
                      <span className={css.unitChange} data-kind={unit.kind}>
                        {unitChangeLabel(unit.kind, t)}
                      </span>
                    </button>
                  );
                })}
              </nav>
            ) : null}
            <div className={css.preview}>
              <div className={css.previewHeader}>
                <Badge variant="outline">{t("task.previewBadge")}</Badge>
                <span className={css.previewName}>{selectedName}</span>
              </div>
              {viewer === undefined ? (
                <div
                  className={css.notice}
                  role={props.stateError === undefined ? "status" : "alert"}
                >
                  {props.stateError === undefined
                    ? statusLabel(status, t)
                    : `${t("window.loadFailed")}: ${props.stateError}`}
                </div>
              ) : (
                <div className={css.viewer}>
                  <PanelViewer
                    key={viewerKey(viewer)}
                    viewer={viewer}
                    runtime={runtime}
                    worktreeId={candidate.worktreeId}
                    status={status}
                    worktreeName={title}
                    units={units}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Left one-level Worktree switcher; rendered only for multi-Worktree sessions. */
function WorktreeNavigation(props: {
  readonly active: readonly SessionWorktreeCandidate[];
  readonly processed: readonly SessionWorktreeCandidate[];
  readonly processedOpen: boolean;
  readonly currentWorktreeId: string;
  readonly activity: readonly string[];
  /** The live product name wins; the candidate label is only a fallback. */
  readonly nameOf: (candidate: SessionWorktreeCandidate) => string;
  readonly statusOf: (candidate: SessionWorktreeCandidate) => WorktreeStatus | undefined;
  readonly t: (key: UniverLocaleKey) => string;
  readonly onToggleProcessed: () => void;
  readonly onSelect: (candidate: SessionWorktreeCandidate) => void;
}): React.ReactElement {
  const t = props.t;
  const renderRow = (candidate: SessionWorktreeCandidate): React.ReactElement => {
    const selected = candidate.worktreeId === props.currentWorktreeId;
    const status = props.statusOf(candidate);
    const hasNews = props.activity.includes(candidate.worktreeId);
    return (
      <button
        key={candidate.worktreeId}
        type="button"
        className={css.worktreeRow}
        data-selected={selected || undefined}
        aria-pressed={selected}
        onClick={() => props.onSelect(candidate)}
      >
        <span className={css.worktreeName}>{props.nameOf(candidate)}</span>
        {hasNews ? <span className={css.activityNew}>{t("task.new")}</span> : null}
        {status === undefined ? null : (
          <Badge variant={statusVariant(status)}>{statusLabel(status, t)}</Badge>
        )}
      </button>
    );
  };
  return (
    <nav className={css.worktreeNavigation} aria-label={t("task.worktreeNav")}>
      {props.active.length > 0 ? (
        <div className={css.worktreeGroup}>
          <p className={css.worktreeGroupLabel}>{t("task.group.active")}</p>
          {props.active.map(renderRow)}
        </div>
      ) : null}
      {props.processed.length > 0 ? (
        <div className={css.worktreeGroup}>
          <button
            type="button"
            className={css.worktreeGroupToggle}
            aria-expanded={props.processedOpen}
            onClick={props.onToggleProcessed}
          >
            <ChevronRightIcon className={props.processedOpen ? css.chevronDown : undefined} />
            {t("task.group.processed")}
            <span className={css.worktreeGroupCount}>{props.processed.length}</span>
          </button>
          {props.processedOpen ? props.processed.map(renderRow) : null}
        </div>
      ) : null}
    </nav>
  );
}

/* ————— Trunk Resource fallback mode (no Worktree candidate exists) ————— */

function ResourceCard(props: {
  readonly fallback: SessionResourceFallback;
  readonly state: DocumentFileState | undefined;
  readonly stateError: string | undefined;
  readonly expanded: boolean;
  readonly navigation: WorkspaceNavigationStore;
  readonly runtime: ViewerRuntimeProps;
  readonly onExpand: () => void;
  readonly onCollapse: () => void;
  readonly onDismiss: () => void;
  readonly dragOffset: { readonly x: number; readonly y: number };
  readonly dragging: boolean;
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
}): React.ReactElement {
  const { fallback, state, expanded, runtime } = props;
  const t = runtime.t;
  const status: TurnCardStatus =
    state === undefined ? (props.stateError === undefined ? "loading" : "unavailable") : "trunk";
  const title = fallback.label ?? t("card.title");

  const canOpenMiddle = state !== undefined;
  const openMiddle = (): void => {
    if (state === undefined) return;
    props.navigation.dispatch({
      type: "open-content",
      contentSurface: {
        kind: "resource",
        workspaceOrigin: state.workspaceOrigin,
        resourceId: fallback.resourceId,
        docKey: `res:${fallback.resourceId}`,
        name: title,
        unitType: fallback.unitType ?? state.viewerTarget?.unitType ?? null,
      },
    });
  };

  const viewer = expanded
    ? resolveViewerTarget({
        status,
        units: [],
        selectedUnit: fallback.preferredUnitId ?? undefined,
        state,
        worktree: undefined,
        fallbackUnitId: fallback.preferredUnitId,
        fallbackUnitType: fallback.unitType,
        worktreeId: null,
      })
    : undefined;

  const openMiddleButton = (
    <Button variant="ghost" size="sm" disabled={!canOpenMiddle} onClick={openMiddle}>
      <ExternalLinkIcon />
      {t("task.openMiddle")}
    </Button>
  );

  return (
    <section
      className={css.card}
      data-task-context-card=""
      data-expanded={expanded || undefined}
      data-status={status}
      data-resource-id={fallback.resourceId}
      data-dragging={props.dragging || undefined}
      style={{ transform: `translate(${props.dragOffset.x}px, ${props.dragOffset.y}px)` }}
      aria-label={title}
    >
      <header
        className={css.header}
        onPointerDown={props.onPointerDown}
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
      >
        <div className={css.identity}>
          <div className={css.titleRow}>
            <UnitTypeIcon type={fallback.unitType ?? state?.viewerTarget?.unitType ?? ""} />
            <strong className={css.title}>{title}</strong>
          </div>
        </div>
        {expanded ? (
          <div className={css.controls}>
            {openMiddleButton}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={expanded}
              aria-label={t("task.collapse")}
              title={t("task.collapse")}
              onClick={props.onCollapse}
            >
              <ChevronDownIcon />
            </Button>
            <CloseCardButton t={t} onDismiss={props.onDismiss} />
          </div>
        ) : (
          <CloseCardButton t={t} onDismiss={props.onDismiss} />
        )}
      </header>

      {expanded ? null : (
        <div className={css.actions}>
          <Button variant="secondary" size="sm" aria-expanded={expanded} onClick={props.onExpand}>
            <ChevronDownIcon className={css.chevronUp} />
            {t("task.expand")}
          </Button>
          {openMiddleButton}
        </div>
      )}

      {expanded ? (
        <div className={css.body}>
          <div className={css.preview}>
            <div className={css.previewHeader}>
              <Badge variant="outline">{t("task.previewBadge")}</Badge>
              <span className={css.previewName}>{title}</span>
            </div>
            {viewer === undefined ? (
              <div
                className={css.notice}
                role={props.stateError === undefined ? "status" : "alert"}
              >
                {props.stateError === undefined
                  ? statusLabel(status, t)
                  : `${t("window.loadFailed")}: ${props.stateError}`}
              </div>
            ) : (
              <div className={css.viewer}>
                <PanelViewer key={viewerKey(viewer)} viewer={viewer} runtime={runtime} />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ————— Local presentation helpers ————— */

function CloseCardButton(props: {
  readonly t: (key: UniverLocaleKey) => string;
  readonly onDismiss: () => void;
}): React.ReactElement {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={props.t("dock.close")}
      title={props.t("dock.close")}
      onClick={props.onDismiss}
    >
      <CloseIcon />
    </Button>
  );
}

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
