import { describe, expect, it, vi } from "vitest";
import { assertWorktreeAccessible } from "../src/tools/tool-scope.js";

function context(service: Record<string, unknown>): any {
  return { get: (name: string) => service[name] };
}

const scope = { userId: "user-1", spaceId: "space-1", cwd: "/tmp/session" };

describe("Worktree tool scope", () => {
  it("accepts a local Unit without probing its reserved Resource id", async () => {
    const openDocument = vi.fn();
    const resolveUnitResource = vi.fn();
    const service = {
      async getWorktreeFileState() {
        return {
          resourceId: "reserved-resource",
          worktrees: [{
            worktreeId: "wt-1",
            name: "Draft",
            status: "draft",
            units: [{
              unitId: "unit-1",
              resourceId: "reserved-resource",
              name: "Draft",
              unitType: "sheet",
              source: "worktree",
              target: { spaceId: "space-1", parentNodeId: null },
              kind: "added",
              draftHeadRevision: 1,
            }],
            worktreeTarget: null,
            mergeTarget: null,
          }],
        };
      },
      openDocument,
      resolveUnitResource,
    };
    await expect(assertWorktreeAccessible(context({ univerWorkspace: service }), scope, "wt-1")).resolves.toBeUndefined();
    expect(openDocument).not.toHaveBeenCalled();
    expect(resolveUnitResource).not.toHaveBeenCalled();
  });

  it("allows a Worktree anchored in another accessible Space", async () => {
    const service = {
      async getWorktreeFileState() {
        return {
          resourceId: "reserved-resource",
          worktrees: [{
            worktreeId: "wt-1",
            name: "Draft",
            status: "draft",
            units: [{
              unitId: "unit-1",
              resourceId: "reserved-resource",
              name: "Draft",
              unitType: "sheet",
              source: "worktree",
              target: { spaceId: "foreign-space", parentNodeId: null },
              kind: "added",
              draftHeadRevision: 1,
            }],
            worktreeTarget: null,
            mergeTarget: null,
          }],
        };
      },
    };
    await expect(assertWorktreeAccessible(context({ univerWorkspace: service }), scope, "wt-1")).resolves.toBeUndefined();
  });
});
