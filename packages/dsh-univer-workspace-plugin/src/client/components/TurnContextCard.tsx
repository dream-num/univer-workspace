/** Compact Turn summaries; all document previews belong to the native Sidecar. */
import * as React from "react";
import { Badge, BasesMultiIcon, BoardsMultiIcon,  DocsMultiIcon,
  ExternalLinkIcon, FileIcon, PencilIcon, PlusIcon, SheetsMultiIcon,
  SlidesMultiIcon, TrashIcon, type WorkspaceIconComponent } from "@univerjs/univer-workspace-ui";
import type { DocumentFileState } from "../../shared/state.ts";
import type { UniverTurnOperation } from "../conversation/univer-turn-definition.ts";
import type { WorkspaceNavigationStore } from "../navigation/workspace-navigation.ts";
import type { ViewerRuntimeProps } from "./review-panel.tsx";
import { hasUnitMergeProblem, mergeResultLabel,
  mergeResultVariant, selectTurnUnits, statusLabel, statusVariant, unitChangeLabel,
  type TurnCardStatus } from "./turn-context-card-model.ts";
import { useUnitLocations } from "./worktree-review/use-unit-locations.ts";
import { WorktreeBranchIcon } from "./worktree-review/WorktreeBranchIcon.tsx";
import { WorktreeMetadata } from "./worktree-review/WorktreeMetadata.tsx";
import { WorktreeActions } from "./worktree-review/WorktreeActions.tsx";
import css from "./TurnContextCard.module.scss";

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
  readonly navigation: WorkspaceNavigationStore;
}

export function TurnContextCard(props: TurnContextCardProps): React.ReactElement {
  return props.worktreeId === null ? <ResourceTurnCard {...props} />
    : <WorktreeTurnCard {...props} worktreeId={props.worktreeId} />;
}

function WorktreeTurnCard(props: TurnContextCardProps & { worktreeId: string }): React.ReactElement {
  const worktree = props.state?.worktrees.find(item => item.worktreeId === props.worktreeId);
  const status: TurnCardStatus = worktree?.status ?? (props.stateError ? "unavailable" : "loading");
  const units = worktree ? selectTurnUnits(worktree.units, props.operations) : [];
  const locations = useUnitLocations(worktree?.units ?? [], 0);
  const title = worktree?.name ?? props.label ?? props.t("card.title");
  const open = (unitId: string | null) => {
    if (!props.state || !worktree?.capabilities.review) return;
    props.navigation.dispatch({ type: "open-content", contentSurface: {
      kind: "worktree", workspaceOrigin: props.state.workspaceOrigin,
      worktreeId: worktree.worktreeId, name: worktree.name, unitId,
    } });
  };
  return <article className={css.card} data-turn-context-card data-worktree-id={props.worktreeId}
    data-status={status} aria-label={title}>
    <header className={css.header}>
      <div className={css.titleBlock}>
        <div className={css.titleRow}>
          <WorktreeBranchIcon status={status} />
          <Badge variant={statusVariant(status)}>{statusLabel(status, props.t)}</Badge>
          <button className={css.titleLink} disabled={!worktree?.capabilities.review} onClick={() => open(null)}>{title}</button>
        </div>

      </div>
      {worktree ? <WorktreeActions worktree={worktree} t={props.t} /> : null}
      <div className={css.metadata}>
        {worktree ? <WorktreeMetadata worktree={worktree}
          spaceNames={[...new Set([
            ...(worktree.teamSpace ? [worktree.teamSpace.name] : []),
            ...Object.values(locations).flatMap(location => location.status === "resolved" && !location.shared ? [location.spaceName] : []),
          ])]} emptyDescription={props.t("worktree.noDescription")} /> : null}
      </div>
    </header>
    {props.stateError ? <div className={css.notice} role="alert">{props.stateError}</div> : !worktree ?
      <div className={css.notice} role="status">{props.t("dock.loading")}</div> :
      !worktree.capabilities.review ? <div className={css.notice}>{props.t("turn.noReview")}</div> :
      units.length === 0 ? <div className={css.notice}>{props.t("turn.noUnits")}</div> :
      <ul className={css.accordionList}>
        {units.map(unit => {
          const location = locations[unit.unitId];
          const directory = location?.status === "resolved" && !location.shared ? location.path.join(" / ") : "";
          const ChangeIcon = UNIT_CHANGE_ICONS[unit.kind];
          return <li key={unit.unitId} className={css.accordionItem} data-unit-id={unit.unitId}>
            <button className={css.accordionHeader} data-deleted={unit.kind === "deleted" || undefined}
              onClick={() => open(unit.unitId)} title={[directory, unit.name].filter(Boolean).join(" / ")}>
              <UnitTypeIcon type={unit.unitType} />
              <span className={css.unitName}>{unit.name}</span>
              {directory ? <span className={css.directoryPath}>{directory}</span> : null}
              <span className={css.unitChange}>{ChangeIcon ? <ChangeIcon /> : null}{unitChangeLabel(unit.kind, props.t)}</span>
              {hasUnitMergeProblem(unit.mergeResult) ? <Badge variant={mergeResultVariant(unit.mergeResult)}>
                {mergeResultLabel(unit.mergeResult, props.t)}</Badge> : null}
              <ExternalLinkIcon className={css.unitIcon} />
            </button>
          </li>;
        })}
      </ul>}
  </article>;
}

function ResourceTurnCard(props: TurnContextCardProps): React.ReactElement {
  const title = props.label ?? props.t("card.title");
  const resourceId = props.resourceId ?? (props.docKey.startsWith("res:") ? props.docKey.slice(4) : null);
  const open = () => {
    if (!props.state || !resourceId) return;
    props.navigation.dispatch({ type: "open-content", contentSurface: {
      kind: "resource", workspaceOrigin: props.state.workspaceOrigin, resourceId,
      docKey: `res:${resourceId}`, name: title,
      unitType: props.unitType ?? props.state.viewerTarget?.unitType ?? null,
    } });
  };
  return <article className={css.card} data-turn-context-card aria-label={title}>
    <button className={css.accordionHeader} onClick={open} disabled={!props.state || !resourceId}>
      <UnitTypeIcon type={props.unitType ?? ""} /><span className={css.unitName}>{title}</span><ExternalLinkIcon />
    </button>
    {props.stateError ? <div role="alert" className={css.notice}>{props.stateError}</div> : null}
  </article>;
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

const UNIT_CHANGE_ICONS: Readonly<Record<string, WorkspaceIconComponent>> = {
  modified: PencilIcon,
  added: PlusIcon,
  deleted: TrashIcon,
};
