/**
 * Full-height middle Workspace surface for one Worktree: an independent
 * Changes review shell with a real header (title / description / status /
 * creator / team scope / capability-driven lifecycle actions), a collapsible
 * smart path tree over the Units' real Spaces, and a default-expanded Unit
 * accordion stream whose Viewers mount near the viewport and are retained
 * under a bounded LRU. It reuses only the shared Viewer kernel (`PanelViewer`)
 * and public workspace-ui components — never the Conversation card chrome.
 * @module dsh-univer-workspace-plugin/client/components/WorkspaceWorktreeViewer
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Button, ChevronDownIcon, ChevronRightIcon } from "@univerjs/univer-workspace-ui";
import type { DocumentFileState } from "../../shared/state.ts";
import { getFileState } from "../api/univer-api.ts";
import type { UniverLocaleKey } from "../locales.ts";
import type { WorkspaceWorktreeSurface } from "../navigation/workspace-navigation.ts";
import type { ViewerBootstrap } from "../viewer-bootstrap.ts";
import type { ViewerLocale } from "../viewer-locale.ts";
import type { TurnViewMode } from "./turn-context-card-model.ts";
import type {
  WorkspaceResourceDescriptor,
  WorkspaceResourceReferenceInsertResult,
} from "../workspace-resource-reference.ts";
import type { ViewerSelection } from "../viewer/contracts.ts";
import { useUnitLocations } from "./worktree-review/use-unit-locations.ts";
import { useViewportMount } from "./worktree-review/use-viewport-mount.ts";
import { WorktreePathTree } from "./worktree-review/WorktreePathTree.tsx";
import { WorktreeReviewHeader } from "./worktree-review/WorktreeReviewHeader.tsx";
import { WorktreeUnitAccordion } from "./worktree-review/WorktreeUnitAccordion.tsx";
import { buildPathTree, type PathTreeUnitEntry } from "./worktree-review/worktree-review-model.ts";
import surfaceCss from "./WorkspaceResourceViewer.module.scss";
import css from "./WorkspaceWorktreeViewer.module.scss";

/** Mounted-Viewer retention budget (the confirmed keep-with-LRU policy). */
const VIEWER_LRU_CAPACITY = 3;

type WorktreeFileState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: DocumentFileState }
  | { readonly status: "error"; readonly message: string };

export interface WorkspaceWorktreeViewerProps {
  readonly target: WorkspaceWorktreeSurface;
  readonly surfaceLeft: number | null;
  readonly surfaceWidth: number;
  readonly onClose: () => void;
  readonly loadViewerBootstrap: () => Promise<ViewerBootstrap>;
  readonly getViewerLocale: () => ViewerLocale;
  readonly t: (key: UniverLocaleKey) => string;
  readonly insertResourceReference: (
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
    selection?: ViewerSelection,
  ) => WorkspaceResourceReferenceInsertResult;
}

