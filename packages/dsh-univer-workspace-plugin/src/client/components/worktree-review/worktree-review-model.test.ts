import { describe, expect, it } from "vitest";
import {
  buildPathTree,
  locationNodeIdOf,
  LruSet,
  unitLocationTitle,
  type PathTreeUnitEntry,
} from "./worktree-review-model.ts";
import type { WorktreeUnitView } from "../../../shared/state.ts";

function unit(overrides: Partial<WorktreeUnitView>): WorktreeUnitView {
  return {
    unitId: "u1",
    resourceId: "r1",
    nodeId: "n1",
    name: "季度报表",
    unitType: "sheet",
    kind: "modified",
    draftHeadRevision: 0,
    source: "trunk",
    target: null,
    mergeResult: "pending",
    activationState: "notApplicable",
    ...overrides,
  };
}

function entry(overrides: Partial<PathTreeUnitEntry>): PathTreeUnitEntry {
  return {
    unitId: "u1",
    name: "季度报表",
    deleted: false,
    shared: false,
    spaceId: "s1",
    spaceName: "设计团队",
    path: [],
    ...overrides,
  };
}

describe("locationNodeIdOf", () => {
  it("uses the Unit's own Node for trunk-backed Units", () => {
    expect(locationNodeIdOf(unit({ nodeId: "n9" }))).toBe("n9");
  });

  it("uses the target parent for Worktree-local Units", () => {
    expect(
      locationNodeIdOf(unit({ source: "worktree", target: { spaceId: "s1", parentNodeId: "p1" } })),
    ).toBe("p1");
  });

  it("returns null for a Worktree-local Unit without a resolvable parent", () => {
    expect(
      locationNodeIdOf(unit({ source: "worktree", target: { spaceId: "s1", parentNodeId: null } })),
    ).toBeNull();
    expect(locationNodeIdOf(unit({ source: "worktree", target: null }))).toBeNull();
  });
});

describe("buildPathTree", () => {
  it("groups Units under their real Space in insertion order", () => {
    const tree = buildPathTree([
      entry({ unitId: "u1", spaceId: "s1", spaceName: "设计团队" }),
      entry({ unitId: "u2", spaceId: "s2", spaceName: "A 的个人空间" }),
      entry({ unitId: "u3", spaceId: "s1", spaceName: "设计团队", name: "需求文档" }),
    ]);
    expect(tree.map((space) => space.spaceName)).toEqual(["设计团队", "A 的个人空间"]);
    expect(tree[0]?.roots.map((node) => node.unitId)).toEqual(["u1", "u3"]);
  });

  it("compresses single-child directory chains into one row", () => {
    const tree = buildPathTree([
      entry({ path: ["2026", "Q3", "报表"] }),
      entry({ unitId: "u2", name: "其他", path: ["2026", "其他"] }),
    ]);
    // The fork at "2026" stays expanded; only the unary chain below compresses.
    const fork = tree[0]?.roots[0];
    expect(fork?.label).toBe("2026");
    expect(fork?.children.map((node) => node.label)).toEqual(["Q3 / 报表", "其他"]);
    expect(fork?.children[0]?.children[0]?.unitId).toBe("u1");
  });

  it("keeps a directory uncompressed when it directly holds a Unit leaf", () => {
    const tree = buildPathTree([
      entry({ unitId: "u1", path: ["docs"] }),
      entry({ unitId: "u2", name: "子文件", path: ["docs", "sub"] }),
    ]);
    const docs = tree[0]?.roots[0];
    expect(docs?.label).toBe("docs");
    expect(docs?.children.map((node) => node.unitId)).toEqual(["u1", null]);
  });

  it("keeps same-name Units disambiguated by Space and path", () => {
    const tree = buildPathTree([
      entry({ unitId: "u1", name: "报表.xlsx", spaceId: "s1", path: ["a"] }),
      entry({ unitId: "u2", name: "报表.xlsx", spaceId: "s2", spaceName: "外部", path: ["a"] }),
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.roots[0]?.children[0]?.unitId).toBe("u1");
    expect(tree[1]?.roots[0]?.children[0]?.unitId).toBe("u2");
  });

  it("marks deleted and shared flags on leaf nodes", () => {
    const tree = buildPathTree([entry({ deleted: true, shared: true })]);
    expect(tree[0]?.roots[0]?.deleted).toBe(true);
    expect(tree[0]?.roots[0]?.shared).toBe(true);
  });
});

describe("unitLocationTitle", () => {
  it("includes the Space, directory path, and Unit name", () => {
    expect(
      unitLocationTitle(
        {
          status: "resolved",
          spaceId: "s1",
          spaceName: "设计团队",
          path: ["2026", "Q3"],
          shared: false,
        },
        "季度报表",
      ),
    ).toBe("设计团队 / 2026 / Q3 / 季度报表");
  });

  it("does not invent a path while the server location is unresolved", () => {
    expect(unitLocationTitle({ status: "loading" }, "季度报表")).toBe("季度报表");
    expect(unitLocationTitle({ status: "unavailable" }, "季度报表")).toBe("季度报表");
  });
});

describe("LruSet", () => {
  it("retains keys until capacity, then evicts the oldest", () => {
    const lru = new LruSet(2);
    expect(lru.touch("a")).toEqual([]);
    expect(lru.touch("b")).toEqual([]);
    expect(lru.touch("c")).toEqual(["a"]);
    expect(lru.keys()).toEqual(["b", "c"]);
  });

  it("touching an existing key makes it most recently used", () => {
    const lru = new LruSet(2);
    lru.touch("a");
    lru.touch("b");
    lru.touch("a");
    expect(lru.touch("c")).toEqual(["b"]);
    expect(lru.keys()).toEqual(["a", "c"]);
  });

  it("delete removes a key without affecting order", () => {
    const lru = new LruSet(3);
    lru.touch("a");
    lru.touch("b");
    expect(lru.delete("a")).toBe(true);
    expect(lru.delete("missing")).toBe(false);
    expect(lru.keys()).toEqual(["b"]);
  });
});
