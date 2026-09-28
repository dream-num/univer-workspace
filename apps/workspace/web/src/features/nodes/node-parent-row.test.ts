import { describe, expect, it } from "vitest";
import { nodeParentRow } from "./node-parent-row.js";

const space = { id: "space-1", type: "team", name: "mini-crm", publicRead: true } as const;

describe("nodeParentRow", () => {
  it("points at the ancestor before the listed folder", () => {
    expect(
      nodeParentRow({
        space,
        navigationRootNodeId: null,
        breadcrumbs: [
          { id: "data", name: "data" },
          { id: "pipeline", name: "商机管线" },
        ],
      })
    ).toEqual({ label: "data", nodeId: "data" });
  });

  it("points at the repository root from a top-level folder", () => {
    expect(
      nodeParentRow({
        space,
        navigationRootNodeId: null,
        breadcrumbs: [{ id: "data", name: "data" }],
      })
    ).toEqual({ label: "mini-crm" });
  });

  it("hides the row at the root of a shared subtree", () => {
    expect(
      nodeParentRow({
        space,
        navigationRootNodeId: "shared",
        breadcrumbs: [{ id: "shared", name: "共享目录" }],
      })
    ).toBeUndefined();
  });

  it("has no parent row at the repository root", () => {
    expect(
      nodeParentRow({ space, navigationRootNodeId: null, breadcrumbs: [] })
    ).toEqual({ label: "mini-crm" });
  });
});
