import type { components } from "../../../../generated/http/schema.js";

type NodePage = components["schemas"]["NodePage"];

/**
 * Target of the ".." row on a children page. `GET /nodes/{id}/children` returns
 * the folder itself as `parentNode` together with its own ancestry, so the last
 * breadcrumb is the folder being listed and the parent is the one before it.
 */
export type NodeParentRow = {
  readonly label: string;
  /** Undefined means the repository root. */
  readonly nodeId?: string | undefined;
};

export function nodeParentRow(
  page: Pick<NodePage, "breadcrumbs" | "navigationRootNodeId" | "space">
): NodeParentRow | undefined {
  const crumbs = page.breadcrumbs;
  const parent = crumbs.length >= 2 ? crumbs[crumbs.length - 2] : undefined;
  if (parent) return { label: parent.name, nodeId: parent.id };
  // A shared subtree starts at its navigation root, which has no reachable parent.
  if (page.navigationRootNodeId !== null) return undefined;
  return { label: page.space.name };
}
