import { describe, expect, it } from "vitest";
import { narrowWorktreeDetail, narrowWorktreeSummary, narrowWorktreeUnit } from "../src/provider/workspace-api.js";
import { workspaceWorktreeUrl } from "../src/provider/file-state-api.ts";
import { resolveTargetSpace } from "../src/tools/tool-scope.ts";

const unit = {
  unitId: "unit-1",
  resourceId: "resource-1",
  nodeId: "node-1",
  source: "worktree",
  name: "Draft",
  unitType: "sheet",
  target: { spaceId: "space-1", parentNodeId: null },
  draftHeadRevision: 3,
  change: "added",
  mergeResult: "pending",
  activationState: "waitingForMerge",
};

describe("Workspace Worktree contract", () => {
  it("retains the complete summary and capability fields", () => {
    expect(narrowWorktreeSummary({
      id: "wt-1",
      name: "Draft",
      summary: "Review",
      kind: "team",
      teamSpace: { id: "team-1", type: "team", name: "Team" },
      visibility: "space",
      state: "ready",
      creator: { id: "u-1", username: "alice", displayName: "Alice", avatarUrl: null },
      unitCount: 1,
      processedAt: null,
      createdAt: "2026-08-28T00:00:00Z",
      updatedAt: "2026-08-28T00:00:01Z",
      capabilities: { review: true, editDraft: false, addUnit: false, changeVisibility: true, markReady: false, reopen: false, merge: true, discard: true },
    })).toEqual({
      id: "wt-1",
      name: "Draft",
      summary: "Review",
      kind: "team",
      teamSpace: { id: "team-1", type: "team", name: "Team" },
      visibility: "space",
      state: "ready",
      creator: { id: "u-1", username: "alice", displayName: "Alice", avatarUrl: null },
      unitCount: 1,
      processedAt: null,
      createdAt: "2026-08-28T00:00:00Z",
      updatedAt: "2026-08-28T00:00:01Z",
      capabilities: { review: true, editDraft: false, addUnit: false, changeVisibility: true, markReady: false, reopen: false, merge: true, discard: true },
    });
  });

  it("rejects a Unit whose source and target disagree", () => {
    expect(() => narrowWorktreeUnit({ ...unit, source: "trunk" })).toThrow(/source and target/);
    expect(() => narrowWorktreeUnit({ ...unit, target: null })).toThrow(/source and target/);
  });

  it("builds the Workspace agent deep link for a Worktree Unit", () => {
    expect(workspaceWorktreeUrl(
      { origin: "http://127.0.0.1:4020", sessionToken: "token", request: async () => new Response() },
      "wt-1",
      "unit-1",
    )).toBe("http://127.0.0.1:4020/worktrees?worktree=wt-1&unit=unit-1&view=agent");
  });

  it("uses the linked Space only as the default and preserves an explicit target Space", () => {
    const scope = { userId: "user-1", spaceId: "linked-space", cwd: "/session" };
    expect(resolveTargetSpace(scope)).toBe("linked-space");
    expect(resolveTargetSpace(scope, " shared-space ")).toBe("shared-space");
  });

  it("preserves complete local Unit metadata in Worktree detail", () => {
    const detail = narrowWorktreeDetail({
      worktree: {
        id: "wt-1",
        name: "Draft",
        summary: null,
        kind: "user",
        teamSpace: null,
        visibility: "private",
        state: "draft",
        creator: null,
        unitCount: 1,
        processedAt: null,
        createdAt: null,
        updatedAt: null,
        capabilities: { review: true, editDraft: true, addUnit: true, changeVisibility: false, markReady: true, reopen: false, merge: false, discard: true },
        units: [unit],
      },
    });
    expect(detail.units).toEqual([expect.objectContaining({
      unitId: "unit-1",
      source: "worktree",
      target: { spaceId: "space-1", parentNodeId: null },
      kind: "added",
      draftHeadRevision: 3,
    })]);
    expect(detail.capabilities.editDraft).toBe(true);
  });
});
