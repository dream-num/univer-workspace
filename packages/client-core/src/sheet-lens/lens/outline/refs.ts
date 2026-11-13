// Ref assignment (RFC 04 section 5), stateless version.
// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/outline/refs.ts (reference
// implementation, read-only; ADR-0006). unvdp keeps a ref table across revisions and reconciles it after every edit; uxl
// commands are stateless (ADR-0003), so only the first-assignment rules remain:
//  - sheets are numbered s1.. in workbook order;
//  - a region gets `<sheet>.<letter><n>`, n counting per (sheet, letter) in row-major order of the regions;
//  - a child gets `<region>.<c|a|d><n>`, n counting from 1 in column / axis / field order.
// The same file content therefore always yields the same refs. Refs are valid for the content they were printed from.
import type { Rect } from "../ranges.js";

export type RegionKind = "table" | "matrix" | "form" | "text" | "kpi" | "block";
export const KIND_LETTER: Record<RegionKind, string> = {
  table: "t",
  matrix: "m",
  form: "f",
  text: "x",
  kpi: "k",
  block: "b",
};
export const CHILD_LETTER: Partial<Record<RegionKind, "c" | "a" | "d">> = {
  table: "c",
  matrix: "a",
  form: "d",
};

export interface DetectedItem {
  rect: Rect;
  kind: RegionKind;
}

export interface AssignedRefs {
  sheetRefs: string[];
  /** per sheet, per input region (same order as the input): its ref */
  regionRefs: string[][];
  /** per sheet, per input region: the refs of its children, `childCounts` long */
  childRefs: string[][][];
}

const rowMajor = (a: DetectedItem, b: DetectedItem): number =>
  a.rect.r0 - b.rect.r0 || a.rect.c0 - b.rect.c0 || a.rect.r1 - b.rect.r1 || a.rect.c1 - b.rect.c1;

export function assignRefs(
  sheets: { regions: DetectedItem[]; childCounts: number[] }[],
): AssignedRefs {
  const out: AssignedRefs = { sheetRefs: [], regionRefs: [], childRefs: [] };
  sheets.forEach((sheet, si) => {
    const sref = `s${si + 1}`;
    out.sheetRefs.push(sref);
    const next: Record<string, number> = {};
    const refs: string[] = [];
    const kids: string[][] = [];
    const order = sheet.regions
      .map((item, idx) => ({ item, idx }))
      .sort((a, b) => rowMajor(a.item, b.item) || a.idx - b.idx);
    for (const { item, idx } of order) {
      const letter = KIND_LETTER[item.kind];
      const n = (next[letter] ?? 0) + 1;
      next[letter] = n;
      const base = `${sref}.${letter}${n}`;
      refs[idx] = base;
      const childLetter = CHILD_LETTER[item.kind] ?? "c";
      kids[idx] = Array.from(
        { length: sheet.childCounts[idx] ?? 0 },
        (_, i) => `${base}.${childLetter}${i + 1}`,
      );
    }
    out.regionRefs.push(refs);
    out.childRefs.push(kids);
  });
  return out;
}