export function WorkspaceWorktreeViewer(props: WorkspaceWorktreeViewerProps): ReactElement {
  const [fileState, setFileState] = useState<WorktreeFileState>({ status: "loading" });
  const [mutationVersion, setMutationVersion] = useState(0);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  // null = the user has not toggled anything; every Unit stays expanded.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [viewByUnitId, setViewByUnitId] = useState<Readonly<Record<string, TurnViewMode>>>({});
  const [locatedUnitId, setLocatedUnitId] = useState<string | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const locateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLocateDoneRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    // Keep an already rendered review page visible while the periodic refresh
    // is in flight. Remote Workspaces can take several seconds to answer; if
    // every refresh replaced ready data with a loading state, the page would
    // flicker forever and never expose Changes on a slow connection.
    setFileState((current) => (current.status === "ready" ? current : { status: "loading" }));
    void getFileState(`wt:${props.target.worktreeId}`, controller.signal)
      .then((value) => setFileState({ status: "ready", value }))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setFileState({
          status: "error",
          message: reason instanceof Error ? reason.message : String(reason),
        });
      });
    return () => controller.abort();
  }, [props.target.worktreeId, mutationVersion]);

  useEffect(() => {
    initialLocateDoneRef.current = false;
    setCollapsedIds(new Set());
    setViewByUnitId({});
    setLocatedUnitId(null);
  }, [props.target.worktreeId]);

  // Univer measures its canvas on the window resize signal. The review surface
  // can also change width without a window resize, so forward that layout
  // change to the embedded read-only viewer.
  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [props.surfaceWidth]);

  const state = fileState.status === "ready" ? fileState.value : undefined;
  const worktree = state?.worktrees.find(
    (candidate) => candidate.worktreeId === props.target.worktreeId,
  );
  const units = useMemo(() => worktree?.units ?? [], [worktree]);
  const unitIds = useMemo(() => units.map((unit) => unit.unitId), [units]);

  const expandedIds = useMemo(() => {
    const expanded = new Set<string>();
    for (const unitId of unitIds) if (!collapsedIds.has(unitId)) expanded.add(unitId);
    return expanded;
  }, [unitIds, collapsedIds]);

  const locations = useUnitLocations(units, mutationVersion);
  const mount = useViewportMount(scrollRootRef, unitIds, expandedIds, VIEWER_LRU_CAPACITY);

  const pathTree = useMemo(() => {
    const entries: PathTreeUnitEntry[] = [];
    for (const unit of units) {
      const location = locations[unit.unitId];
      if (location === undefined || location.status !== "resolved") continue;
      entries.push({
        unitId: unit.unitId,
        name: unit.name,
        deleted: unit.kind === "deleted",
        shared: location.shared,
        spaceId: location.spaceId,
        spaceName: location.spaceName,
        path: location.path,
      });
    }
    return buildPathTree(entries);
  }, [units, locations]);

  const unavailableUnits = useMemo(
    () =>
      units
        .filter((unit) => locations[unit.unitId]?.status === "unavailable")
        .map((unit) => ({
          unitId: unit.unitId,
          name: unit.name,
          unitType: unit.unitType,
          deleted: unit.kind === "deleted",
        })),
    [units, locations],
  );
  const loadingUnits = useMemo(
    () =>
      pathTree.length > 0
        ? []
        : units
            .filter((unit) => locations[unit.unitId]?.status === "loading")
            .map((unit) => ({
              unitId: unit.unitId,
              name: unit.name,
              unitType: unit.unitType,
              deleted: unit.kind === "deleted",
            })),
    [units, locations, pathTree.length],
  );

  const unitTypeOf = (unitId: string): string =>
    units.find((unit) => unit.unitId === unitId)?.unitType ?? "";
  const unitKindOf = (unitId: string) => units.find((unit) => unit.unitId === unitId)?.kind ?? "unchanged";

  const locateUnit = (unitId: string): void => {
    setCollapsedIds((current) => {
      if (!current.has(unitId)) return current;
      const next = new Set(current);
      next.delete(unitId);
      return next;
    });
    if (locateTimerRef.current !== null) clearTimeout(locateTimerRef.current);
    setLocatedUnitId(unitId);
    locateTimerRef.current = setTimeout(() => setLocatedUnitId(null), 1600);
  };

  // A surface opened for a specific Unit scrolls to it once data arrives.
  useEffect(() => {
    if (initialLocateDoneRef.current || units.length === 0) return;
    const preferred = props.target.unitId;
    if (preferred === null || !unitIds.includes(preferred)) return;
    initialLocateDoneRef.current = true;
    locateUnit(preferred);
  }, [units, unitIds, props.target.unitId]);

  const toggleUnit = (unitId: string): void => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.add(unitId);
      }
      return next;
    });
  };

  const surfaceStyle = {
    "--uwh-resource-surface-left":
      props.surfaceLeft === null ? undefined : `${props.surfaceLeft}px`,
    "--uwh-resource-surface-width": `${props.surfaceWidth}px`,
  } as CSSProperties & {
    "--uwh-resource-surface-left": string | undefined;
    "--uwh-resource-surface-width": string;
  };

  const reviewable = worktree !== undefined && worktree.capabilities.review;

  return (
    <section className={surfaceCss.surface} style={surfaceStyle} aria-label={props.target.name}>
      <WorktreeReviewHeader
        worktree={worktree}
        workspaceOrigin={state?.workspaceOrigin ?? props.target.workspaceOrigin}
        fallbackName={props.target.name}
        t={props.t}
        onClose={props.onClose}
        onActionSettled={() => setMutationVersion((value) => value + 1)}
      />
      <div className={surfaceCss.content}>
        {fileState.status === "loading" ? (
          <div className={surfaceCss.status} role="status">
            {props.t("window.loading")}
          </div>
        ) : fileState.status === "error" ? (
          <div className={surfaceCss.statusError} role="alert">
            {`${props.t("window.loadFailed")}: ${fileState.message}`}
          </div>
        ) : worktree === undefined ? (
          <div className={surfaceCss.status} role="status">
            {props.t("dock.unavailable")}
          </div>
        ) : !reviewable ? (
          <div className={surfaceCss.status} role="status">
            {props.t("turn.noReview")}
          </div>
        ) : units.length === 0 ? (
          <div className={surfaceCss.status} role="status">
            {props.t("worktree.noDocumentChanges")}
          </div>
        ) : (
          <div className={css.changes}>
            <div className={css.changesHeader}>
              <h2 className={css.changesTitle}>{props.t("worktree.changes")}</h2>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={!treeCollapsed}
                aria-label={
                  treeCollapsed ? props.t("worktree.expandPath") : props.t("worktree.collapsePath")
                }
                title={
                  treeCollapsed ? props.t("worktree.expandPath") : props.t("worktree.collapsePath")
                }
                onClick={() => setTreeCollapsed((value) => !value)}
              >
                {treeCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                {props.t("worktree.path")}
              </Button>
            </div>
            <div className={css.changesBody} data-tree-collapsed={treeCollapsed || undefined}>
              {treeCollapsed ? null : (
                <WorktreePathTree
                  spaces={pathTree}
                  loadingUnits={loadingUnits}
                  unavailableUnits={unavailableUnits}
                  unitTypeOf={unitTypeOf}
                  unitKindOf={unitKindOf}
                  locatedUnitId={locatedUnitId}
                  onLocate={locateUnit}
                  t={props.t}
                />
              )}
              <div ref={scrollRootRef} className={css.accordionScroll}>
                <WorktreeUnitAccordion
                  worktree={worktree}
                  units={units}
                  locations={locations}
                  expandedIds={expandedIds}
                  locatedUnitId={locatedUnitId}
                  viewByUnitId={viewByUnitId}
                  mount={mount}
                  runtime={props}
                  insertResourceReference={props.insertResourceReference}
                  onToggle={toggleUnit}
                  onViewChange={(unitId, mode) =>
                    setViewByUnitId((current) => ({ ...current, [unitId]: mode }))
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
