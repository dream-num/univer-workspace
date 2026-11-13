// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/detect/anchors.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// Layer 3: structural anchors. "SpreadsheetLLM-style anchors (re-implementation)": written from the prose description in
// SpreadsheetLLM (Dong et al., EMNLP 2024) Appendix C. The paper gives NO numeric thresholds and no code, so every
// number here (config.ts) is our own choice; this is NOT a reproduction and no parity with the paper is claimed.
//
// Paper steps and what we do:
//  1. bounding lines = rows/columns that differ from their neighbours (values, merged cells, borders, fill, font)
//       -> `lineSignature` + `signatureDelta`; a non-empty line next to an empty line or the grid edge is always a line.
//  2. candidate rectangles from any two row-lines and any two column-lines
//       -> `anchorRegions`: top/bottom/left/right line sets (each capped at anchorMaxLines strongest lines).
//  3. filter by integrity inside each candidate (sparsity, edge occupancy, size)
//       -> minimum 1 cell, density >= anchorMinDensity, every edge strip >= anchorMinEdgeFill non-empty.
//  4. resolve overlapping candidates pairwise using relative position and header presence (text share or year/date cells)
//       -> `prefer()`.
// Differences from the paper (all deliberate, all affect comparability): lines are enumerated per coarse component
// (empty-gap >= 2 decomposition) instead of on the whole sheet, to keep the O(L^4) enumeration tractable and the
// signatures unmixed by side-by-side blocks; the k-neighbourhood retention (k=4) is a compression-view feature and is not
// part of region output.

import type { Rect } from "../ranges.js";
import type { DetectConfig } from "./config.js";
import { countIn, type FeatureSheet, FL, gi, tighten, VT } from "./features.js";

export interface LineStats {
  n: number; // non-empty cells in the span
  width: number; // span length
  text: number;
  num: number;
  date: number; // date cells
  year: number; // year-like integers
  bold: number;
  fill: number;
  border: number;
  merged: number;
}
const ZERO: LineStats = {
  n: 0,
  width: 0,
  text: 0,
  num: 0,
  date: 0,
  year: 0,
  bold: 0,
  fill: 0,
  border: 0,
  merged: 0,
};

function accumulate(fs: FeatureSheet, s: LineStats, k: number): void {
  const t = fs.vt[k];
  if (!t) return;
  const f = fs.flags[k] ?? 0;
  s.n++;
  if (t === VT.text || t === VT.bool || t === VT.error) s.text++;
  else if (t === VT.num) s.num++;
  else if (t === VT.date) s.date++;
  if (f & FL.year) s.year++;
  if (f & FL.bold) s.bold++;
  if (f & FL.fill) s.fill++;
  if (f & FL.border) s.border++;
  if (f & FL.merged) s.merged++;
}
export function rowStats(fs: FeatureSheet, r: number, c0: number, c1: number): LineStats {
  const s = { ...ZERO, width: c1 - c0 + 1 };
  if (r < fs.r0 || r >= fs.r0 + fs.nr) return s;
  for (let c = Math.max(c0, fs.c0); c <= Math.min(c1, fs.c0 + fs.nc - 1); c++)
    accumulate(fs, s, gi(fs, r, c));
  return s;
}
export function colStats(fs: FeatureSheet, c: number, r0: number, r1: number): LineStats {
  const s = { ...ZERO, width: r1 - r0 + 1 };
  if (c < fs.c0 || c >= fs.c0 + fs.nc) return s;
  for (let r = Math.max(r0, fs.r0); r <= Math.min(r1, fs.r0 + fs.nr - 1); r++)
    accumulate(fs, s, gi(fs, r, c));
  return s;
}

