/**
 * The Unit accordion stream of the middle Worktree review surface. Every Unit
 * starts expanded (the confirmed default for this surface, unlike the
 * in-message Changes card); expensive Univer runtimes mount only near the
 * viewport and are retained under a bounded LRU after scrolling away. Each
 * item shows the Unit's real `Space / clipped path / name` location with a
 * low-emphasis "共享文件" mark for Direct Share Units, and degrades to a safe
 * "位置不可用" state when the server cannot resolve a location — it never
 * fabricates a place in the current user's file tree.
 * @module dsh-univer-workspace-plugin/client/components/worktree-review/WorktreeUnitAccordion
 */

import { useEffect, useRef, type ReactElement } from "react";
import {
  Badge,
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  PlusIcon,
  Segmented,
  TrashIcon,
  type SegmentedOption,
} from "@univerjs/univer-workspace-ui";
import type { DocumentWorktreeState, WorktreeUnitView } from "../../../shared/state.ts";
import { PanelViewer, type ViewerRuntimeProps } from "../review-panel.tsx";
import {
  activeViewerMode,
  canViewAgentDraft,
  canViewMergePreview,
  canViewTrunk,
  mergeResultLabel,
  mergeResultVariant,
  resolveTurnViewer,
  unitChangeLabel,
  viewerKey,
  type TurnViewMode,
} from "../turn-context-card-model.ts";
import type { UnitLocationMap } from "./use-unit-locations.ts";
import type { ViewportMount } from "./use-viewport-mount.ts";
import type {
  WorkspaceResourceDescriptor,
  WorkspaceResourceReferenceInsertResult,
} from "../../workspace-resource-reference.ts";
import type { ViewerSelection } from "../../viewer/contracts.ts";
import { unitLocationTitle } from "./worktree-review-model.ts";
import { UnitChangeIcon, UnitTypeIcon } from "./unit-markers.tsx";
import css from "./WorktreeUnitAccordion.module.scss";

export interface WorktreeUnitAccordionProps {
  readonly worktree: DocumentWorktreeState;
  readonly units: readonly WorktreeUnitView[];
  readonly locations: UnitLocationMap;
  readonly expandedIds: ReadonlySet<string>;
  readonly locatedUnitId: string | null;
  readonly viewByUnitId: Readonly<Record<string, TurnViewMode>>;
  readonly mount: ViewportMount;
  readonly runtime: ViewerRuntimeProps;
  readonly insertResourceReference: (
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
    selection?: ViewerSelection,
  ) => WorkspaceResourceReferenceInsertResult;
  readonly onToggle: (unitId: string) => void;
  readonly onViewChange: (unitId: string, mode: TurnViewMode) => void;
}

export function WorktreeUnitAccordion(props: WorktreeUnitAccordionProps): ReactElement {
  return (
    <ul className={css.stream}>
      {props.units.map((unit) => (
        <WorktreeUnitItem
          key={unit.unitId}
          worktree={props.worktree}
          unit={unit}
          location={props.locations[unit.unitId] ?? { status: "loading" }}
          expanded={props.expandedIds.has(unit.unitId)}
          located={props.locatedUnitId === unit.unitId}
          view={props.viewByUnitId[unit.unitId] ?? "agent"}
          mount={props.mount}
          runtime={props.runtime}
          insertResourceReference={props.insertResourceReference}
          onToggle={() => props.onToggle(unit.unitId)}
          onViewChange={(mode) => props.onViewChange(unit.unitId, mode)}
        />
      ))}
    </ul>
  );
}

