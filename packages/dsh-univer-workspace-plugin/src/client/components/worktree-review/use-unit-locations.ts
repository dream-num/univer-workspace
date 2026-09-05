/**
 * Resolve every Worktree Unit's caller-visible location through the strict
 * Node detail proxy (`getWorkspaceNodeLocation`). Trunk-backed Units resolve
 * their own Node; Worktree-local Units resolve their target parent so the
 * proposed location is real instead of invented. Any failure degrades to the
 * safe "unavailable" state — never a guessed Space or fabricated path.
 * @module dsh-univer-workspace-plugin/client/components/worktree-review/use-unit-locations
 */

import { useEffect, useState } from "react";
import type { WorktreeUnitView } from "../../../shared/state.ts";
import { getWorkspaceNodeLocation } from "../../api/univer-api.ts";
import { fetchWorkspaceSpaces } from "../../space-api.ts";
import { locationNodeIdOf, type UnitLocationState } from "./worktree-review-model.ts";

export type UnitLocationMap = Readonly<Record<string, UnitLocationState>>;

export function useUnitLocations(
  units: readonly WorktreeUnitView[],
  refreshEpoch: number,
): UnitLocationMap {
  const [locations, setLocations] = useState<UnitLocationMap>({});
  const signature = units
    .map((unit) => `${unit.unitId}:${locationNodeIdOf(unit) ?? ""}:${unit.target?.spaceId ?? ""}`)
    .join("|");

  useEffect(() => {
    const abort = new AbortController();
    // Keep resolved breadcrumbs visible while a periodic refresh is in flight.
    // Replacing every entry with `loading` made the review page flash a
    // transient "Resolving file locations" state every five seconds on a
    // remote Workspace. Only new or previously unavailable Units need to
    // advertise loading; an already resolved path remains stable until the
    // replacement response arrives.
    setLocations((current) => {
      const next: Record<string, UnitLocationState> = {};
      for (const unit of units) {
        const previous = current[unit.unitId];
        next[unit.unitId] = previous?.status === "resolved" ? previous : { status: "loading" };
      }
      return next;
    });

    const nodeIds = new Map<string, string>();
    const skipped: Record<string, UnitLocationState> = {};
    for (const unit of units) {
      const nodeId = locationNodeIdOf(unit);
      if (nodeId === null) {
        // A Worktree-local Unit created at a Space root has no persistent Node
        // yet, but its target Space is still authoritative. Keep it loading
        // until the Space list resolves so the UI does not briefly claim the
        // location is unavailable before the root fallback can run.
        const hasRootTarget =
          unit.source === "worktree" &&
          unit.target !== null &&
          unit.target !== undefined &&
          unit.target.parentNodeId === null &&
          unit.target.spaceId !== "";
        skipped[unit.unitId] = { status: hasRootTarget ? "loading" : "unavailable" };
      } else {
        nodeIds.set(unit.unitId, nodeId);
      }
    }
    if (Object.keys(skipped).length > 0) {
      setLocations((current) => ({ ...current, ...skipped }));
    }

    const uniqueNodeIds = [...new Set(nodeIds.values())];
    const rootUnits = units.filter(
      (unit) => unit.source === "worktree" && unit.target?.parentNodeId === null,
    );
    const rootSpaceIds = new Set(rootUnits.map((unit) => unit.target?.spaceId).filter(Boolean));
    const rootSpacesPromise =
      rootSpaceIds.size === 0
        ? Promise.resolve<Awaited<ReturnType<typeof fetchWorkspaceSpaces>> | null>([])
        : fetchWorkspaceSpaces()
            .then((spaces) => spaces.filter((space) => rootSpaceIds.has(space.spaceId)))
            .catch(() => null);
    void Promise.all([
      Promise.all(
        uniqueNodeIds.map(async (nodeId) => {
          try {
            const location = await getWorkspaceNodeLocation(nodeId, abort.signal);
            return { nodeId, location } as const;
          } catch (reason: unknown) {
            if (abort.signal.aborted) return null;
            return { nodeId, location: null } as const;
          }
        }),
      ),
      rootSpacesPromise,
    ]).then(([results, rootSpaces]) => {
      if (abort.signal.aborted) return;
      const byNodeId = new Map(
        results
          .filter((result) => result !== null)
          .map((result) => [result.nodeId, result.location] as const),
      );
      const rootSpacesById = new Map(
        (rootSpaces ?? []).map((space) => [space.spaceId, space] as const),
      );
      setLocations((current) => {
        const next: Record<string, UnitLocationState> = { ...current };
        for (const unit of rootUnits) {
          const target = unit.target;
          if (target === null || target === undefined) continue;
          const space = rootSpacesById.get(target.spaceId);
          next[unit.unitId] =
            space === undefined
              ? { status: "unavailable" }
              : {
                  status: "resolved",
                  spaceId: space.spaceId,
                  spaceName: space.name,
                  path: [],
                  shared: false,
                };
        }
        for (const [unitId, nodeId] of nodeIds) {
          const location = byNodeId.get(nodeId);
          if (location === undefined) continue;
          if (location === null) {
            next[unitId] = { status: "unavailable" };
            continue;
          }
          // The server clips breadcrumbs to the caller's grant root; when the
          // resolved Node itself appears as the last crumb, drop it so the
          // Unit name stays the single leaf.
          const crumbs = location.breadcrumbs.map((crumb) => crumb.name);
          const lastCrumb = location.breadcrumbs[location.breadcrumbs.length - 1];
          const ancestorPath =
            lastCrumb !== undefined && lastCrumb.id === location.nodeId
              ? crumbs.slice(0, -1)
              : crumbs;
          // A Worktree-local Unit's resolved Node is its target parent, which
          // is itself part of the proposed path.
          const unit = units.find((candidate) => candidate.unitId === unitId);
          const path =
            unit !== undefined && unit.source === "worktree"
              ? [...ancestorPath, location.name]
              : ancestorPath;
          next[unitId] = {
            status: "resolved",
            spaceId: location.space.id,
            spaceName: location.space.name,
            path,
            shared: location.shared,
          };
        }
        return next;
      });
    });
    return () => abort.abort();
  }, [signature, refreshEpoch]);

  return locations;
}
