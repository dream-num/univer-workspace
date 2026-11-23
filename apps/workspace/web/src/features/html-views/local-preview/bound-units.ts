import { useHtmlViewSources } from "../use-html-view-sources";
import type { HtmlViewSourceWorktree } from "../workspace-binding-engine";

export interface BoundUnit {
  readonly unitId: string;
  readonly name?: string | undefined;
  /** Unknown for a pull request's Worktree, which reports no access of its own. */
  readonly canEdit?: boolean | undefined;
  /** Denied: the Workspace has no Resource for the Unit that this user can see. */
  readonly status: "loading" | "ready" | "denied";
}

/** The page's Units in binding order. */
export type BoundUnits = ReadonlyMap<string, BoundUnit>;

/** What the user can know about each Unit the page binds, from the page text and Resource lookups only. */
export function useBoundUnits(html: string | undefined, worktree: HtmlViewSourceWorktree | undefined): BoundUnits {
  const { sourceIds, sources } = useHtmlViewSources(html, worktree);
  return new Map((sourceIds ?? []).map((unitId, index): [string, BoundUnit] => {
    const mapped = worktree?.state === "merged" ? undefined : worktree?.units.find((unit) => unit.unitId === unitId);
    const query = sources[index];
    if (mapped) return [unitId, { unitId, name: mapped.name, status: "ready" }];
    if (query?.data) return [unitId, { unitId, name: query.data.node.name, canEdit: query.data.resource.capabilities.editContent, status: "ready" }];
    return [unitId, { unitId, status: query?.isError ? "denied" : "loading" }];
  }));
}

export function unitLabel(unit: BoundUnit | undefined, m: { unitUnknown: string; unitDenied: string }): string {
  return unit?.name ?? (unit?.status === "loading" ? "…" : unit?.status === "denied" ? m.unitDenied : m.unitUnknown);
}
