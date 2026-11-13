// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/outline/merges.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// Merged-cell facts shared by the outline and Lens.read. Univer stores a merged value only in the top-left (anchor)
// cell; covered cells read as empty, so these helpers never copy the anchor's value (04-lens-outline.md section 5.1).
import { type Rect, rectToA1 } from "../ranges.js";
import type { SheetCells } from "./cells.js";

const intersects = (a: Rect, b: Rect) =>
  a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0;

/** Real merges (more than one cell) in row-major anchor order. */
export function realMerges(sc: SheetCells): Rect[] {
  return sc.merges
    .filter((m) => m.r1 > m.r0 || m.c1 > m.c0)
    .sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);
}

/** Merges whose rectangle intersects `q`, each as its full (untrimmed) rectangle. */
export const mergesIn = (sc: SheetCells, q: Rect): Rect[] =>
  realMerges(sc).filter((m) => intersects(m, q));

/** The merge anchored (top-left) at one cell, as A1; undefined when the cell is not an anchor. */
export function spanAt(sc: SheetCells, r: number, c: number): string | undefined {
  const m = realMerges(sc).find((x) => x.r0 === r && x.c0 === c);
  return m ? rectToA1(m) : undefined;
}

/** Cap a list at `cap` entries and report how many were left out. */
export const capList = (items: string[], cap: number): { items: string[]; more: number } => ({
  items: items.slice(0, cap),
  more: Math.max(0, items.length - cap),
});
