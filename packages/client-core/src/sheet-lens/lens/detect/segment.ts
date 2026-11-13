// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/detect/segment.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// Layer 4: segmentation. Connected components with gap tolerance, then evidence-based splitting, then growth.
// Rule ids (CC-2, S1-same, X-ring ...) and the principles behind them: RFC 0001 annex A1 (informative).
//   CC components         values within gapTolerance empty lines connect; a formatted row running through empty
//                         columns between values also connects them (bridgedByStyle)
//   S1 blank-line cut     an empty row / column run inside a block separates it only on header, title or structure
//                         evidence; a run bridged by formatting is never cut
//   S4 overhang           a top / bottom line over columns the rest leaves empty is its own block, unless it is a
//                         header whose span covers the sparse body below
//   S2 style-change cut   an emphasised header-like row directly below body rows starts a new block, unless it holds
//                         the column values of the body (a subtotal, a zebra stripe)
//   S3 peel               title / kpi lines above the header row and a trailing note become their own blocks
//   S5 extend / join      a block grows over adjacent formatting-only cells that continue its border grid or fill band
//                         (bounded, see extendOverStyle) and over the merges anchored in it; a one-line header / title /
//                         total joined that way to a same-width body becomes one block again
// One principle runs through CC, S1 and S5: formatting that belongs to a region (a header band, a bordered grid that
// ends) joins, formatting that covers most of the sheet (a frame column, forecast shading) is not evidence. Totals rows
// stay with the table above. Hidden lines are transparent for gap counting. Everything here is a pure function of the
// feature grid; regions never overlap.

import type { Rect } from "../ranges.js";
import { emphasisShare, headerScore, rowStats, signatureDelta } from "./anchors.js";
import type { DetectConfig } from "./config.js";
import {
  countIn,
  coveredIn,
  type FeatureSheet,
  FL,
  gi,
  STYLE_REACH,
  styledIn,
  tighten,
  VT,
} from "./features.js";

export interface Block {
  rect: Rect;
  /** machine-readable provenance, e.g. "cc", "cc>blank-cut", "cc>peel-preamble" */
  origin: string;
}

// ---------------------------------------------------------------- connected components
function neighbourLines(
  start: number,
  lo: number,
  hi: number,
  hidden: Set<number>,
  reach: number,
  dir: 1 | -1,
): number[] {
  const out: number[] = [];
  let seen = 0;
  for (let x = start + dir; x >= lo && x <= hi && seen < reach; x += dir) {
    out.push(x);
    if (!hidden.has(x)) seen++;
  }
  return out;
}

