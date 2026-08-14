import { describe, expect, it } from "vitest";
import {
  parseWorkspaceRuntimeTarget,
  workspaceRuntimeKey,
  type WorkspaceRuntimeTarget,
} from "../src/runtime/target.js";

describe("Workspace runtime target", () => {
  const base = {
    origin: "https://workspace.test",
    revision: 4,
    unitId: "unit-1",
    unitType: "doc" as const,
  };

  it("uses a stable identity across revisions and keeps trunk and Worktree disjoint", () => {
    const trunk: WorkspaceRuntimeTarget = { ...base, scope: { kind: "trunk" } };
    const worktree: WorkspaceRuntimeTarget = {
      ...base,
      scope: { kind: "worktree", worktreeId: "wt-1" },
    };
    expect(workspaceRuntimeKey(trunk)).toBe(
      "workspace:https%3A%2F%2Fworkspace.test:trunk:unit-1:doc",
    );
    expect(workspaceRuntimeKey(worktree)).toBe(
      "workspace:https%3A%2F%2Fworkspace.test:worktree:wt-1:unit-1:doc",
    );
    expect(workspaceRuntimeKey({ ...worktree, revision: 99 })).toBe(workspaceRuntimeKey(worktree));
  });

  it("parses exact scope shapes and rejects ambiguous targets", () => {
    expect(parseWorkspaceRuntimeTarget({ ...base, scope: { kind: "trunk" } })).toEqual({
      ...base,
      scope: { kind: "trunk" },
    });
    expect(() =>
      parseWorkspaceRuntimeTarget({
        ...base,
        scope: { kind: "trunk", worktreeId: "wt-1" },
      }),
    ).toThrowError(expect.objectContaining({ code: "WORKSPACE_TARGET_INVALID" }));
    expect(() =>
      parseWorkspaceRuntimeTarget({ ...base, scope: { kind: "worktree", worktreeId: "" } }),
    ).toThrowError(expect.objectContaining({ code: "WORKSPACE_TARGET_INVALID" }));
  });
});
