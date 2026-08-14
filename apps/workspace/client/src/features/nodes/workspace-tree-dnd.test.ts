import { describe, expect, it } from "vitest";
import { canDropTreeNode } from "./workspace-tree-dnd.js";

const item = {
  nodeId: "article",
  spaceId: "personal",
  parentNodeId: null,
} as const;

describe("canDropTreeNode", () => {
  it("allows moving a node below another document", () => {
    expect(
      canDropTreeNode(item, {
        spaceId: "personal",
        parentNodeId: "document",
        ancestorNodeIds: [],
        canCreateChildren: true,
      })
    ).toBe(true);
  });

  it("allows moving a nested node back to the space root", () => {
    expect(
      canDropTreeNode(
        { ...item, parentNodeId: "document" },
        {
          spaceId: "personal",
          parentNodeId: null,
          ancestorNodeIds: [],
          canCreateChildren: true,
        }
      )
    ).toBe(true);
  });

  it("rejects no-op, cross-space, and cyclic moves", () => {
    expect(
      canDropTreeNode(item, {
        spaceId: "personal",
        parentNodeId: null,
        ancestorNodeIds: [],
        canCreateChildren: true,
      })
    ).toBe(false);
    expect(
      canDropTreeNode(item, {
        spaceId: "team",
        parentNodeId: "document",
        ancestorNodeIds: [],
        canCreateChildren: true,
      })
    ).toBe(false);
    expect(
      canDropTreeNode(item, {
        spaceId: "personal",
        parentNodeId: "grandchild",
        ancestorNodeIds: ["article", "child"],
        canCreateChildren: true,
      })
    ).toBe(false);
  });

  it("rejects destinations without child-creation permission", () => {
    expect(
      canDropTreeNode(item, {
        spaceId: "personal",
        parentNodeId: "readonly-document",
        ancestorNodeIds: [],
        canCreateChildren: false,
      })
    ).toBe(false);
  });
});
