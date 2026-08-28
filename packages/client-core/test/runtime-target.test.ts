import { describe, expect, it } from "vitest";
import {
  parseWorkspaceRuntimeTarget,
  serializeWorkspaceRuntimeTarget,
  workspaceRuntimeKey,
  workspaceSnapshotPrefix,
  type WorkspaceRuntimeTarget,
} from "../src/index.js";

describe("Workspace runtime target", () => {
  const base = {
    origin: "https://workspace.test",
    revision: 4,
    unitId: "unit-1",
    unitType: "doc" as const,
  };

  it.each(["sheet", "doc", "slide", "base", "board"] as const)(
    "normalizes and round trips a %s target as plain JSON",
    (unitType) => {
      const parsed = parseWorkspaceRuntimeTarget({
        ...base,
        origin: "https://workspace.test:443/",
        scope: { kind: "worktree", worktreeId: "wt-1" },
        unitType,
      });
      expect(parsed.origin).toBe("https://workspace.test");
      const serialized = serializeWorkspaceRuntimeTarget(parsed);
      expect(serialized).toEqual({
        ...base,
        scope: { kind: "worktree", worktreeId: "wt-1" },
        unitType,
      });
      expect(Object.getPrototypeOf(serialized)).toBe(Object.prototype);
      expect(parseWorkspaceRuntimeTarget(serialized)).toEqual(parsed);
    },
  );

  it("accepts and normalizes an HTTP origin", () => {
    expect(
      parseWorkspaceRuntimeTarget({
        ...base,
        origin: "http://workspace.test:80/",
        scope: { kind: "trunk" },
      }).origin,
    ).toBe("http://workspace.test");
  });

  it.each([
    "relative",
    "ftp://workspace.test",
    "https://user@workspace.test",
    "https://:password@workspace.test",
    "https://workspace.test/path",
    "https://workspace.test?query=1",
    "https://workspace.test#fragment",
  ])("rejects invalid origin %s before target fields", (origin) => {
    expect(() =>
      parseWorkspaceRuntimeTarget({
        ...base,
        origin,
        revision: -1,
        scope: { kind: "trunk", extra: true },
        unitId: "",
      }),
    ).toThrowError(expect.objectContaining({ code: "WORKSPACE_ORIGIN_INVALID" }));
  });

  it.each([
    null,
    [],
    "target",
    { ...base, revision: -1, scope: { kind: "trunk" } },
    { ...base, revision: 1.5, scope: { kind: "trunk" } },
    { ...base, revision: Number.NaN, scope: { kind: "trunk" } },
    { ...base, revision: Number.POSITIVE_INFINITY, scope: { kind: "trunk" } },
    { ...base, revision: Number.MAX_SAFE_INTEGER + 1, scope: { kind: "trunk" } },
    { ...base, unitId: "", scope: { kind: "trunk" } },
    { ...base, unitType: "drawing", scope: { kind: "trunk" } },
    { ...base, scope: null },
    { ...base, scope: { kind: "unknown" } },
    { ...base, scope: { kind: "trunk", worktreeId: "wt-1" } },
    { ...base, scope: { kind: "worktree" } },
    { ...base, scope: { kind: "worktree", worktreeId: "" } },
    { ...base, scope: { kind: "worktree", worktreeId: "wt-1", extra: true } },
  ])("rejects ambiguous or invalid target %#", (value) => {
    expect(() => parseWorkspaceRuntimeTarget(value)).toThrowError(
      expect.objectContaining({ code: "WORKSPACE_TARGET_INVALID" }),
    );
  });

  it("keeps revisions together and all runtime identity components disjoint", () => {
    const trunk: WorkspaceRuntimeTarget = { ...base, scope: { kind: "trunk" } };
    const worktree: WorkspaceRuntimeTarget = {
      ...base,
      scope: { kind: "worktree", worktreeId: "wt:/百分比%" },
    };
    expect(workspaceRuntimeKey({ ...worktree, revision: 99 })).toBe(workspaceRuntimeKey(worktree));
    const keys = [
      trunk,
      worktree,
      { ...worktree, origin: "https://other.test" },
      { ...worktree, scope: { kind: "worktree" as const, worktreeId: "wt:/百分比%:" } },
      { ...worktree, unitId: "unit-1:" },
      { ...worktree, unitType: "sheet" as const },
    ].map(workspaceRuntimeKey);
    expect(new Set(keys)).toHaveLength(keys.length);
  });

  it("builds exact encoded trunk and Worktree Snapshot prefixes", () => {
    expect(workspaceSnapshotPrefix({ kind: "trunk" })).toBe("/universer-api/snapshot");
    expect(workspaceSnapshotPrefix({ kind: "worktree", worktreeId: "wt/百分比%" })).toBe(
      "/universer-api/worktrees/wt%2F%E7%99%BE%E5%88%86%E6%AF%94%25/snapshot",
    );
  });
});
