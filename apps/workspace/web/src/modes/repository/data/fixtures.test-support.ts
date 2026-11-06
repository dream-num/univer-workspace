import type { Issue, RecentResource, Worktree, WorktreeDetail } from "./types";

export const user = { id: "me", username: "me", displayName: "Me", avatarUrl: null };
export const space = { id: "alpha", name: "Alpha", type: "team", publicRead: false } as const;
export const now = new Date(2026, 10, 6, 12);
export const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString();

export function pull(overrides: Partial<Worktree> = {}): Worktree {
  return {
    createdVia: "unknown", id: "pull", number: 1, name: "Update plan", summary: null, kind: "team", teamSpace: space,
    visibility: "space", state: "ready", creator: user, unitCount: 7,
    createdAt: at(5), updatedAt: at(6), processedAt: null,
    capabilities: { review: true, editDraft: false, addUnit: false, changeVisibility: false, markReady: false, reopen: false, merge: false, discard: false },
    ...overrides,
  };
}

export function detail(overrides: Partial<WorktreeDetail> = {}): WorktreeDetail {
  return { ...pull(), units: [unit()], ...overrides };
}

export function unit(overrides: Partial<WorktreeDetail["units"][number]> = {}): WorktreeDetail["units"][number] {
  return {
    unitId: "unit", resourceId: "resource", nodeId: "file", source: "trunk", name: "Plan", unitType: "sheet",
    target: null, draftHeadRevision: 2, change: "modified", mergeResult: "pending", activationState: "notApplicable",
    ...overrides,
  };
}

export function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    createdVia: "unknown", id: "issue", number: 2, space, title: "Review plan", state: "open", stateReason: null,
    author: user, closedBy: null, closedAt: null, labels: [], assignees: [], commentCount: 0,
    referenceCount: 0, createdAt: at(5), updatedAt: at(6), ...overrides,
  };
}

export function recent(name = "Plan", kind: "univer" | "blob" = "univer"): RecentResource {
  return {
    lastOpenedAt: at(6),
    node: {
      id: name, name, spaceId: space.id, parentNodeId: null, resource: null, hasChildren: false,
      updatedAt: at(6), accessRole: "owner",
      capabilities: { browseChildren: false, createChildren: false, rename: true, move: true, trash: true, share: true },
    },
    resource: kind === "univer"
      ? { id: name, kind, unitId: name, unitType: "sheet", capabilities: { openContent: true, editContent: true, downloadContent: true } }
      : { id: name, kind, mediaType: "text/html", byteSize: 100, availability: "ready", capabilities: { openContent: true, editContent: true, downloadContent: true } },
    location: { space, breadcrumbs: [] },
  };
}