/** Connected components of non-empty cells; two cells connect when at most `gap` visible empty lines lie between them in both axes. */
export function components(fs: FeatureSheet, gap: number): Rect[] {
  if (!fs.nr || fs.tooLarge) return [];
  const { nr, nc, r0, c0 } = fs;
  const reach = gap + 1;
  const parent = new Int32Array(nr * nc);
  for (let k = 0; k < parent.length; k++) parent[k] = k;
  const find = (x: number): number => {
    let p = parent[x] ?? x;
    while (p !== x) {
      const up = parent[p] ?? p;
      parent[x] = up;
      x = up;
      p = parent[x] ?? x;
    }
    return x;
  };
  const rowsDown = Array.from({ length: nr }, (_, i) =>
    neighbourLines(r0 + i, r0, r0 + nr - 1, fs.hiddenRows, reach, 1),
  );
  const colsAll = Array.from({ length: nc }, (_, j) => [
    ...neighbourLines(c0 + j, c0, c0 + nc - 1, fs.hiddenCols, reach, -1),
    ...neighbourLines(c0 + j, c0, c0 + nc - 1, fs.hiddenCols, reach, 1),
  ]);
  const colsRight = Array.from({ length: nc }, (_, j) =>
    neighbourLines(c0 + j, c0, c0 + nc - 1, fs.hiddenCols, reach, 1),
  );
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc; j++) {
      const k = i * nc + j;
      if (!fs.vt[k]) continue;
      for (const c of colsRight[j] ?? []) {
        const k2 = i * nc + (c - c0);
        if (fs.vt[k2]) parent[find(k2)] = find(k);
      }
      for (const r of rowsDown[i] ?? []) {
        const ri = r - r0;
        for (const c of [c0 + j, ...(colsAll[j] ?? [])]) {
          const k2 = ri * nc + (c - c0);
          if (fs.vt[k2]) parent[find(k2)] = find(k);
        }
      }
    }
  }
  // a filled or bordered row running through empty columns joins the values on both sides (bridgedByStyle)
  const bridges = new Map<number, boolean>();
  for (let i = 0; i < nr; i++) {
    let last = -1,
      styledRun = true;
    for (let j = 0; j < nc; j++) {
      const k = i * nc + j;
      if (fs.vt[k]) {
        if (last >= 0 && styledRun && j - last > 1) {
          const key = last * nc + j;
          if (!bridges.has(key))
            bridges.set(key, bridgedByStyle(fs, r0, r0 + nr - 1, c0 + last + 1, c0 + j - 1));
          if (bridges.get(key)) parent[find(k)] = find(i * nc + last);
        }
        last = j;
        styledRun = true;
      } else if (!((fs.flags[k] ?? 0) & FL.styled)) styledRun = false;
    }
  }
  const boxes = new Map<number, Rect>();
  for (let k = 0; k < parent.length; k++) {
    if (!fs.vt[k]) continue;
    const root = find(k),
      r = r0 + Math.floor(k / nc),
      c = c0 + (k % nc);
    const b = boxes.get(root);
    if (!b) boxes.set(root, { r0: r, c0: c, r1: r, c1: c });
    else {
      b.r0 = Math.min(b.r0, r);
      b.r1 = Math.max(b.r1, r);
      b.c0 = Math.min(b.c0, c);
      b.c1 = Math.max(b.c1, c);
    }
  }
  return fuseOverlapping([...boxes.values()]).sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);
}

/** Component bounding boxes can interleave (L-shapes); overlapping boxes are fused so regions never overlap. */
function fuseOverlapping(boxes: Rect[]): Rect[] {
  const list = boxes.map((b) => ({ ...b }));
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < list.length && !changed; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!a || !b) continue;
        if (a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1) {
          list[i] = {
            r0: Math.min(a.r0, b.r0),
            c0: Math.min(a.c0, b.c0),
            r1: Math.max(a.r1, b.r1),
            c1: Math.max(a.c1, b.c1),
          };
          list.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
  }
  return list;
}

// ---------------------------------------------------------------- row / column evidence helpers
const rs = (fs: FeatureSheet, q: Rect, r: number) => rowStats(fs, r, q.c0, q.c1);
const isHeaderRow = (fs: FeatureSheet, q: Rect, r: number, cfg: DetectConfig) =>
  headerScore(rs(fs, q, r)) >= cfg.headerScoreMin;

