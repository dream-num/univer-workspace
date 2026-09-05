import { describe, expect, it } from "vitest";
import {
  narrowWorktreeDetail,
  narrowWorktreeSummary,
  narrowWorktreeUnit,
} from "../src/provider/workspace-api.js";
import { getWorktreeFileState, workspaceWorktreeUrl } from "../src/provider/file-state-api.ts";
import type { WorkspaceHttpClient } from "../src/provider/workspace-contract.ts";
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

const summary = {
  id: "wt-1",
  name: "Draft",
  summary: "Review",
  kind: "user",
  teamSpace: null,
  visibility: "private",
  state: "draft",
  creator: { id: "u-1", username: "alice", displayName: "Alice", avatarUrl: null },
  unitCount: 1,
  processedAt: null,
  createdAt: "2026-08-28T00:00:00Z",
  updatedAt: "2026-08-28T00:00:01Z",
  capabilities: {
    review: true,
    editDraft: true,
    addUnit: true,
    changeVisibility: false,
    markReady: true,
    reopen: false,
    merge: false,
    discard: true,
  },
};

describe("Workspace Worktree contract", () => {
  it("retains the complete summary and capability fields", () => {
    expect(
      narrowWorktreeSummary({
        ...summary,
        kind: "team",
        teamSpace: { id: "team-1", type: "team", name: "Team" },
        visibility: "space",
        state: "ready",
        capabilities: {
          review: true,
          editDraft: false,
          addUnit: false,
          changeVisibility: true,
          markReady: false,
          reopen: false,
          merge: true,
          discard: true,
        },
      }),
    ).toEqual({
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
      capabilities: {
        review: true,
        editDraft: false,
        addUnit: false,
        changeVisibility: true,
        markReady: false,
        reopen: false,
        merge: true,
        discard: true,
      },
    });
  });

  it.each([
    ["state", { ...summary, state: "unknown" }],
    ["kind", { ...summary, kind: "organization" }],
    ["visibility", { ...summary, visibility: "public" }],
    ["summary", { ...summary, summary: undefined }],
    ["creator", { ...summary, creator: null }],
    ["unitCount", { ...summary, unitCount: -1 }],
    ["createdAt", { ...summary, createdAt: null }],
    ["updatedAt", { ...summary, updatedAt: undefined }],
    ["capabilities", { ...summary, capabilities: { ...summary.capabilities, merge: "yes" } }],
    ["user teamSpace", { ...summary, teamSpace: { id: "team-1", type: "team", name: "Team" } }],
    ["user visibility", { ...summary, visibility: "space" }],
    ["team teamSpace", { ...summary, kind: "team", teamSpace: null }],
  ])("rejects a malformed Worktree summary %s field", (_field, value) => {
    expect(() => narrowWorktreeSummary(value)).toThrow(/malformed summary/);
  });

  it("rejects a Unit whose source and target disagree", () => {
    expect(() => narrowWorktreeUnit({ ...unit, source: "trunk" })).toThrow(/source and target/);
    expect(() => narrowWorktreeUnit({ ...unit, target: null })).toThrow(/source and target/);
  });

  it("builds the Workspace agent deep link for a Worktree Unit", () => {
    expect(
      workspaceWorktreeUrl(
        {
          origin: "http://127.0.0.1:4020",
          sessionToken: "token",
          request: async () => new Response(),
        },
        "wt-1",
        "unit-1",
      ),
    ).toBe("http://127.0.0.1:4020/worktrees?worktree=wt-1&unit=unit-1&view=agent");
  });

  it("uses the linked Space only as the default and preserves an explicit target Space", () => {
    const scope = { userId: "user-1", spaceId: "linked-space", cwd: "/session" };
    expect(resolveTargetSpace(scope)).toBe("linked-space");
    expect(resolveTargetSpace(scope, " shared-space ")).toBe("shared-space");
  });

  it("preserves complete local Unit metadata in Worktree detail", () => {
    const detail = narrowWorktreeDetail({
      worktree: {
        ...summary,
        summary: null,
        units: [unit],
      },
    });
    expect(detail.units).toEqual([
      expect.objectContaining({
        unitId: "unit-1",
        source: "worktree",
        target: { spaceId: "space-1", parentNodeId: null },
        kind: "added",
        draftHeadRevision: 3,
      }),
    ]);
    expect(detail.capabilities.editDraft).toBe(true);
  });

  it("preserves complete Worktree metadata in the browser file-state projection", async () => {
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "token",
      async request(path) {
        if (path === "/api/worktrees/wt-1") {
          return new Response(
            JSON.stringify({
              worktree: {
                ...summary,
                summary: "Prepare both resources",
                units: [unit],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        expect(path).toBe("/api/worktrees/wt-1/units/unit-1/open");
        return new Response(
          JSON.stringify({
            unit: { unitId: "unit-1", unitType: "sheet", editorMode: "edit" },
            collaborationScope: { kind: "worktree", worktreeId: "wt-1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    };

    const state = await getWorktreeFileState(client, "wt-1");

    expect(state.worktrees[0]).toMatchObject({
      worktreeId: "wt-1",
      summary: "Prepare both resources",
      kind: "user",
      teamSpace: null,
      creator: summary.creator,
      unitCount: 1,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      capabilities: summary.capabilities,
      units: [
        expect.objectContaining({
          unitId: "unit-1",
          kind: "added",
          mergeResult: "pending",
          activationState: "waitingForMerge",
        }),
      ],
    });
  });

  it("rejects a Worktree detail without its required Unit list", () => {
    expect(() => narrowWorktreeDetail({ worktree: summary })).toThrow(/malformed Unit list/);
  });
});
