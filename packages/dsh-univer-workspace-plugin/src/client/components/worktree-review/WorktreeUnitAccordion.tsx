/**
 * The Unit accordion stream of the middle Worktree review surface. Every Unit
 * starts expanded (the confirmed default for this surface, unlike the
 * in-message Changes card); expensive Univer runtimes mount only near the
 * viewport and are retained under a bounded LRU after scrolling away. Each
 * item shows the Unit's server-clipped `path / name` location with a
 * low-emphasis "共享文件" mark for Direct Share Units, and degrades to a safe
 * "位置不可用" state when the server cannot resolve a location — it never
 * fabricates a place in the current user's file tree.
 * @module dsh-univer-workspace-plugin/client/components/worktree-review/WorktreeUnitAccordion
 */

import { useEffect, useRef, useState, useId, type RefObject, type ReactElement } from "react";
import {
  Badge,
  CheckIcon,
  EllipsisIcon,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquarePlusIcon,
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
  hasUnitMergeProblem,
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
import { postWorktreeUnitRemoval } from "../../api/univer-api.ts";
import { useReviewHeight } from "./use-review-height.ts";
import css from "./WorktreeUnitAccordion.module.scss";

export interface WorktreeUnitAccordionProps {
  readonly scrollRootRef: RefObject<HTMLElement | null>;
  readonly worktree: DocumentWorktreeState;
  readonly units: readonly WorktreeUnitView[];
  readonly locations: UnitLocationMap;
  readonly expandedIds: ReadonlySet<string>;
  readonly locatedUnitId: string | null;
  readonly locateVersion: number;
  readonly viewByUnitId: Readonly<Record<string, TurnViewMode>>;
  readonly mount: ViewportMount;
  readonly runtime: ViewerRuntimeProps;
  readonly insertResourceReference: (
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
    selection?: ViewerSelection,
  ) => WorkspaceResourceReferenceInsertResult;
  readonly onActionSettled: () => void;
  readonly onToggle: (unitId: string) => void;
  readonly onViewChange: (unitId: string, mode: TurnViewMode) => void;
}

export function WorktreeUnitAccordion(props: WorktreeUnitAccordionProps): ReactElement {
  return (
    <ul className={css.stream}>
      {props.units.map((unit) => (
        <WorktreeUnitItem
          key={`${props.worktree.worktreeId}:${unit.unitId}`}
          scrollRootRef={props.scrollRootRef}
          single={props.units.length === 1}
          worktree={props.worktree}
          unit={unit}
          location={props.locations[unit.unitId] ?? { status: "loading" }}
          expanded={props.expandedIds.has(unit.unitId)}
          located={props.locatedUnitId === unit.unitId}
          locateVersion={props.locateVersion}
          view={props.viewByUnitId[unit.unitId] ?? "agent"}
          mount={props.mount}
          runtime={props.runtime}
          insertResourceReference={props.insertResourceReference}
          onActionSettled={props.onActionSettled}
          onToggle={() => props.onToggle(unit.unitId)}
          onViewChange={(mode) => props.onViewChange(unit.unitId, mode)}
        />
      ))}
    </ul>
  );
}

function WorktreeUnitItem(props: {
  readonly scrollRootRef: RefObject<HTMLElement | null>;
  readonly single: boolean;
  readonly worktree: DocumentWorktreeState;
  readonly unit: WorktreeUnitView;
  readonly location: UnitLocationMap[string];
  readonly expanded: boolean;
  readonly located: boolean;
  readonly locateVersion: number;
  readonly view: TurnViewMode;
  readonly mount: ViewportMount;
  readonly runtime: ViewerRuntimeProps;
  readonly insertResourceReference: (
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
    selection?: ViewerSelection,
  ) => WorkspaceResourceReferenceInsertResult;
  readonly onActionSettled: () => void;
  readonly onToggle: () => void;
  readonly onViewChange: (mode: TurnViewMode) => void;
}): ReactElement {
  const { worktree, unit, runtime } = props;
  const t = runtime.t;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const updateRemoval = (): void => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    void postWorktreeUnitRemoval(worktree.worktreeId, unit.unitId, unit.kind !== "deleted")
      .then(props.onActionSettled)
      .catch((error: unknown) =>
        setActionError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setBusy(false));
  };
  const itemRef = useRef<HTMLLIElement | null>(null);
  const register = props.mount.register;
  const previewId = useId();

  useEffect(() => {
    register(unit.unitId, itemRef.current);
    return () => register(unit.unitId, null);
  }, [register, unit.unitId, props.expanded]);

  useEffect(() => {
    const root = props.scrollRootRef.current;
    const item = itemRef.current;
    if (!props.located || root === null || item === null) return;
    root.scrollTop += item.getBoundingClientRect().top - root.getBoundingClientRect().top;
  }, [props.located, props.locateVersion, props.expanded, props.scrollRootRef]);

  const activeView = activeViewerMode(props.view, worktree, unit);
  const previewable =
    unit.kind !== "deleted" ||
    (activeView === "trunk" && worktree.status !== "merged" && unit.nodeId !== null);
  const resolvedViewer =
    props.expanded && previewable ? resolveTurnViewer(worktree, unit, activeView) : undefined;
  // Worktree is a human review surface. The Agent Draft can be writable in
  // the execution model, but it is never an editing surface for the Browser;
  // all changes go through the Agent and lifecycle actions remain in the
  // review header.
  const viewer = resolvedViewer === undefined ? undefined : { ...resolvedViewer, editable: false };
  const sizing = useReviewHeight(
    props.scrollRootRef, itemRef, viewer !== undefined && viewer.unitType !== "unsupported", props.single,
  );
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
      <div className={css.cardHeader}>
        <div className={css.itemHeader} data-deleted={unit.kind === "deleted" || undefined}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={props.expanded}
            aria-label={`${t(props.expanded ? "review.collapseDocument" : "review.expandDocument")}: ${unit.name}`}
            title={t(props.expanded ? "review.collapseDocument" : "review.expandDocument")}
            onClick={props.onToggle}
          >
            {props.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </Button>
          <UnitTypeIcon type={unit.unitType} className={css.headerTypeIcon} />
          <span className={css.unitName} title={locationTitle}>
            {locationTitle}
          </span>
          <span className={css.unitChange}>
            <UnitChangeIcon kind={unit.kind} />
            {unitChangeLabel(unit.kind, t)}
          </span>
          {props.location.status === "resolved" && props.location.shared ? (
            <Badge variant="outline">{t("worktree.sharedFile")}</Badge>
          ) : null}
          {hasUnitMergeProblem(mergeResult) ? (
            <Badge variant={mergeResultVariant(mergeResult)}>
              {mergeResultLabel(mergeResult, t)}
            </Badge>
          ) : null}
        </div>
        {props.expanded ? (
          <div className={css.unitHeader}>
            <div className={css.controls}>
              {worktree.status === "draft" && worktree.capabilities.editDraft ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={updateRemoval}>
                  {t(unit.kind === "deleted" ? "turn.undoRemoval" : "turn.removeUnit")}
                </Button>
              ) : null}
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
                <MessageSquarePlusIcon />
              </Button>
              <Segmented<TurnViewMode>
                aria-label={t("viewer.readOnlyPreview")}
                size="sm"
                value={activeView}
                options={viewOptions}
                onValueChange={props.onViewChange}
              />
            </div>
            {viewer !== undefined && viewer.unitType !== "unsupported" ? (
              <Segmented
                aria-label={t("review.height.label")}
                size="sm"
                className={css.heightControls ?? ""}
                value={sizing.preset}
                options={[
                  { value: "compact", label: t("review.height.compact") },
                  { value: "auto", label: t("review.height.auto") },
                  { value: "fill", label: t("review.height.fill") },
                ]}
                onValueChange={sizing.setPreset}
              />
            ) : null}
            <div className={css.overflowControls}>
              <MenuRoot>
                <MenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("review.moreActions")} title={t("review.moreActions")} />}>
                  <EllipsisIcon />
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuGroup>
                    <MenuGroupLabel>{t("viewer.readOnlyPreview")}</MenuGroupLabel>
                    {viewOptions.map((option) => (
                      <MenuItem key={option.value} disabled={option.disabled === true} onClick={() => props.onViewChange(option.value)}>
                        {option.value === activeView ? <CheckIcon /> : null}{option.label}
                      </MenuItem>
                    ))}
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuItem onClick={() => props.insertResourceReference({ resourceId: unit.resourceId, name: unit.name })}>
                    <MessageSquarePlusIcon />{t("resource.addToMessage")}
                  </MenuItem>
                  {worktree.status === "draft" && worktree.capabilities.editDraft ? (
                    <MenuItem disabled={busy} onClick={updateRemoval}>
                      {t(unit.kind === "deleted" ? "turn.undoRemoval" : "turn.removeUnit")}
                    </MenuItem>
                  ) : null}
                  {viewer !== undefined && viewer.unitType !== "unsupported" ? (
                    <>
                      <MenuSeparator />
                      <MenuGroup>
                        <MenuGroupLabel>{t("review.height.label")}</MenuGroupLabel>
                        {(["compact", "auto", "fill"] as const).map((preset) => (
                          <MenuItem key={preset} onClick={() => sizing.setPreset(preset)}>
                            {sizing.preset === preset ? <CheckIcon /> : null}{t(`review.height.${preset}`)}
                          </MenuItem>
                        ))}
                      </MenuGroup>
                    </>
                  ) : null}
                </MenuContent>
              </MenuRoot>
            </div>
          </div>
        ) : null}
      </div>
      {props.expanded ? (
        <div className={css.itemBody}>
          {actionError === null ? null : <div role="alert">{actionError}</div>}
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
            <div
              ref={sizing.viewerRef}
              id={previewId}
              className={css.viewerBox}
              style={{ height: sizing.height }}
              data-view-mode={activeView}
              data-height-mode={sizing.preset}
            >
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
              <div
                {...sizing.resizeProps}
                className={css.resizeHandle}
                aria-label={t("review.height.resize")}
                aria-controls={previewId}
                title={t("review.height.resizeHint")}
              />
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