/** Feature vector of a line (each entry in [0,1]); an empty line is the zero vector. */
export function lineSignature(s: LineStats): number[] {
  if (!s.n) return [0, 0, 0, 0, 0, 0, 0, 0];
  return [
    s.n / s.width,
    s.text / s.n,
    s.num / s.n,
    (s.date + s.year) / s.n,
    s.bold / s.n,
    s.fill / s.n,
    s.border / s.n,
    s.merged / s.n,
  ];
}
/** L1 distance between two line signatures (0 = identical, up to 8). */
export function signatureDelta(a: LineStats, b: LineStats): number {
  const x = lineSignature(a),
    y = lineSignature(b);
  return x.reduce((acc, v, i) => acc + Math.abs(v - (y[i] ?? 0)), 0);
}

/**
 * Header score in [0,1]: share of "textual or date/year" cells (the paper's header cue), scaled down when the line covers
 * only part of the span, and nudged up by bold/fill emphasis. Empty line => 0.
 */
export function headerScore(s: LineStats): number {
  // a lone cell is a title / label, not a header row (exception: a 1-wide line that is emphasised)
  if (!s.n || (s.n < 2 && !(s.width === 1 && Math.max(s.bold, s.fill) > 0))) return 0;
  const textual = (s.text + s.date + s.year) / s.n;
  const cover = Math.min(1, s.n / s.width / 0.5);
  const emphasis = Math.max(s.bold, s.fill) / s.n;
  return Math.min(1, textual * cover + (emphasis >= 0.5 ? 0.15 * cover : 0));
}
export const emphasisShare = (s: LineStats): number => (s.n ? Math.max(s.bold, s.fill) / s.n : 0);

// ---------------------------------------------------------------- B1: anchors -> candidate rectangles
interface Cand {
  rect: Rect;
  cells: number;
  density: number;
  header: boolean;
  score: number;
}

interface Lines {
  top: number[];
  bottom: number[];
  left: number[];
  right: number[];
}

function strongest(scored: [number, number][], k: number): number[] {
  return scored
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map((x) => x[0])
    .sort((a, b) => a - b);
}

/** Candidate bounding lines of a component box (step 1). Strength = how strongly the line differs from the outside neighbour. */
export function anchorLines(fs: FeatureSheet, box: Rect, cfg: DetectConfig): Lines {
  const top: [number, number][] = [],
    bottom: [number, number][] = [],
    left: [number, number][] = [],
    right: [number, number][] = [];
  const EDGE = 8; // empty neighbour / grid edge: maximal strength
  for (let r = box.r0; r <= box.r1; r++) {
    const cur = rowStats(fs, r, box.c0, box.c1);
    if (!cur.n) continue;
    const up = r > box.r0 ? signatureDelta(cur, rowStats(fs, r - 1, box.c0, box.c1)) : EDGE;
    const dn = r < box.r1 ? signatureDelta(cur, rowStats(fs, r + 1, box.c0, box.c1)) : EDGE;
    const upEmpty = r === box.r0 || rowStats(fs, r - 1, box.c0, box.c1).n === 0;
    const dnEmpty = r === box.r1 || rowStats(fs, r + 1, box.c0, box.c1).n === 0;
    if (upEmpty || up >= cfg.anchorDelta) top.push([r, upEmpty ? EDGE : up]);
    if (dnEmpty || dn >= cfg.anchorDelta) bottom.push([r, dnEmpty ? EDGE : dn]);
  }
  for (let c = box.c0; c <= box.c1; c++) {
    const cur = colStats(fs, c, box.r0, box.r1);
    if (!cur.n) continue;
    const lf = c > box.c0 ? colStats(fs, c - 1, box.r0, box.r1) : null;
    const rt = c < box.c1 ? colStats(fs, c + 1, box.r0, box.r1) : null;
    const lfEmpty = !lf || lf.n === 0,
      rtEmpty = !rt || rt.n === 0;
    const dl = lf ? signatureDelta(cur, lf) : EDGE,
      dr = rt ? signatureDelta(cur, rt) : EDGE;
    if (lfEmpty || dl >= cfg.anchorDelta) left.push([c, lfEmpty ? EDGE : dl]);
    if (rtEmpty || dr >= cfg.anchorDelta) right.push([c, rtEmpty ? EDGE : dr]);
  }
  const k = cfg.anchorMaxLines;
  return {
    top: strongest(top, k),
    bottom: strongest(bottom, k),
    left: strongest(left, k),
    right: strongest(right, k),
  };
}