/** Dominant value type per column over rows [r0, r1] (1=num 2=date 3=text ...), 0 when the column is empty there. */
function columnTypes(fs: FeatureSheet, q: Rect, r0: number, r1: number): number[] {
  const out: number[] = [];
  for (let c = q.c0; c <= q.c1; c++) {
    const hist = new Map<number, number>();
    for (let r = r0; r <= r1; r++) {
      const t = fs.vt[gi(fs, r, c)];
      if (t) hist.set(t, (hist.get(t) ?? 0) + 1);
    }
    out.push([...hist.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0);
  }
  return out;
}
const sameTypes = (a: number[], b: number[]) => {
  const both = a.map((t, i) => [t, b[i]]).filter(([x, y]) => x && y);
  return both.length > 0 && both.filter(([x, y]) => x === y).length / both.length >= 0.7;
};

/** Decide whether an empty row run between `above` and `below` (both tightened sub-blocks) separates two blocks. */
function cutAcrossBlankRows(
  fs: FeatureSheet,
  above: Rect,
  below: Rect,
  cfg: DetectConfig,
): string | null {
  const rowsA = above.r1 - above.r0 + 1,
    rowsB = below.r1 - below.r0 + 1;
  const topB = rs(fs, below, below.r0);
  const hdrB =
    isHeaderRow(fs, below, below.r0, cfg) &&
    (rowsB === 1 ||
      headerScore(topB) - headerScore(rs(fs, below, below.r0 + 1)) >= 0.15 ||
      emphasisShare(topB) >= 0.5);
  const nA = countIn(fs, above),
    nB = countIn(fs, below);
  if (rowsA === 1 && nA <= cfg.sparseMaxCells && rowsB >= 2 && (hdrB || topB.n > nA))
    return "title-above-gap";
  if (hdrB && rowsB >= 2) return "header-below-gap";
  if (rowsB === 1) {
    // a single line below the gap stays with the block above when it lies inside the block's columns (totals / sparse
    // continuation) and is neither a long note nor emphasised; otherwise it is a separate line
    const within = below.c0 >= above.c0 && below.c1 <= above.c1 && rowsA >= 2;
    const note =
      topB.n === 1 &&
      topB.text === 1 &&
      (fs.texts.get(gi(fs, below.r0, below.c0)) ?? "").length >= cfg.noteMinChars;
    return within && !note && emphasisShare(topB) < 0.5 ? null : "line-below-gap";
  }
  if (nA === 0 || nB === 0) return null;
  // blank row inside one table / sparse column group: the column spans nest and the shared columns have the same types
  const nested =
    (above.c0 <= below.c0 && above.c1 >= below.c1) ||
    (below.c0 <= above.c0 && below.c1 >= above.c1);
  if (
    nested &&
    sameTypes(
      columnTypes(
        fs,
        { ...above, c0: Math.max(above.c0, below.c0), c1: Math.min(above.c1, below.c1) },
        Math.min(above.r1, above.r0 + 1),
        above.r1,
      ),
      columnTypes(
        fs,
        { ...below, c0: Math.max(above.c0, below.c0), c1: Math.min(above.c1, below.c1) },
        below.r0,
        below.r1,
      ),
    )
  )
    return null;
  return "structure-change-gap";
}

/** Single empty column between two sides: cut when both sides carry their own header-like top row, or one side is a lone line. */
function cutAcrossBlankCols(
  fs: FeatureSheet,
  left: Rect,
  right: Rect,
  box: Rect,
  cfg: DetectConfig,
): string | null {
  for (const m of fs.merges)
    if (
      m.c0 < right.c0 &&
      m.c1 >= left.c1 + 1 &&
      m.r1 >= box.r0 &&
      m.r0 <= box.r1 &&
      m.c0 <= left.c1 &&
      m.c1 >= right.c0
    )
      return null; // a merged span bridges the gap
  const hl = isHeaderRow(fs, left, left.r0, cfg),
    hr = isHeaderRow(fs, right, right.r0, cfg);
  if (hl && hr) return "two-headers-col-gap";
  if (left.r1 === left.r0 || right.r1 === right.r0) return "line-beside-col-gap";
  return null;
}

// ---------------------------------------------------------------- splitting
/** A line is blank when it holds no value and no cell covered by a value-anchored merge (a merge is one cell on screen). */
const blank = (fs: FeatureSheet, q: Rect) => countIn(fs, q) === 0 && coveredIn(fs, q) === 0;

function emptyRowRuns(fs: FeatureSheet, q: Rect): [number, number][] {
  const runs: [number, number][] = [];
  for (let r = q.r0; r <= q.r1; r++) {
    if (!blank(fs, { ...q, r0: r, r1: r })) continue;
    let e = r;
    while (e + 1 <= q.r1 && blank(fs, { ...q, r0: e + 1, r1: e + 1 })) e++;
    runs.push([r, e]);
    r = e;
  }
  return runs;
}
function emptyColRuns(fs: FeatureSheet, q: Rect): [number, number][] {
  const runs: [number, number][] = [];
  for (let c = q.c0; c <= q.c1; c++) {
    if (!blank(fs, { ...q, c0: c, c1: c })) continue;
    let e = c;
    while (e + 1 <= q.c1 && blank(fs, { ...q, c0: e + 1, c1: e + 1 })) e++;
    runs.push([c, e]);
    c = e;
  }
  return runs;
}

type Split = { parts: Rect[]; origin: string } | null;

/** Empty columns a..b between values are a gap inside one grid, not between two blocks (gold rule R2), when a filled or
 * bordered row runs through them: on some row of r0..r1 the cells a - 1 and b + 1 hold values and every cell between is
 * formatting-only. A gap formatted on most rows beside it is a frame or shading column, which separates as before. */
function bridgedByStyle(fs: FeatureSheet, r0: number, r1: number, a: number, b: number): boolean {
  let beside = 0,
    through = 0,
    bridge = false;
  for (let r = r0; r <= r1; r++) {
    const left = fs.vt[gi(fs, r, a - 1)],
      right = fs.vt[gi(fs, r, b + 1)];
    if (!left && !right) continue;
    beside++;
    let styled = true;
    for (let c = a; c <= b && styled; c++)
      styled = ((fs.flags[gi(fs, r, c)] ?? 0) & FL.styled) !== 0;
    if (!styled) continue;
    through++;
    if (left && right) bridge = true;
  }
  return bridge && through * 2 < beside;
}

/** Cells (r, cl) and (r, cr) lie in two different merges, each anchored on a value. */
function betweenMerges(fs: FeatureSheet, r: number, cl: number, cr: number): boolean {
  const owner = (c: number) =>
    fs.merges.find(
      (m) =>
        m.r0 <= r &&
        r <= m.r1 &&
        m.c0 <= c &&
        c <= m.c1 &&
        countIn(fs, { r0: m.r0, c0: m.c0, r1: m.r0, c1: m.c0 }) > 0,
    );
  const left = owner(cl),
    right = owner(cr);
  return !!left && !!right && left !== right;
}

function splitAtBlanks(fs: FeatureSheet, q: Rect, cfg: DetectConfig): Split {
  for (const [a, b] of emptyRowRuns(fs, q)) {
    const above = tighten(fs, { ...q, r1: a - 1 }),
      below = tighten(fs, { ...q, r0: b + 1 });
    if (!above || !below) continue;
    const why = cutAcrossBlankRows(fs, above, below, cfg);
    if (why) return { parts: [above, below], origin: `blank-cut:${why}` };
  }
  for (const [a, b] of emptyColRuns(fs, q)) {
    const left = tighten(fs, { ...q, c1: a - 1 }),
      right = tighten(fs, { ...q, c0: b + 1 });
    if (!left || !right) continue;
    if (bridgedByStyle(fs, q.r0, q.r1, a, b)) continue;
    // a single-row block (a peeled title / kpi line) is only cut by a gap of lineGapSplit+ empty columns, unless the gap
    // lies between two different merged boxes: each merge is its own object on screen (e.g. titles of side-by-side tables)
    if (q.r0 === q.r1 && b - a + 1 < cfg.lineGapSplit && !betweenMerges(fs, q.r0, a - 1, b + 1))
      continue;
    const why = b > a ? "wide-col-gap" : cutAcrossBlankCols(fs, left, right, q, cfg);
    if (why) return { parts: [left, right], origin: `blank-cut:${why}` };
  }
  return null;
}

/** At least half of row r's values are numbers or dates sitting in columns whose dominant value type over the rows
 * above (inside q) is the same: the row continues the body. A minority of such cells can belong to a neighbouring table
 * glued into the same block, so one matching cell is not enough. Directly under the block's first row (its header) there
 * is no body above yet, so the rows below decide. */
function holdsColumnValues(fs: FeatureSheet, q: Rect, r: number): boolean {
  const types = r === q.r0 + 1 ? columnTypes(fs, q, r + 1, q.r1) : columnTypes(fs, q, q.r0, r - 1);
  let values = 0,
    matching = 0;
  for (let c = q.c0; c <= q.c1; c++) {
    const t = fs.vt[gi(fs, r, c)];
    if (!t) continue;
    values++;
    if ((t === VT.num || t === VT.date) && types[c - q.c0] === t) matching++;
  }
  return values > 0 && matching * 2 >= values;
}

/** S2: header-like emphasised row directly below body rows with a style change; the strongest such boundary wins. */
function splitAtStyleChange(fs: FeatureSheet, q: Rect, cfg: DetectConfig): Split {
  let best: { r: number; delta: number } | null = null;
  for (let r = q.r0 + 1; r < q.r1; r++) {
    const cur = rs(fs, q, r),
      prev = rs(fs, q, r - 1),
      next = rs(fs, q, r + 1);
    if (headerScore(cur) < cfg.headerScoreMin || emphasisShare(cur) < 0.5) continue;
    // a plain header-like row above means the block already has its header: later emphasised rows are body
    if (headerScore(prev) >= cfg.headerScoreMin && emphasisShare(prev) < 0.5) continue;
    const delta = signatureDelta(cur, prev);
    if (delta < cfg.styleCutDelta) continue;
    // a header line differs from the row below it too: when the next row continues this row's look, this row starts a
    // styled body run (filled, bordered records) or a multi-row header, not a new table
    if (headerScore(next) >= cfg.headerScoreMin && signatureDelta(cur, next) < cfg.styleCutDelta)
      continue;
    // a header row labels columns; a row that puts a number or date into a column whose rows above hold that same kind
    // of value is a body row with emphasis (a subtotal, a zebra stripe), not the header of a new table
    if (holdsColumnValues(fs, q, r)) continue;
    if (!best || delta > best.delta) best = { r, delta };
  }
  if (!best) return null;
  const above = tighten(fs, { ...q, r1: best.r - 1 }),
    below = tighten(fs, { ...q, r0: best.r });
  return above && below ? { parts: [above, below], origin: "style-cut" } : null;
}

/** S3: preamble rows (title / kpi lines above the header row) and trailing note lines become their own blocks. */
function peel(fs: FeatureSheet, q: Rect, cfg: DetectConfig): Split {
  const rows = q.r1 - q.r0 + 1;
  if (rows < 2) return null;
  // header row = first header-like row within the preamble window whose preceding rows are all non-header
  let h = -1;
  for (let r = q.r0; r <= Math.min(q.r1 - 1, q.r0 + cfg.maxPreambleRows); r++) {
    if (isHeaderRow(fs, q, r, cfg)) {
      h = r;
      break;
    }
  }
  // every row above the header row must be sparse (title / kpi line), otherwise it is body and there is no preamble
  const sparsePreamble =
    h > q.r0 &&
    Array.from({ length: h - q.r0 }, (_, k) => rs(fs, q, q.r0 + k)).every(
      (s) => s.n / s.width <= cfg.preambleMaxShare,
    );
  if (sparsePreamble) {
    // rows above the header row: stacked single-cell lines form one block, any other row is its own block
    const parts: Rect[] = [];
    let group: Rect | null = null;
    let groupSingle = false;
    for (let r = q.r0; r < h; r++) {
      const line = tighten(fs, { ...q, r0: r, r1: r });
      if (!line) continue;
      const single = countIn(fs, line) === 1;
      if (group && groupSingle && single)
        group = {
          r0: group.r0,
          c0: Math.min(group.c0, line.c0),
          r1: line.r1,
          c1: Math.max(group.c1, line.c1),
        };
      else {
        if (group) parts.push(group);
        group = line;
        groupSingle = single;
      }
    }
    if (group) parts.push(group);
    const body = tighten(fs, { ...q, r0: h });
    if (body) return { parts: [...parts, body], origin: "peel-preamble" };
  }
  // trailing note: a single long text cell under a wider body
  const last = rs(fs, q, q.r1);
  if (rows >= 3 && last.n === 1 && last.text === 1) {
    const line = tighten(fs, { ...q, r0: q.r1 });
    const cell = line && fs.texts.get(gi(fs, line.r0, line.c0));
    if (line && cell && cell.length >= cfg.noteMinChars && rs(fs, q, q.r1 - 1).n >= 2) {
      const body = tighten(fs, { ...q, r1: q.r1 - 1 });
      if (body) return { parts: [body, line], origin: "peel-note" };
    }
  }
  return null;
}

/** S4: the top or bottom row mostly sits over columns the rest of the block leaves empty (an overhanging line / header strip).
 * Formatting-only cells occupy a column of the rest: a header over a bordered empty template body is not overhanging. */
function splitOverhang(fs: FeatureSheet, q: Rect, cfg: DetectConfig): Split {
  if (q.r1 === q.r0) return null;
  const cols = (r0: number, r1: number, styled: boolean) => {
    const out = new Set<number>();
    for (let c = q.c0; c <= q.c1; c++)
      if (
        countIn(fs, { r0, r1, c0: c, c1: c }) > 0 ||
        (styled && styledIn(fs, { r0, r1, c0: c, c1: c }) > 0)
      )
        out.add(c);
    return out;
  };
  for (const side of ["top", "bottom"] as const) {
    const line = side === "top" ? { ...q, r1: q.r0 } : { ...q, r0: q.r1 };
    const rest = side === "top" ? { ...q, r0: q.r0 + 1 } : { ...q, r1: q.r1 - 1 };
    const a = cols(line.r0, line.r1, false),
      b = cols(rest.r0, rest.r1, true);
    if (a.size < 2 || !b.size) continue; // a lone overhanging cell is a title / label, handled by peel
    const shared = [...a].filter((c) => b.has(c)).length;
    if (shared / a.size >= cfg.overhangShare) continue;
    // a header row over a sparsely filled body: every column of the rest lies under the header's span
    if (
      side === "top" &&
      isHeaderRow(fs, q, q.r0, cfg) &&
      [...b].every((c) => c >= Math.min(...a) && c <= Math.max(...a))
    )
      continue;
    const pa = tighten(fs, line),
      pb = tighten(fs, rest);
    if (pa && pb)
      return { parts: side === "top" ? [pa, pb] : [pb, pa], origin: `overhang-${side}` };
  }
  return null;
}

/** R2: grow a block over adjacent rows / columns that hold no value and are at least half formatting-only cells (its
 * border grid or fill band continues there), never into another block. The grown band must end with the region: when
 * the ring just outside a grown side is still mostly formatting-only cells, or the growth reaches STYLE_REACH (its end is
 * not visible), the formatting is sheet-wide rather than this region's and the block keeps its value extent. */
function extendOverStyle(fs: FeatureSheet, q: Rect, others: Rect[]): Rect {
  const grid = { r0: fs.r0, c0: fs.c0, r1: fs.r0 + fs.nr - 1, c1: fs.c0 + fs.nc - 1 };
  const inGrid = (x: Rect) =>
    x.r0 >= grid.r0 && x.r1 <= grid.r1 && x.c0 >= grid.c0 && x.c1 <= grid.c1;
  const hits = (a: Rect, b: Rect) => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;
  const cells = (x: Rect) => (x.r1 - x.r0 + 1) * (x.c1 - x.c0 + 1);
  let g = q;
  for (let grown = true; grown;) {
    grown = false;
    for (const strip of [
      { ...g, r0: g.r1 + 1, r1: g.r1 + 1 },
      { ...g, c0: g.c1 + 1, c1: g.c1 + 1 },
      { ...g, r0: g.r0 - 1, r1: g.r0 - 1 },
      { ...g, c0: g.c0 - 1, c1: g.c0 - 1 },
    ]) {
      if (!inGrid(strip) || countIn(fs, strip) > 0 || others.some((o) => hits(o, strip))) continue;
      if (styledIn(fs, strip) * 2 < cells(strip)) continue;
      g = {
        r0: Math.min(g.r0, strip.r0),
        c0: Math.min(g.c0, strip.c0),
        r1: Math.max(g.r1, strip.r1),
        c1: Math.max(g.c1, strip.c1),
      };
      grown = true;
      break; // the other strips were measured on the old rectangle: recompute them before growing again
    }
  }
  if (g === q) return q;
  const v = fs.valueBox;
  if (!v) return q;
  const reach = {
    r0: v.r0 - STYLE_REACH.rows,
    r1: v.r1 + STYLE_REACH.rows,
    c0: v.c0 - STYLE_REACH.cols,
    c1: v.c1 + STYLE_REACH.cols,
  };
  const sides: [boolean, boolean, Rect][] = [
    [g.r1 > q.r1, g.r1 >= reach.r1, { ...g, r0: g.r1 + 1, r1: g.r1 + 1 }],
    [g.r0 < q.r0, g.r0 <= reach.r0, { ...g, r0: g.r0 - 1, r1: g.r0 - 1 }],
    [g.c1 > q.c1, g.c1 >= reach.c1, { ...g, c0: g.c1 + 1, c1: g.c1 + 1 }],
    [g.c0 < q.c0, g.c0 <= reach.c0, { ...g, c0: g.c0 - 1, c1: g.c0 - 1 }],
  ];
  for (const [grew, atReach, ring] of sides) {
    if (!grew) continue;
    if (atReach) return q;
    if (styledIn(fs, ring) * 2 >= cells(ring)) return q; // FL.styled is only ever set on cells without a value
  }
  return g;
}

export function segment(fs: FeatureSheet, cfg: DetectConfig): Block[] {
  const queue: Block[] = components(fs, cfg.gapTolerance).map((rect) => ({ rect, origin: "cc" }));
  const out: Block[] = [];
  for (let guard = 0; queue.length && guard < 100000; guard++) {
    const b = queue.shift();
    if (!b) break;
    const split =
      splitAtBlanks(fs, b.rect, cfg) ??
      splitOverhang(fs, b.rect, cfg) ??
      splitAtStyleChange(fs, b.rect, cfg) ??
      peel(fs, b.rect, cfg);
    if (!split) {
      out.push(b);
      continue;
    }
    // re-queue the pieces in order so the output order stays deterministic
    queue.unshift(
      ...split.parts.map((rect) => ({
        rect,
        origin:
          b.origin === "cc"
            ? split.origin
            : b.origin.split(">").includes(split.origin)
              ? b.origin
              : `${b.origin}>${split.origin}`,
      })),
    );
  }
  for (const b of out) {
    const grown = extendOverStyle(
      fs,
      b.rect,
      out.filter((o) => o !== b).map((o) => o.rect),
    );
    if (
      grown.r0 !== b.rect.r0 ||
      grown.c0 !== b.rect.c0 ||
      grown.r1 !== b.rect.r1 ||
      grown.c1 !== b.rect.c1
    ) {
      b.rect = grown;
      b.origin += ">style-extend";
    }
  }
  // A region covers the merges anchored in it: a merged cell is one cell on screen (RFC 04 §4.6). The grid holds every
  // value-anchored merge, so the grown rectangle stays inside it.
  for (const b of out) {
    const others = out.filter((o) => o !== b).map((o) => o.rect);
    for (let grown = true; grown;) {
      grown = false;
      for (const m of fs.merges) {
        const q = b.rect;
        if (m.r0 < q.r0 || m.r0 > q.r1 || m.c0 < q.c0 || m.c0 > q.c1) continue; // anchor outside
        if (m.r1 <= q.r1 && m.c1 <= q.c1) continue; // already inside
        const next = { r0: q.r0, c0: q.c0, r1: Math.max(q.r1, m.r1), c1: Math.max(q.c1, m.c1) };
        if (
          others.some(
            (o) => o.r0 <= next.r1 && next.r0 <= o.r1 && o.c0 <= next.c1 && next.c0 <= o.c1,
          )
        )
          continue;
        b.rect = next;
        if (!b.origin.endsWith(">merge-extend")) b.origin += ">merge-extend";
        grown = true;
      }
    }
  }
  // A header / title / total line that the formatting now joins to a body with the same columns is one region again
  // (R1, R4). Two stacked multi-row blocks stay apart: each has its own header (R5).
  for (let merged = true; merged;) {
    merged = false;
    for (const a of out) {
      const b = out.find(
        (x) =>
          x !== a &&
          x.rect.r0 === a.rect.r1 + 1 &&
          x.rect.c0 === a.rect.c0 &&
          x.rect.c1 === a.rect.c1,
      );
      if (
        !b ||
        (a.rect.r0 !== a.rect.r1 && b.rect.r0 !== b.rect.r1) ||
        !(a.origin + b.origin).includes("style-extend")
      )
        continue;
      a.rect = { ...a.rect, r1: b.rect.r1 };
      a.origin = `${a.origin.includes("style-extend") ? a.origin : b.origin}>style-join`;
      out.splice(out.indexOf(b), 1);
      merged = true;
      break;
    }
  }
  return out.sort(
    (a, b) =>
      a.rect.r0 - b.rect.r0 ||
      a.rect.c0 - b.rect.c0 ||
      a.rect.r1 - b.rect.r1 ||
      a.rect.c1 - b.rect.c1,
  );
}
