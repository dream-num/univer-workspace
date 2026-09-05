import { describe, expect, it } from "vitest";
import {
  canDropWorkspaceFileNode,
  dragItemOf,
  groupWorkspaceFileSpaces,
  type WorkspaceFileNode,
  type WorkspaceFileSpace,
} from "../src/index.ts";

const capabilities = {
  browseRoot: true,
  createAtRoot: true,
  renameSpace: true,
  manageMembers: true,
  viewTrash: true,
} as const;

const spaces: readonly WorkspaceFileSpace[] = [
  {
    id: "personal",
    type: "personal",
    name: "Alice",
    accessRole: "owner",
    capabilities,
  },
  {
    id: "team-b",
    type: "team",
    name: "Team B",
    accessRole: "viewer",
    capabilities,
  },
  {
    id: "team-a",
    type: "team",
    name: "Team A",
    accessRole: "editor",
    capabilities,
  },
];

const node: WorkspaceFileNode = {
  id: "folder-a",
  spaceId: "team-a",
  parentNodeId: null,
  name: "Folder A",
  resource: null,
  hasChildren: true,
  accessRole: "editor",
  capabilities: {
    browseChildren: true,
    createChildren: true,
    rename: true,
    move: true,
    trash: true,
    share: true,
  },
};

describe("Workspace file tree model", () => {
  it("groups the owned Personal Space separately from Team Spaces", () => {
    expect(groupWorkspaceFileSpaces(spaces)).toEqual({
      personal: spaces[0],
      teams: [spaces[1], spaces[2]],
    });
  });

  it("allows a move only to a valid different location in the same Space", () => {
    const item = dragItemOf(node);
    expect(
      canDropWorkspaceFileNode(item, {
        spaceId: "team-a",
        parentNodeId: "folder-b",
        ancestorNodeIds: [],
        canCreateChildren: true,
      }),
    ).toBe(true);
    expect(
      canDropWorkspaceFileNode(item, {
        spaceId: "team-b",
        parentNodeId: null,
        ancestorNodeIds: [],
        canCreateChildren: true,
      }),
    ).toBe(false);
    expect(
      canDropWorkspaceFileNode(item, {
        spaceId: "team-a",
        parentNodeId: "folder-child",
        ancestorNodeIds: ["folder-a"],
        canCreateChildren: true,
      }),
    ).toBe(false);
  });
});