const area = (q: Rect) => (q.r1 - q.r0 + 1) * (q.c1 - q.c0 + 1);
const overlaps = (a: Rect, b: Rect) => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;
const contains = (a: Rect, b: Rect) => a.r0 <= b.r0 && a.c0 <= b.c0 && a.r1 >= b.r1 && a.c1 >= b.c1;

function hasHeader(fs: FeatureSheet, q: Rect, cfg: DetectConfig): boolean {
  if (q.r1 === q.r0) return false;
  const h = headerScore(rowStats(fs, q.r0, q.c0, q.c1));
  const next = headerScore(rowStats(fs, q.r0 + 1, q.c0, q.c1));
  return h >= cfg.headerScoreMin && h - next >= 0.15;
}

/** Step 4: pairwise decision between two overlapping candidates; returns the winner. */
function prefer(a: Cand, b: Cand): Cand {
  if (contains(a.rect, b.rect) || contains(b.rect, a.rect)) {
    // nested candidates: header presence decides, then the larger rectangle (it explains more cells)
    if (a.header !== b.header) return a.header ? a : b;
    return area(a.rect) >= area(b.rect) ? a : b;
  }
  // partial overlap: close top boundaries -> header presence decides; otherwise the higher score
  if (Math.abs(a.rect.r0 - b.rect.r0) <= 2 && a.header !== b.header) return a.header ? a : b;
  return a.score > b.score || (a.score === b.score && area(a.rect) >= area(b.rect)) ? a : b;
}

/** B1 range output for one component box. */
export function anchorRegions(fs: FeatureSheet, box: Rect, cfg: DetectConfig): Rect[] {
  const L = anchorLines(fs, box, cfg);
  const cands: Cand[] = [];
  for (const t of L.top)
    for (const b of L.bottom) {
      if (b < t) continue;
      for (const l of L.left)
        for (const r of L.right) {
          if (r < l) continue;
          const rect = { r0: t, c0: l, r1: b, c1: r };
          const cells = countIn(fs, rect);
          if (cells < 1) continue;
          const density = cells / area(rect);
          if (density < cfg.anchorMinDensity) continue;
          // edge integrity: every edge strip must hold some cells (the rectangle is tight)
          const edges = [
            countIn(fs, { ...rect, r1: t }) / (r - l + 1),
            countIn(fs, { ...rect, r0: b }) / (r - l + 1),
            countIn(fs, { ...rect, c1: l }) / (b - t + 1),
            countIn(fs, { ...rect, c0: r }) / (b - t + 1),
          ];
          if (Math.min(...edges) < cfg.anchorMinEdgeFill) continue;
          const header = hasHeader(fs, rect, cfg);
          cands.push({
            rect,
            cells,
            density,
            header,
            score: density * Math.sqrt(cells) * (header ? 1.5 : 1),
          });
        }
    }
  cands.sort(
    (a, b) =>
      b.score - a.score ||
      area(b.rect) - area(a.rect) ||
      a.rect.r0 - b.rect.r0 ||
      a.rect.c0 - b.rect.c0 ||
      a.rect.r1 - b.rect.r1 ||
      a.rect.c1 - b.rect.c1,
  );
  const pool = cands.slice(0, cfg.anchorMaxCandidates);
  let kept: Cand[] = [];
  for (const cand of pool) {
    const clash = kept.filter((k) => overlaps(k.rect, cand.rect));
    if (clash.some((k) => prefer(k, cand) === k)) continue;
    kept = kept.filter((k) => !clash.includes(k));
    kept.push(cand);
  }
  return kept
    .map((k) => tighten(fs, k.rect))
    .filter((q): q is Rect => q !== null)
    .sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);
}
