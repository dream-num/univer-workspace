import type { WorkspaceFileNode, WorkspaceFileSpace } from "./types.js";

export interface WorkspaceFileSpaceGroups {
  readonly personal: WorkspaceFileSpace | undefined;
  readonly teams: readonly WorkspaceFileSpace[];
}

export function groupWorkspaceFileSpaces(
  spaces: readonly WorkspaceFileSpace[],
): WorkspaceFileSpaceGroups {
  return {
    personal: spaces.find((space) => space.type === "personal" && space.accessRole === "owner"),
    teams: spaces.filter((space) => space.type === "team"),
  };
}

export interface WorkspaceFileDragItem {
  readonly nodeId: string;
  readonly spaceId: string;
  readonly parentNodeId: string | null;
}

export interface WorkspaceFileDropDestination {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly ancestorNodeIds: readonly string[];
  readonly canCreateChildren: boolean;
}

export function dragItemOf(node: WorkspaceFileNode): WorkspaceFileDragItem {
  return { nodeId: node.id, spaceId: node.spaceId, parentNodeId: node.parentNodeId };
}

export function canDropWorkspaceFileNode(
  item: WorkspaceFileDragItem | null,
  destination: WorkspaceFileDropDestination,
): boolean {
  return (
    item !== null &&
    destination.canCreateChildren &&
    item.spaceId === destination.spaceId &&
    item.nodeId !== destination.parentNodeId &&
    item.parentNodeId !== destination.parentNodeId &&
    !destination.ancestorNodeIds.includes(item.nodeId)
  );
}

export function workspaceFileDropKey(destination: WorkspaceFileDropDestination): string {
  return `${destination.spaceId}:${destination.parentNodeId ?? "root"}`;
}
