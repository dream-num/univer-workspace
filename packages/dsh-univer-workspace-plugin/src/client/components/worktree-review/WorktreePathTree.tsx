/**
 * Smart path tree for the middle Worktree review surface. It projects only the
 * Units this Worktree touches — real Space roots with server-clipped ancestor
 * paths — and never browses a full Space, never offers file management, and
 * never invents a hierarchy for Units whose location is unavailable; those sit
 * in an honest flat trailing group. Clicking a leaf scrolls to and focuses the
 * matching Unit accordion.
 * @module dsh-univer-workspace-plugin/client/components/worktree-review/WorktreePathTree
 */

import { useState, type ReactElement } from "react";
import { ChevronDownIcon, ChevronRightIcon, FolderIcon } from "@univerjs/univer-workspace-ui";
import type { UniverLocaleKey } from "../../locales.ts";
import { unitChangeLabel } from "../turn-context-card-model.ts";
import type { PathTreeNode, PathTreeSpaceGroup } from "./worktree-review-model.ts";
import { UnitTypeIcon } from "./unit-markers.tsx";
import css from "./WorktreePathTree.module.scss";

export interface PathTreeUnavailableUnit {
  readonly unitId: string;
  readonly name: string;
  readonly unitType: string;
  readonly deleted: boolean;
}

export interface PathTreeLoadingUnit {
  readonly unitId: string;
  readonly name: string;
  readonly unitType: string;
  readonly deleted: boolean;
}

export interface WorktreePathTreeProps {
  readonly spaces: readonly PathTreeSpaceGroup[];
  readonly loadingUnits: readonly PathTreeLoadingUnit[];
  readonly unavailableUnits: readonly PathTreeUnavailableUnit[];
  readonly unitTypeOf: (unitId: string) => string;
  readonly unitKindOf: (unitId: string) => "added" | "modified" | "deleted" | "unchanged";
  readonly locatedUnitId: string | null;
  readonly onLocate: (unitId: string) => void;
  readonly t: (key: UniverLocaleKey) => string;
}

export function WorktreePathTree(props: WorktreePathTreeProps): ReactElement {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const showSpaceLabels = props.spaces.length > 1 || props.spaces.some((space) => space.external);
  const toggle = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
    <nav
      className={css.tree}
      aria-label={`${props.t("worktree.changes")} ${props.t("worktree.path")}`}
    >
      {props.spaces.map((space) => (
        <section key={space.spaceId} className={css.space}>
          {showSpaceLabels ? (
            <button
              type="button"
              className={css.spaceName}
              title={space.external ? props.t("worktree.externalFiles") : space.spaceName}
              aria-expanded={!collapsed.has(space.spaceId)}
              onClick={() => toggle(space.spaceId)}
            >
              {collapsed.has(space.spaceId) ? <ChevronRightIcon /> : <ChevronDownIcon />}
              <span>{space.external ? props.t("worktree.externalFiles") : space.spaceName}</span>
            </button>
          ) : null}
          {showSpaceLabels && collapsed.has(space.spaceId) ? null : (
            <ul className={css.nodeList}>
              {space.roots.map((node) => (
                <PathTreeNodeRow
                  key={node.key}
                  node={node}
                  unitTypeOf={props.unitTypeOf}
                  unitKindOf={props.unitKindOf}
                  locatedUnitId={props.locatedUnitId}
                  onLocate={props.onLocate}
                  t={props.t}
                  collapsed={collapsed}
                  onToggle={toggle}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
      {props.loadingUnits.length > 0 ? (
        <section className={css.space} aria-live="polite">
          <div className={css.spaceName}>{props.t("worktree.pathLoading")}</div>
          <ul className={css.nodeList}>
            {props.loadingUnits.map((unit) => (
              <li key={unit.unitId}>
                <button
                  type="button"
                  className={css.leaf}
                  data-deleted={unit.deleted || undefined}
                  onClick={() => props.onLocate(unit.unitId)}
                >
                  <UnitTypeIcon type={unit.unitType} className={css.leafIcon} />
                  <span className={css.leafName}>{unit.name}</span>
                  <span className={css.sharedMark}>{props.t("worktree.loading")}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {props.unavailableUnits.length > 0 ? (
        <section className={css.space}>
          <div className={css.spaceName}>{props.t("worktree.locationUnavailable")}</div>
          <ul className={css.nodeList}>
            {props.unavailableUnits.map((unit) => (
              <li key={unit.unitId}>
                <button
                  type="button"
                  className={css.leaf}
                  data-deleted={unit.deleted || undefined}
                  data-located={props.locatedUnitId === unit.unitId || undefined}
                  onClick={() => props.onLocate(unit.unitId)}
                >
                  <UnitTypeIcon type={unit.unitType} className={css.leafIcon} />
                  <span className={css.leafName}>{unit.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </nav>
  );
}

function PathTreeNodeRow(props: {
  readonly node: PathTreeNode;
  readonly unitTypeOf: (unitId: string) => string;
  readonly unitKindOf: (unitId: string) => "added" | "modified" | "deleted" | "unchanged";
  readonly locatedUnitId: string | null;
  readonly onLocate: (unitId: string) => void;
  readonly t: (key: UniverLocaleKey) => string;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
}): ReactElement {
  const { node } = props;
  if (node.unitId !== null) {
    const unitId = node.unitId;
    return (
      <li>
        <button
          type="button"
          className={css.leaf}
          data-deleted={node.deleted || undefined}
          data-located={props.locatedUnitId === unitId || undefined}
          onClick={() => props.onLocate(unitId)}
        >
          <UnitTypeIcon type={props.unitTypeOf(unitId)} className={css.leafIcon} />
          <span className={css.leafName}>{node.label}</span>
          <span className={css.sharedMark}>{unitChangeLabel(props.unitKindOf(unitId), props.t)}</span>
          {node.shared ? (
            <span className={css.sharedMark}>{props.t("worktree.sharedFile")}</span>
          ) : null}
        </button>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        className={css.directory}
        aria-expanded={!props.collapsed.has(node.key)}
        onClick={() => props.onToggle(node.key)}
      >
        {props.collapsed.has(node.key) ? <ChevronRightIcon /> : <ChevronDownIcon />}
        <FolderIcon className={css.directoryIcon} />
        <span className={css.directoryName}>{node.label}</span>
      </button>
      {props.collapsed.has(node.key) ? null : (
        <ul className={css.nodeList}>
          {node.children.map((child) => (
            <PathTreeNodeRow
              key={child.key}
              node={child}
              unitTypeOf={props.unitTypeOf}
              unitKindOf={props.unitKindOf}
              locatedUnitId={props.locatedUnitId}
              onLocate={props.onLocate}
              t={props.t}
              collapsed={props.collapsed}
              onToggle={props.onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
