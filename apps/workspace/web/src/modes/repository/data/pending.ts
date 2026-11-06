import { worktreeBelongsToSpace } from "../../../features/worktrees/worktree.rules";
import { actorOf } from "./actor";
import { pullRef } from "./activity";
import type { Page, PendingChange, PendingChangeIndex, Space, Worktree, WorktreeDetail } from "./types";

export const MAX_PENDING_DETAILS = 20;
export const MAX_PENDING_ANCESTRY = 40;
export interface NodeAncestry {
  readonly spaceId: string;
  readonly ancestors: readonly string[];
  readonly complete: boolean;
}

export function pendingDetailPlan(space: Space, page: Page<Worktree>) {
  const open = page.items.filter((item) => worktreeBelongsToSpace(item, space) &&
    (item.state === "draft" || item.state === "ready" || item.state === "merging"));
  const reviewable = open.filter((item) => item.capabilities.review)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  return {
    items: reviewable.slice(0, MAX_PENDING_DETAILS),
    complete: !page.nextCursor && open.length === reviewable.length && reviewable.length <= MAX_PENDING_DETAILS,
  };
}

export function pendingAncestryPlan(spaceId: string, details: readonly WorktreeDetail[]) {
  const ids = new Set<string>();
  for (const detail of details) {
    for (const unit of detail.units) {
      if (unit.change === "unchanged" || (unit.target && unit.target.spaceId !== spaceId)) continue;
      if (unit.source === "worktree") continue;
      const id = unit.nodeId ?? unit.target?.parentNodeId;
      if (id) ids.add(id);
    }
  }
  return { ids: [...ids].slice(0, MAX_PENDING_ANCESTRY), complete: ids.size <= MAX_PENDING_ANCESTRY };
}

export function buildPendingIndex(
  spaceId: string,
  details: readonly WorktreeDetail[],
  ancestry: ReadonlyMap<string, NodeAncestry>,
  complete: boolean,
): PendingChangeIndex {
  const byNode = new Map<string, PendingChange[]>();
  const additionsByParent = new Map<string, PendingChange[]>();
  const append = (map: Map<string, PendingChange[]>, id: string, change: PendingChange) => {
    const existing = map.get(id);
    if (existing) existing.push(change);
    else map.set(id, [change]);
  };
  complete &&= details.length <= MAX_PENDING_DETAILS;
  const sorted = [...details].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  for (const detail of sorted.slice(0, MAX_PENDING_DETAILS)) {
    if (detail.state !== "draft" && detail.state !== "ready" && detail.state !== "merging") continue;
    for (const unit of detail.units) {
      if (unit.change === "unchanged" || (unit.target && unit.target.spaceId !== spaceId)) continue;
      const ancestryId = unit.source === "worktree" ? unit.target?.parentNodeId : unit.nodeId ?? unit.target?.parentNodeId;
      const context = ancestryId ? ancestry.get(ancestryId) : undefined;
      if (context && context.spaceId !== spaceId) continue;
      if (unit.change !== "added" && ancestryId && !context?.complete) complete = false;
      const change: PendingChange = {
        pull: { ...pullRef(detail, spaceId), state: detail.state },
        kind: unit.change,
        unitName: unit.name,
        unitType: unit.unitType,
        scope: "self",
        actor: actorOf(detail.creator, detail.createdVia),
      };
      if (unit.nodeId) append(byNode, unit.nodeId, change);
      if (unit.change === "added") {
        append(additionsByParent, unit.target?.parentNodeId ?? "root", change);
      } else if (!unit.nodeId) {
        complete = false;
        continue;
      }
      const ancestors = unit.nodeId && unit.source !== "worktree"
        ? context?.ancestors ?? (unit.target?.parentNodeId ? [unit.target.parentNodeId] : [])
        : [...(context?.ancestors ?? []), ...(unit.target?.parentNodeId ? [unit.target.parentNodeId] : [])];
      for (const ancestor of new Set(ancestors)) {
        if (ancestor !== unit.nodeId) append(byNode, ancestor, { ...change, scope: "inside" });
      }
    }
  }
  return { byNode, additionsByParent, complete };
}