function WorktreeUnitItem(props: {
  readonly worktree: DocumentWorktreeState;
  readonly unit: WorktreeUnitView;
  readonly location: UnitLocationMap[string];
  readonly expanded: boolean;
  readonly located: boolean;
  readonly view: TurnViewMode;
  readonly mount: ViewportMount;
  readonly runtime: ViewerRuntimeProps;
  readonly insertResourceReference: (
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
    selection?: ViewerSelection,
  ) => WorkspaceResourceReferenceInsertResult;
  readonly onToggle: () => void;
  readonly onViewChange: (mode: TurnViewMode) => void;
}): ReactElement {
  const { worktree, unit, runtime } = props;
  const t = runtime.t;
  const itemRef = useRef<HTMLLIElement | null>(null);
  const register = props.mount.register;

  useEffect(() => register(unit.unitId, itemRef.current), [register, unit.unitId]);

  useEffect(() => {
    if (props.located) itemRef.current?.scrollIntoView({ block: "start" });
  }, [props.located]);

  const activeView = activeViewerMode(props.view, worktree, unit);
  const previewable = activeView !== "agent" || unit.kind !== "deleted";
  const resolvedViewer =
    props.expanded && previewable ? resolveTurnViewer(worktree, unit, activeView) : undefined;
  // Worktree is a human review surface. The Agent Draft can be writable in
  // the execution model, but it is never an editing surface for the Browser;
  // all changes go through the Agent and lifecycle actions remain in the
  // review header.
  const viewer = resolvedViewer === undefined ? undefined : { ...resolvedViewer, editable: false };
  const mergeResult = unit.mergeResult;
  const locationTitle = unitLocationTitle(props.location, unit.name);
  const viewOptions: SegmentedOption<TurnViewMode>[] = [
    { value: "trunk", label: t("turn.view.trunk"), disabled: !canViewTrunk(unit) },
    { value: "agent", label: t("turn.view.agent"), disabled: !canViewAgentDraft(worktree) },
    ...(canViewMergePreview(worktree)
      ? [{ value: "preview" as const, label: t("turn.view.preview") }]
      : []),
  ];

  return (
    <li
      ref={itemRef}
      className={css.item}
      data-review-unit-id={unit.unitId}
      data-located={props.located || undefined}
    >
      <button
        type="button"
        className={css.itemHeader}
        aria-expanded={props.expanded}
        data-deleted={unit.kind === "deleted" || undefined}
        onClick={props.onToggle}
      >
        {props.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <UnitTypeIcon type={unit.unitType} className={css.headerTypeIcon} />
        <span className={css.unitName} title={locationTitle}>
          {locationTitle}
        </span>
        <span className={css.unitChange}>
          <UnitChangeIcon kind={unit.kind} />
          {unitChangeLabel(unit.kind, t)}
        </span>
        {mergeResult === "pending" ? null : (
          <Badge variant={mergeResultVariant(mergeResult)}>
            {mergeResultLabel(mergeResult, t)}
          </Badge>
        )}
      </button>
      {props.expanded ? (
        <div className={css.itemBody}>
          <div className={css.unitHeader}>
            <div className={css.controls}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("resource.addToMessage")}
                title={t("resource.addToMessage")}
                onClick={() =>
                  props.insertResourceReference({
                    resourceId: unit.resourceId,
                    name: unit.name,
                  })
                }
              >
                <MessageSquareIcon />
                <PlusIcon className={css.addBadge} />
              </Button>
              <Badge variant="outline">
                {t(viewer !== undefined && viewer.editable ? "card.editable" : "card.readonly")}
              </Badge>
              <Segmented<TurnViewMode>
                aria-label={t("viewer.readOnlyPreview")}
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
              <span>{t("turn.deletedPreview")}</span>
            </div>
          ) : viewer === undefined ? (
            <div className={css.notice} role="status">
              {t("dock.unavailable")}
            </div>
          ) : viewer.unitType === "unsupported" ? (
            <div className={css.notice} role="status">
              {t("window.unsupportedType")}
            </div>
          ) : (
            <div className={css.viewerBox} data-view-mode={activeView}>
              {props.mount.shouldMount(unit.unitId) ? (
                <PanelViewer
                  key={viewerKey(viewer)}
                  viewer={viewer}
                  runtime={runtime}
                  resource={{ resourceId: unit.resourceId, name: unit.name }}
                  insertResourceReference={props.insertResourceReference}
                />
              ) : (
                <div className={css.viewerPlaceholder} role="status">
                  {t("window.loading")}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
