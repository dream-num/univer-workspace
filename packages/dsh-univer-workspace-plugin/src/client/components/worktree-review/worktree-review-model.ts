/**
 * Pure presentation model for the middle Worktree review surface: the smart
 * path tree (Space grouping + single-child chain compression), per-Unit
 * location states, and the bounded LRU set behind viewport-aware Viewer
 * retention. No React, no fetch, no fixture data — every input comes from the
 * real Worktree detail and the server-clipped Node location contract.
 * @module dsh-univer-workspace-plugin/client/components/worktree-review/worktree-review-model
 */

import type { WorktreeUnitView } from "../../../shared/state.ts";

/** Location of one Unit as far as the caller is allowed to see it. */
export type UnitLocationState =
  | { readonly status: "loading" }
  | {
      readonly status: "resolved";
      readonly spaceId: string;
      readonly spaceName: string;
      /** Ancestor directory names, already clipped by the server to the grant root. */
      readonly path: readonly string[];
      readonly shared: boolean;
    }
  | { readonly status: "unavailable" };

/**
 * The existing Node whose location a Unit may safely reuse: a trunk-backed
 * Unit resolves its own Node; a Worktree-local Unit has no persistent Node
 * before merge activation, so it resolves its target parent instead. Returns
 * null when the contract carries no resolvable Node identity at all.
 */
export function locationNodeIdOf(unit: WorktreeUnitView): string | null {
  if (unit.source === "worktree") return unit.target?.parentNodeId ?? null;
  return unit.nodeId;
}

/** One Unit's resolved position for the path tree. */
export interface PathTreeUnitEntry {
  readonly unitId: string;
  readonly name: string;
  readonly deleted: boolean;
  readonly shared: boolean;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly path: readonly string[];
}

export interface PathTreeNode {
  readonly key: string;
  readonly label: string;
  readonly children: readonly PathTreeNode[];
  /** Set only on leaf nodes that represent a changed Unit. */
  readonly unitId: string | null;
  readonly deleted: boolean;
  readonly shared: boolean;
}

export interface PathTreeSpaceGroup {
  readonly spaceId: string;
  readonly spaceName: string;
  readonly external: boolean;
  readonly roots: readonly PathTreeNode[];
}

interface MutableTreeNode {
  label: string;
  readonly children: MutableTreeNode[];
  unitId: string | null;
  deleted: boolean;
  shared: boolean;
}

/**
 * Group Units by their real Space and build a directory trie per Space, then
 * compress every chain of single-child directories into one row (`a / b`).
 * Insertion order (the Worktree's Unit order) is preserved; Units with the
 * same name stay disambiguated by their Space and ancestor path.
 */
export function buildPathTree(
  entries: readonly PathTreeUnitEntry[],
): readonly PathTreeSpaceGroup[] {
  const spaces: {
    readonly spaceId: string;
    readonly spaceName: string;
    roots: MutableTreeNode[];
  }[] = [];
  for (const entry of entries) {
    const groupId = entry.shared ? "__external__" : entry.spaceId;
    let space = spaces.find((candidate) => candidate.spaceId === groupId);
    if (space === undefined) {
      space = { spaceId: groupId, spaceName: entry.shared ? "" : entry.spaceName, roots: [] };
      spaces.push(space);
    }
    let level = space.roots;
    for (const segment of entry.shared ? [] : entry.path) {
      let dir = level.find((node) => node.unitId === null && node.label === segment);
      if (dir === undefined) {
        dir = { label: segment, children: [], unitId: null, deleted: false, shared: false };
        level.push(dir);
      }
      level = dir.children;
    }
    level.push({
      label: entry.name,
      children: [],
      unitId: entry.unitId,
      deleted: entry.deleted,
      shared: entry.shared,
    });
  }
  return spaces.map((space) => ({
    spaceId: space.spaceId,
    spaceName: space.spaceName,
    external: space.spaceId === "__external__",
    roots: space.roots.map((root) => freezeNode(root, space.spaceId)),
  }));
}

function freezeNode(node: MutableTreeNode, keyPrefix: string): PathTreeNode {
  const compressed = compressNode(node);
  return {
    key: `${keyPrefix}/${compressed.label}`,
    label: compressed.label,
    children: compressed.children.map((child) =>
      freezeNode(child, `${keyPrefix}/${compressed.label}`),
    ),
    unitId: compressed.unitId,
    deleted: compressed.deleted,
    shared: compressed.shared,
  };
}

/**
 * Human-readable title for a changed Unit. The server-clipped location is
 * authoritative; unresolved locations deliberately fall back to the Unit
 * name instead of inventing a path.
 */
export function unitLocationTitle(location: UnitLocationState, unitName: string): string {
  if (location.status !== "resolved") return unitName;
  return [location.spaceName, ...location.path, unitName].join(" / ");
}

/** Merge a run of unary directory nodes into one label; leaves stay intact. */
function compressNode(node: MutableTreeNode): MutableTreeNode {
  let label = node.label;
  let current = node;
  while (current.unitId === null && current.children.length === 1) {
    const [only] = current.children;
    if (only === undefined || only.unitId !== null) break;
    label = `${label} / ${only.label}`;
    current = only;
  }
  return { ...current, label };
}

/**
 * Bounded least-recently-used set backing the confirmed retention policy:
 * Viewers scrolled out of the viewport stay mounted until capacity pressure
 * evicts the least recently visible one.
 */
export class LruSet {
  private readonly order = new Map<string, true>();

  constructor(private readonly capacity: number) {}

  /** Mark key as most recently used; returns the keys evicted by capacity. */
  touch(key: string): readonly string[] {
    this.order.delete(key);
    this.order.set(key, true);
    const evicted: string[] = [];
    while (this.order.size > this.capacity) {
      const oldest = this.order.keys().next().value;
      if (oldest === undefined) break;
      this.order.delete(oldest);
      evicted.push(oldest);
    }
    return evicted;
  }

  has(key: string): boolean {
    return this.order.has(key);
  }

  delete(key: string): boolean {
    return this.order.delete(key);
  }

  get size(): number {
    return this.order.size;
  }

  /** Oldest first. */
  keys(): readonly string[] {
    return [...this.order.keys()];
  }
}
