export interface TreeDragItem {
  readonly nodeId: string;
  readonly spaceId: string;
  readonly parentNodeId: string | null;
}

export interface TreeDropDestination {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly ancestorNodeIds: readonly string[];
  readonly canCreateChildren: boolean;
}

export function canDropTreeNode(
  item: TreeDragItem | null,
  destination: TreeDropDestination
): boolean {
  if (!item || !destination.canCreateChildren) return false;
  if (item.spaceId !== destination.spaceId) return false;
  if (item.parentNodeId === destination.parentNodeId) return false;
  if (destination.parentNodeId === item.nodeId) return false;
  return !destination.ancestorNodeIds.includes(item.nodeId);
}

export function treeDropDestinationKey(
  destination: Pick<TreeDropDestination, "spaceId" | "parentNodeId">
): string {
  return `${destination.spaceId}:${destination.parentNodeId ?? "root"}`;
}
