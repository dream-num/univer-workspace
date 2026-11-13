// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/outline/model.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// OutlineModel: the full (unbudgeted) typed node tree of a workbook, built from detector D0 output plus explicit structure.
// Everything the renderer prints is computed here over the FULL range (no sampling anywhere); see README for conventions.

import { classify } from "../detect/classify.js";
import { DEFAULT_CONFIG, type DetectConfig } from "../detect/config.js";
import { detectRegions } from "../detect/detect.js";
import { tighten } from "../detect/features.js";
import { type ExplicitObject, objectRef } from "../explicit.js";
import { colName, parseArea, type Rect, rectToA1 } from "../ranges.js";
import {
  type Cell,
  COLS,
  cellAt,
  countCells,
  eachCell,
  type SheetCells,
  typeOfCell,
  type Workbook,
} from "./cells.js";
import { listItem, numfmtScale, trunc } from "./format.js";
import { relativize } from "./formula.js";
import { capList, mergesIn, spanAt } from "./merges.js";
import { assignRefs, type DetectedItem, type RegionKind } from "./refs.js";

export type NodeKind =
  | "workbook"
  | "sheet"
  | "table"
  | "matrix"
  | "form"
  | "text"
  | "kpi"
  | "block"
  | "col"
  | "axis"
  | "field"
  | "obj"
  | "objects";
export type ColType =
  | "number"
  | "percent"
  | "currency"
  | "date"
  | "time"
  | "datetime"
  | "text"
  | "bool"
  | "error"
  | "mixed"
  | "empty";
export const REGION_KINDS: NodeKind[] = ["table", "matrix", "form", "text", "kpi", "block"];

export interface OutlineNode {
  ref?: string;
  kind: NodeKind;
  name?: string;
  range?: string; // sheet-local A1 (col: just the column letter)
  via?: "table" | "filter" | "name" | "pivot" | "label";
  hidden?: boolean;
  attrs: Record<string, unknown>;
  value?: { raw: unknown; display: string };
  children?: OutlineNode[];
  /** `from`: first child that is not shown (children are shown in order, so the rest follows it); `range`: rectangle covered by the omitted regions */
  elided?: { count: number; kind: NodeKind; zoom: string; from?: string; range?: string };
}

// ---------------------------------------------------------------- typed attribute payloads
export interface TypeInfo {
  type: ColType;
  numfmt?: string; // most common pattern of the dominant family (omitted for General)
  scale?: number; // power of ten the numfmt divides by (`#,##0,` -> 3); omitted when 0
  unique?: boolean;
  mix?: { type: string; pct: number }[]; // only for 'mixed'
}
export type StatInfo =
  // `of` is set when the column is mixed: the stat then covers only that value family, not the whole column
  | {
      k: "range";
      min: { raw: number; display: string };
      max: { raw: number; display: string };
      of?: string;
    }
  | { k: "distinct"; n: number; values: string[]; more: boolean; of?: string }
  | { k: "bool"; truePct: number; of?: string };
export interface FormulaInfo {
  pattern: string; // relative form, without '='
  truncated: boolean;
  count: number;
  breaks: string[];
  breaksMore: number;
  consts: string[];
  constsMore: number;
}
export interface ColAttrs {
  type: TypeInfo;
  stat?: StatInfo;
  f?: FormulaInfo;
  fill: number; // percent of body rows holding a non-blank value, 0..100
  err?: number;
  nonBlank: number;
  rows: number;
  /** merges anchored in the header row that cover this column (full rectangles) */
  span?: string[];
  /** merges anchored in the data area that cover this column (full rectangles) */
  merges?: { items: string[]; more: number };
  /** text cells that look like numbers (`"1001"`): SUM ignores them, numeric lookups miss them */
  numtext?: number;
  /** numeric/date cells whose number format differs from the column's dominant one */
  fmts?: { items: string[]; more: number };
  /** body cells holding a value a UI does not show (empty display, font colour = fill) */
  invisible?: { items: string[]; more: number };
  /** cells of the column (header included) carrying a note or comment */
  notes?: { items: string[]; more: number };
  /** data-validation / conditional-format summaries of rules that touch the column body */
  dv?: { items: string[]; more: number };
  cf?: { items: string[]; more: number };
  /** the column is narrower than NARROW_PX: values exist but are practically invisible */
  narrow?: boolean;
}

interface Meta {
  level: number;
  rect?: Rect;
  area: number;
  explicit: boolean;
  order: number; // global row-major order
  parent?: OutlineNode;
}
const META = new WeakMap<OutlineNode, Meta>();
function setExplicit(node: OutlineNode): void {
  const meta = META.get(node);
  if (meta) meta.explicit = true;
}
/** Records `parent` in the meta of `node`. */
function setParent(node: OutlineNode, parent: OutlineNode): void {
  const meta = META.get(node);
  if (meta) meta.parent = parent;
}
export const metaOf = (n: OutlineNode): Meta =>
  META.get(n) ?? { level: 0, area: 0, explicit: false, order: 0 };

export interface OutlineModel {
  root: OutlineNode;
  wb: Workbook;
  /** ref -> node (workbook 'wb', sheets, regions, children) */
  byRef: Map<string, OutlineNode>;
  /** ref -> sheet index / rect, for read() */
  rectOf: Map<string, { sheet: number; rect: Rect }>;
  notes: string[];
}

const area = (q: Rect) => (q.r1 - q.r0 + 1) * (q.c1 - q.c0 + 1);
const inside = (a: Rect, b: Rect) => a.r0 >= b.r0 && a.r1 <= b.r1 && a.c0 >= b.c0 && a.c1 <= b.c1;
export const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((100 * n) / d));
const addr = (r: number, c: number) => rectToA1({ r0: r, c0: c, r1: r, c1: c });

// ---------------------------------------------------------------- cell-set profiling (columns, axes, kpi/field cells)
type Family = "numeric" | "date" | "text" | "bool";
const familyOf = (cell: Cell): Family =>
  cell.cls === "num"
    ? "numeric"
    : cell.cls === "date"
      ? "date"
      : cell.cls === "bool"
        ? "bool"
        : "text";

export interface Profile {
  type: TypeInfo;
  stat?: StatInfo;
  nonBlank: number;
  err: number;
}

/** Type + statistics of a set of cells (blank cells must already be filtered out). */
export function profileCells(cells: Cell[]): Profile {
  const errs = cells.filter((c) => c.cls === "error").length;
  const live = cells.filter((c) => c.cls !== "error");
  if (!live.length)
    return { type: { type: errs ? "error" : "empty" }, nonBlank: cells.length, err: errs };
  const fam = new Map<Family, Cell[]>();
  for (const c of live) {
    const f = familyOf(c);
    const list = fam.get(f);
    if (list) list.push(c);
    else fam.set(f, [c]);
  }
  const order: Family[] = ["numeric", "date", "text", "bool"];
  const fams = [...fam.entries()].sort(
    (a, b) => b[1].length - a[1].length || order.indexOf(a[0]) - order.indexOf(b[0]),
  );
  const dominant = fams[0];
  if (!dominant) return { type: { type: "empty" }, nonBlank: cells.length, err: errs };
  const [domFam, domCells] = dominant;
  // dominant subtype word (percent / currency / date / ...) and dominant pattern inside the dominant family
  const subtype = (list: Cell[]): string => {
    const m = new Map<string, number>();
    for (const c of list) m.set(typeOfCell(c), (m.get(typeOfCell(c)) ?? 0) + 1);
    return (
      [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "number"
    );
  };
  const dominantPattern = (list: Cell[]): string | undefined => {
    const m = new Map<string, number>();
    for (const c of list) m.set(c.pattern ?? "General", (m.get(c.pattern ?? "General") ?? 0) + 1);
    const best =
      [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "General";
    return /^general$/i.test(best) ? undefined : best;
  };
  const type: TypeInfo = { type: (fams.length > 1 ? "mixed" : subtype(domCells)) as ColType };
  if (fams.length > 1)
    type.mix = fams
      .slice(0, 3)
      .map(([, l]) => ({ type: subtype(l), pct: pct(l.length, live.length) }));
  const statOn = fams.length === 1 || domCells.length / live.length >= 0.5;
  let stat: StatInfo | undefined;
  if (domFam === "numeric" || domFam === "date") {
    const pattern = dominantPattern(domCells);
    if (pattern && statOn) {
      type.numfmt = pattern;
      const scale = numfmtScale(pattern);
      if (scale) type.scale = scale;
    }
    if (!statOn) {
      // no stat for a mixed column whose dominant family is below 50%
    } else {
      let min = Infinity;
      let max = -Infinity;
      for (const c of domCells) {
        const v = c.v as number;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const show = (v: number) => domCells.find((c) => c.v === v)?.text ?? String(v);
      stat = {
        k: "range",
        min: { raw: min, display: show(min) },
        max: { raw: max, display: show(max) },
      };
      if (fams.length > 1) stat.of = subtype(domCells);
      if (
        fams.length === 1 &&
        errs === 0 &&
        domCells.length >= 3 &&
        new Set(domCells.map((c: Cell) => c.v)).size === domCells.length
      )
        type.unique = true;
    }
  } else if (domFam === "text" && statOn) {
    const freq = new Map<string, number>();
    for (const c of domCells) freq.set(c.v as string, (freq.get(c.v as string) ?? 0) + 1);
    const ranked = [...freq.entries()]
      .map(([v, n], i) => ({ v, n, i }))
      .sort((a, b) => b.n - a.n || a.i - b.i);
    if (fams.length === 1 && errs === 0 && freq.size === domCells.length && domCells.length > 5)
      type.unique = true;
    else {
      stat = {
        k: "distinct",
        n: freq.size,
        values: ranked.slice(0, freq.size <= 5 ? 5 : 3).map((x) => x.v),
        more: freq.size > 5,
      };
      if (fams.length > 1) stat.of = "text";
    }
  } else if (domFam === "bool" && statOn) {
    stat = {
      k: "bool",
      truePct: pct(domCells.filter((c) => c.v === true).length, domCells.length),
    };
    if (fams.length > 1) stat.of = "bool";
  }
  return { type, ...(stat ? { stat } : {}), nonBlank: cells.length, err: errs };
}

/** Column profile over body rows [r0, r1] of column c, including the formula pattern analysis (spec 4.5). */
function profileColumn(sc: SheetCells, c: number, r0: number, r1: number): ColAttrs {
  const rows = r1 - r0 + 1;
  const live: Cell[] = [];
  const formulas: { cell: Cell; pat: string }[] = [];
  const consts: Cell[] = [];
  for (let r = r0; r <= r1; r++) {
    const cell = cellAt(sc, r, c);
    if (!cell) continue;
    if (!cell.blank) live.push(cell);
    if (cell.formula !== undefined) formulas.push({ cell, pat: relativize(cell.formula, r) });
    else if (!cell.blank) consts.push(cell);
  }
  const prof = profileCells(live);
  const out: ColAttrs = { type: prof.type, fill: 100, nonBlank: live.length, rows };
  const numtext = live.filter((x) => x.cls === "text" && NUMERIC_TEXT.test(String(x.v))).length;
  if (numtext) out.numtext = numtext;
  const numeric = live.filter((x) => x.cls === "num" || x.cls === "date");
  const mainFmt = prof.type.numfmt ?? "General";
  const fmts =
    prof.stat?.k === "range"
      ? numeric.filter((x) => (x.pattern ?? "General") !== mainFmt).map((x) => addr(x.r, x.c))
      : [];
  if (fmts.length) out.fmts = capList(fmts, 5);
  const invisible = live.filter((x) => x.invisible).map((x) => addr(x.r, x.c));
  if (invisible.length) out.invisible = capList(invisible, 5);
  if (prof.stat) out.stat = prof.stat;
  if (live.length < rows)
    out.fill = live.length === 0 ? 0 : Math.min(99, Math.max(1, pct(live.length, rows)));
  if (prof.err) out.err = prof.err;
  if (formulas.length) {
    const freq = new Map<string, { n: number; i: number }>();
    formulas.forEach((f, i) => {
      const e = freq.get(f.pat);
      if (e) e.n++;
      else freq.set(f.pat, { n: 1, i });
    });
    const main = [...freq.entries()].sort((a, b) => b[1].n - a[1].n || a[1].i - b[1].i)[0] as [
      string,
      { n: number; i: number },
    ];
    const breaks = formulas.filter((f) => f.pat !== main[0]).map((f) => addr(f.cell.r, f.cell.c));
    const population = live.length + formulas.filter((f) => f.cell.blank).length;
    const mostlyFormulas = formulas.length * 2 >= population;
    const constList = mostlyFormulas ? consts.map((x) => addr(x.r, x.c)) : [];
    const CAP = 5;
    out.f = {
      pattern: trunc(main[0], 60),
      truncated: Array.from(main[0]).length > 60,
      count: main[1].n,
      breaks: breaks.slice(0, CAP),
      breaksMore: Math.max(0, breaks.length - CAP),
      consts: constList.slice(0, CAP),
      constsMore: Math.max(0, constList.length - CAP),
    };
  }
  return out;
}

// ---------------------------------------------------------------- region helpers
const TOTAL_RE = /^\s*(?:(grand\s+|sub\s*-?\s*)?(total|totals|sum)\b|合计|总计|小计)/i;
const NUMERIC_TEXT = /^\s*[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?\s*$|^\s*[-+]?\.\d+\s*$/;
const AGG_RE = /^(SUBTOTAL|AGGREGATE)\(/i;

/** `SUM(C2:C7)` in column C at a row below 7: an aggregate of the same column above the cell. */
function sumsAbove(cell: Cell): boolean {
  const m = /^SUM\(\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\)$/i.exec(cell.formula ?? "");
  return (
    !!m &&
    m[1]?.toUpperCase() === m[3]?.toUpperCase() &&
    m[1]?.toUpperCase() === colName(cell.c) &&
    Number(m[4]) <= cell.r
  );
}

/** Body rows that summarize rows above them (spec 4.9): a total label in the first cell, SUBTOTAL/AGGREGATE, or a same-column SUM above.
 *  When more than half of the body qualifies the pattern is a running total, not subtotals, and nothing is reported. */
function subtotalRows(sc: SheetCells, rect: Rect, bodyTop: number, bodyEnd: number): number[] {
  const rows: number[] = [];
  for (let r = bodyTop; r <= bodyEnd; r++) {
    const row = (sc.byRow.get(r) ?? []).filter((x) => x.c >= rect.c0 && x.c <= rect.c1);
    const first = row.find((x) => !x.blank);
    if (
      (first?.cls === "text" && TOTAL_RE.test(String(first.v))) ||
      row.some((x) => x.formula !== undefined && (AGG_RE.test(x.formula) || sumsAbove(x)))
    )
      rows.push(r);
  }
  return rows.length * 2 > bodyEnd - bodyTop + 1 ? [] : rows;
}

const inRect = (q: Rect, r: number, c: number) => r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1;
const intersects = (a: Rect, b: Rect) =>
  a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0;

/** Cells of `q` carrying a note or comment, row-major. */
function notesIn(sc: SheetCells, q: Rect): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  for (const k of sc.notes.keys()) {
    const r = Math.floor(k / COLS),
      c = k % COLS;
    if (inRect(q, r, c)) out.push({ r, c });
  }
  return out.sort((a, b) => a.r - b.r || a.c - b.c);
}

/** Groups intersecting `q` as full ranges: rows `4:5`, columns `F:G`; a trailing `+` marks a collapsed group. */
function groupsIn(sc: SheetCells, q: Rect): string[] {
  return sc.groups
    .filter((g) =>
      g.axis === "row" ? g.start <= q.r1 && g.end >= q.r0 : g.start <= q.c1 && g.end >= q.c0,
    )
    .map(
      (g) =>
        (g.axis === "row"
          ? `${g.start + 1}:${g.end + 1}`
          : `${colName(g.start)}:${colName(g.end)}`) + (g.collapsed ? "+" : ""),
    );
}

function totalsRowOf(sc: SheetCells, rect: Rect, bodyTop: number): number | null {
  if (rect.r1 - bodyTop < 2) return null; // need at least two body rows besides the totals row
  const first = (sc.byRow.get(rect.r1) ?? []).find(
    (c) => !c.blank && c.c >= rect.c0 && c.c <= rect.c1,
  );
  return first && first.cls === "text" && TOTAL_RE.test(String(first.v)) ? rect.r1 : null;
}

const cleanLabel = (s: string): string => s.replace(/\s*[:：]\s*$/, "");

function cellsIn(sc: SheetCells, q: Rect): Cell[] {
  const out: Cell[] = [];
  eachCell(sc, q, (c) => out.push(c));
  return out;
}

interface FieldPair {
  label: Cell;
  value?: Cell | undefined;
}
export function formFields(sc: SheetCells, rect: Rect, why: string): FieldPair[] {
  const out: FieldPair[] = [];
  if (why.includes("header-over-value-row") && rect.r1 - rect.r0 === 1) {
    for (let c = rect.c0; c <= rect.c1; c++) {
      const label = cellAt(sc, rect.r0, c);
      if (!label || label.blank) continue;
      const v = cellAt(sc, rect.r1, c);
      out.push({ label, value: v && !v.blank ? v : undefined });
    }
    return out;
  }
  for (let r = rect.r0; r <= rect.r1; r++) {
    const row = (sc.byRow.get(r) ?? []).filter((c) => !c.blank && c.c >= rect.c0 && c.c <= rect.c1);
    const [label, value] = row;
    if (label) out.push({ label, value });
  }
  return out;
}

function typeAttrFor(cell: Cell): TypeInfo {
  const p = profileCells([cell]);
  return p.type;
}

interface BuildCtx {
  sc: SheetCells;
  objects: ExplicitObject[];
  cfg: DetectConfig;
  order: { n: number };
}

function setMeta(node: OutlineNode, meta: Partial<Meta> & { level: number }, ctx: BuildCtx): void {
  META.set(node, { area: 0, explicit: false, order: ctx.order.n++, ...meta });
}

export interface Built {
  node: OutlineNode;
  item: DetectedItem;
  childNodes: OutlineNode[];
}

/** Every row, or every column, of the rectangle is hidden. */
function hiddenAllOf(sc: SheetCells, rect: Rect): boolean {
  let rows = true;
  for (let r = rect.r0; r <= rect.r1 && rows; r++) if (!sc.hiddenRows.has(r)) rows = false;
  if (rows) return true;
  for (let c = rect.c0; c <= rect.c1; c++) if (!sc.hiddenCols.has(c)) return false;
  return true;
}

function buildRegion(
  ctx: BuildCtx,
  rect: Rect,
  d0kind: string,
  why: string,
  headerRows: number,
): Built {
  const { sc } = ctx;
  const nonBlank = countCells(sc, rect);
  const range = rectToA1(rect);
  const base = { range, attrs: {} as Record<string, unknown> };
  const hiddenAll = hiddenAllOf(sc, rect);
  const done = (node: OutlineNode, childNodes: OutlineNode[] = []): Built => {
    if (hiddenAll) node.hidden = true;
    if (node.kind !== "text" && node.kind !== "kpi") {
      const count = (set: Set<number>, lo: number, hi: number) =>
        [...set].filter((x) => x >= lo && x <= hi).length;
      const filtered = count(sc.filteredRows, rect.r0, rect.r1);
      if (filtered) node.attrs.filtered = filtered;
      if (!hiddenAll) {
        const hrows = count(sc.hiddenRows, rect.r0, rect.r1);
        if (hrows) node.attrs.hrows = hrows;
        const hcols = node.kind === "table" ? 0 : count(sc.hiddenCols, rect.c0, rect.c1);
        if (hcols) node.attrs.hcols = hcols;
      }
      const merged = mergesIn(sc, rect).length;
      if (merged) node.attrs.merged = merged;
      const groups = groupsIn(sc, rect);
      if (groups.length) node.attrs.groups = capList(groups, 5);
    }
    if (node.kind !== "table") {
      const notes = notesIn(sc, rect).length;
      if (notes) node.attrs.notes = notes;
    }
    setMeta(node, { level: 1, rect, area: area(rect) }, ctx);
    for (const ch of childNodes)
      setMeta(
        ch,
        {
          level: 2,
          rect:
            ch.kind === "col"
              ? {
                  ...rect,
                  c0: (ch as { _c?: number })._c ?? rect.c0,
                  c1: (ch as { _c?: number })._c ?? rect.c0,
                }
              : rect,
          area: 0,
        },
        ctx,
      );
    node.children = childNodes;
    return { node, item: { rect, kind: node.kind as RegionKind }, childNodes };
  };

  if (!nonBlank || d0kind === "block") return done({ kind: "block", ...base });
  if (d0kind === "text") {
    const text = cellsIn(sc, rect)
      .map((c) => c.text)
      .join(" | ");
    const span = spanAt(sc, rect.r0, rect.c0);
    if (span) base.attrs.span = [span];
    return done({ kind: "text", name: text, ...base });
  }
  if (d0kind === "other") {
    const only = cellsIn(sc, rect)[0];
    if (nonBlank === 1 && only) {
      const cell = only;
      const kpiSpan = spanAt(sc, cell.r, cell.c);
      const node: OutlineNode = {
        kind: "kpi",
        range: addr(cell.r, cell.c),
        attrs: {
          type: typeAttrFor(cell),
          ...(cell.formula !== undefined ? { f: cell.formula } : {}),
          ...(kpiSpan ? { span: [kpiSpan] } : {}),
        },
        value: { raw: cell.v, display: cell.text },
      };
      if (!(rect.r0 === rect.r1 && rect.c0 === rect.c1)) {
        // a merged cell whose range exceeds the cell: keep the detector's range, it is the honest extent
        node.range = range;
      }
      return done(node);
    }
    return done({ kind: "block", ...base });
  }
  if (d0kind === "form") {
    const fields = formFields(sc, rect, why);
    const nodes = fields.map((f): OutlineNode => {
      const cell = f.value ?? f.label;
      const node: OutlineNode = {
        kind: "field",
        name: cleanLabel(f.label.text),
        range: addr(cell.r, cell.c),
        attrs: {},
      };
      const fieldSpan = spanAt(sc, cell.r, cell.c);
      if (f.value) {
        node.attrs = {
          type: typeAttrFor(f.value),
          ...(f.value.formula !== undefined ? { f: f.value.formula } : {}),
        };
        node.value = { raw: f.value.v, display: f.value.text };
      } else node.attrs = { type: typeAttrFor(f.label) };
      if (fieldSpan) node.attrs.span = [fieldSpan];
      return node;
    });
    return done({ kind: "form", ...base, attrs: { fields: fields.length } }, nodes);
  }
  if (d0kind === "matrix") {
    const rowLbl = cellAt(sc, rect.r0, rect.c0);
    const label = rowLbl && !rowLbl.blank ? rowLbl.text : "";
    const hdr = cellsIn(sc, { ...rect, r1: rect.r0, c0: rect.c0 + 1 });
    const labels = cellsIn(sc, { ...rect, r0: rect.r0 + 1, c1: rect.c0 });
    const body = cellsIn(sc, { ...rect, r0: rect.r0 + 1, c0: rect.c0 + 1 });
    const axisVals = (cells: Cell[]) => {
      const items = cells.map((c) => c.text);
      return {
        n: items.length,
        values: items.length <= 5 ? items : items.slice(0, 3),
        more: items.length > 5,
      };
    };
    const mk = (role: "rows" | "cols", cells: Cell[], r: Rect): OutlineNode => ({
      kind: "axis",
      name: role,
      range: rectToA1(r),
      attrs: { type: profileCells(cells).type, ...axisVals(cells) },
    });
    const rowsAxis = mk("rows", labels, { ...rect, r0: rect.r0 + 1, c1: rect.c0 });
    const colsAxis = mk("cols", hdr, { ...rect, r1: rect.r0, c0: rect.c0 + 1 });
    const nCols = rect.c1 - rect.c0;
    const colsSummary =
      hdr.length === nCols && nCols <= 3
        ? hdr.map((c) => listItem(c.text)).join("|")
        : `${listItem(hdr[0]?.text ?? "")}..${listItem(hdr[hdr.length - 1]?.text ?? "")}`;
    return done(
      {
        kind: "matrix",
        ...base,
        attrs: {
          rows: { label: label || undefined, n: rect.r1 - rect.r0 },
          cols: colsSummary,
          valueType: profileCells(body).type,
        },
      },
      [rowsAxis, colsAxis],
    );
  }
  // table
  const bodyTop = rect.r0 + headerRows;
  const totals = totalsRowOf(sc, rect, bodyTop);
  const bodyEnd = totals !== null ? rect.r1 - 1 : rect.r1;
  const attrs: Record<string, unknown> = { rows: Math.max(0, bodyEnd - bodyTop + 1) };
  if (headerRows !== 1) attrs.header = headerRows;
  if (totals !== null) attrs.totals = totals + 1;
  const subtotals = subtotalRows(sc, rect, bodyTop, bodyEnd).map((r) => addr(r, rect.c0));
  if (subtotals.length) attrs.subtotals = capList(subtotals, 5);
  const cols: OutlineNode[] = [];
  const tableMerges = mergesIn(sc, rect);
  for (let c = rect.c0; c <= rect.c1; c++) {
    const h = headerRows ? cellAt(sc, rect.r0, c) : undefined;
    const name = h && !h.blank ? h.text : undefined;
    const col: OutlineNode & { _c?: number } = {
      kind: "col",
      range: rectToA1({ r0: 0, c0: c, r1: 0, c1: c }).replace(/\d+/g, ""),
      attrs: profileColumn(sc, c, bodyTop, bodyEnd) as unknown as Record<string, unknown>,
    };
    if (name !== undefined) col.name = name;
    // a merge belongs to the column section where its anchor sits: header row(s) -> span, data area -> merges
    const covering = tableMerges.filter((m) => m.c0 <= c && m.c1 >= c);
    const span = covering.filter((m) => m.r0 >= rect.r0 && m.r0 < bodyTop).map(rectToA1);
    const inBody = covering.filter((m) => m.r0 >= bodyTop && m.r0 <= rect.r1).map(rectToA1);
    const colAttrs = col.attrs as unknown as ColAttrs;
    if (span.length) colAttrs.span = span;
    if (inBody.length) colAttrs.merges = capList(inBody, 5);
    const notes = notesIn(sc, { ...rect, c0: c, c1: c }).map((x) => addr(x.r, x.c));
    if (notes.length) colAttrs.notes = capList(notes, 5);
    const body = { r0: bodyTop, r1: bodyEnd, c0: c, c1: c };
    for (const type of ["dv", "cf"] as const) {
      const rules = ctx.objects
        .filter((o) => o.type === type && o.ranges.some((q) => intersects(q, body)))
        .map((o) => o.summary);
      if (rules.length) colAttrs[type] = capList(rules, 1);
    }
    if (sc.narrowCols.has(c)) colAttrs.narrow = true;
    if (sc.hiddenCols.has(c) && !hiddenAllOf(sc, rect)) col.hidden = true;
    col._c = c;
    cols.push(col);
  }
  return done({ kind: "table", ...base, attrs }, cols);
}

// ---------------------------------------------------------------- sheet / workbook
const VIA_OF: Record<string, OutlineNode["via"]> = {
  table: "table",
  autofilter: "filter",
  definedName: "name",
  pivot: "pivot",
  label: "label",
};
const VIA_ORDER = ["label", "table", "autofilter", "definedName", "pivot"];

export interface BuildOptions {
  cfg?: DetectConfig;
  /** Formula cells without a stored result, per sheet id, counted before the workbook was calculated. */
  uncached?: Record<string, number>;
}

export function buildOutlineModel(wb: Workbook, opts: BuildOptions = {}): OutlineModel {
  const cfg = opts.cfg ?? DEFAULT_CONFIG;
  const order = { n: 0 };
  const notes: string[] = [];
  const perSheet: {
    sc: SheetCells;
    node: OutlineNode;
    built: Built[];
    objs: OutlineNode[];
    regionsOnly: OutlineNode[];
  }[] = [];

  for (const sc of wb.sheets) {
    const st = wb.structure?.sheets.find((s) => s.id === sc.id);
    const ctx: BuildCtx = { sc, objects: st?.objects ?? [], cfg, order };
    const det = sc.fs.tooLarge ? { regions: [], notes: [] } : detectRegions(sc.fs, cfg);
    for (const n of det.notes) notes.push(`${sc.name}: ${n}`);
    const built: Built[] = [];
    const sheetNode: OutlineNode = { kind: "sheet", name: sc.name, attrs: {} };
    setMeta(sheetNode, { level: 0 }, ctx);
    if (sc.used) sheetNode.attrs.used = rectToA1(sc.used);
    if (sc.frozen) sheetNode.attrs.frozen = sc.frozen;
    const formulas = [...sc.cells.values()].filter((c) => c.formula !== undefined);
    if (formulas.length) sheetNode.attrs.formulas = formulas.length;
    const uncached = opts.uncached?.[sc.id] ?? 0;
    if (uncached) sheetNode.attrs.uncached = uncached;
    const errors = [...sc.cells.values()].filter((c) => c.cls === "error").length; // constant errors count too (#108)
    if (errors) sheetNode.attrs.errors = errors;
    if (sc.hidden) sheetNode.hidden = true;

    const items = det.regions
      .map((r) => ({ r, rect: r.rect }))
      .sort((a, b) => a.rect.r0 - b.rect.r0 || a.rect.c0 - b.rect.c0);
    for (const { r } of items) {
      const cl = classify(sc.fs, r.rect, cfg);
      built.push(buildRegion(ctx, r.rect, r.kind, r.why, cl.headerRows));
    }
    if (!built.length && sc.used) {
      // detector refused the sheet (size guard): one honest block over the used range
      built.push(buildRegion(ctx, sc.used, "other", "skipped", 0));
      const only = built[0];
      if (only?.node.kind === "kpi") only.node.kind = "block";
      if (sc.fs.tooLarge) notes.push(`sheet s${sc.index + 1} too large: rendered as one block`);
    }

    const objs: OutlineNode[] = [];
    if (st && !sc.fs.tooLarge) {
      const explicit = [...st.regions].sort(
        (a, b) => VIA_ORDER.indexOf(a.kind) - VIA_ORDER.indexOf(b.kind),
      );
      const accepted: Rect[] = [];
      for (const region of explicit) {
        const rect = parseArea(region.range);
        if (
          !rect ||
          accepted.some(
            (q) => q.r0 <= rect.r1 && q.r1 >= rect.r0 && q.c0 <= rect.c1 && q.c1 >= rect.c0,
          )
        )
          continue;
        accepted.push(rect);
        for (let i = built.length - 1; i >= 0; i--) {
          const q = built[i]?.item.rect;
          if (!q) continue;
          if (q.r0 <= rect.r1 && q.r1 >= rect.r0 && q.c0 <= rect.c1 && q.c1 >= rect.c0) {
            built.splice(i, 1);
            const strips = [
              { ...q, r1: Math.min(q.r1, rect.r0 - 1) },
              { ...q, r0: Math.max(q.r0, rect.r1 + 1) },
              {
                r0: Math.max(q.r0, rect.r0),
                r1: Math.min(q.r1, rect.r1),
                c0: q.c0,
                c1: rect.c0 - 1,
              },
              {
                r0: Math.max(q.r0, rect.r0),
                r1: Math.min(q.r1, rect.r1),
                c0: rect.c1 + 1,
                c1: q.c1,
              },
            ];
            for (const strip of strips) {
              if (strip.r0 > strip.r1 || strip.c0 > strip.c1) continue;
              const rest = tighten(sc.fs, strip);
              if (!rest) continue;
              const c = classify(sc.fs, rest, cfg);
              built.push(buildRegion(ctx, rest, c.kind, c.why, c.headerRows));
            }
          }
        }
        const inferred = classify(sc.fs, rect, cfg);
        const kind = region.regionKind ?? (region.kind === "definedName" ? inferred.kind : "table");
        const b = buildRegion(
          ctx,
          rect,
          kind === "kpi" ? "other" : kind,
          inferred.why,
          region.headerRows ?? (region.kind === "definedName" ? inferred.headerRows : 1),
        );
        const via = VIA_OF[region.kind];
        if (via) b.node.via = via;
        if (
          region.headerRows !== undefined ||
          ["table", "autofilter", "pivot"].includes(region.kind)
        )
          b.node.attrs.headerSource = via;
        if (region.name !== undefined) b.node.name = region.name;
        if (region.kind === "autofilter")
          b.node.attrs.filter = sc.filter?.criteria.length ? sc.filter.criteria : true;
        setExplicit(b.node);
        built.push(b);
      }
      built.sort((a, b) => a.item.rect.r0 - b.item.rect.r0 || a.item.rect.c0 - b.item.rect.c0);
    }
    const objectOrder = ["table", "filter", "name", "cf", "dv", "chart", "image", "shape", "pivot"];
    const objects = [...(st?.objects ?? [])].sort(
      (a, b) =>
        objectOrder.indexOf(a.type) - objectOrder.indexOf(b.type) ||
        (a.ranges[0]?.r0 ?? Infinity) - (b.ranges[0]?.r0 ?? Infinity) ||
        (a.ranges[0]?.c0 ?? Infinity) - (b.ranges[0]?.c0 ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
    for (const obj of objects) {
      const rect = obj.ranges.length === 1 ? obj.ranges[0] : undefined;
      const o: OutlineNode = {
        kind: "obj",
        ref: objectRef(obj.type, obj.id, obj.scope),
        attrs: {
          objtype: obj.type,
          summary: obj.summary,
          cellRanges: obj.ranges.map(rectToA1),
          ...(obj.source ? { source: obj.source } : {}),
        },
      };
      if (rect) o.range = rectToA1(rect);
      setMeta(o, { level: 2, ...(rect ? { rect } : {}) }, ctx);
      objs.push(o);
    }
    const counts: [string, number][] = [
      "table",
      "filter",
      "pivot",
      "cf",
      "name",
      "dv",
      "chart",
      "image",
      "shape",
    ].map((type) => [type, (st?.objects ?? []).filter((o) => o.type === type).length]);
    counts.push(
      ["note", sc.notes.size],
      ["merged", sc.merges.length],
      ["groups", sc.groups.length],
      ["hrows", sc.hiddenRows.size],
      ["frows", sc.filteredRows.size],
      ["hcols", sc.hiddenCols.size],
    );
    const list = counts.filter(([, n]) => n > 0);
    if (list.length) {
      const on: OutlineNode = { kind: "objects", attrs: { counts: list } };
      setMeta(on, { level: 1, explicit: true, area: Number.MAX_SAFE_INTEGER }, ctx);
      sheetNode.children = [on];
    }
    perSheet.push({ sc, node: sheetNode, built, objs, regionsOnly: built.map((b) => b.node) });
  }

  // ---- refs
  const rec = assignRefs(
    perSheet.map((p) => ({
      regions: p.built.map((b) => b.item),
      childCounts: p.built.map((b) => b.childNodes.length),
    })),
  );
  const byRef = new Map<string, OutlineNode>();
  const rectOf = new Map<string, { sheet: number; rect: Rect }>();
  const root: OutlineNode = {
    kind: "workbook",
    name: wb.name,
    attrs: { sheets: wb.sheets.length },
    children: [],
  };
  META.set(root, { level: 0, area: 0, explicit: false, order: -1 });
  byRef.set("wb", root);

  perSheet.forEach((p, si) => {
    const sref = rec.sheetRefs[si] as string;
    p.node.ref = sref;
    byRef.set(sref, p.node);
    if (p.sc.used) rectOf.set(sref, { sheet: p.sc.index, rect: p.sc.used });
    const regionNodes: OutlineNode[] = [];
    p.built.forEach((b, bi) => {
      const regionRef = rec.regionRefs[si]?.[bi] as string;
      b.node.ref = regionRef;
      byRef.set(regionRef, b.node);
      rectOf.set(regionRef, { sheet: p.sc.index, rect: metaOf(b.node).rect as Rect });
      const bounds = (rect: Rect) => {
        const bodyTop = b.item.rect.r0 + Number(b.node.attrs.header ?? 1);
        const bodyEnd = b.node.attrs.totals ? Number(b.node.attrs.totals) - 2 : b.item.rect.r1;
        return {
          data: bodyTop <= bodyEnd ? rectToA1({ ...rect, r0: bodyTop, r1: bodyEnd }) : null,
          header:
            bodyTop > rect.r0 ? rectToA1({ ...rect, r1: Math.min(bodyTop - 1, rect.r1) }) : null,
          totals: b.node.attrs.totals ? rectToA1({ ...rect, r0: bodyEnd + 1 }) : null,
          headerSource: b.node.attrs.headerSource ?? "inferred",
          totalsSource: b.node.attrs.totals ? "inferred" : null,
        };
      };
      if (b.node.kind === "table") b.node.attrs.bounds = bounds(b.item.rect);
      b.childNodes.forEach((ch, ci) => {
        const childRef = rec.childRefs[si]?.[bi]?.[ci] as string;
        ch.ref = childRef;
        byRef.set(childRef, ch);
        const m = metaOf(ch);
        if (m.rect && ch.kind === "col") {
          ch.attrs.bounds = bounds(m.rect);
          const data = (ch.attrs.bounds as ReturnType<typeof bounds>).data;
          const dataRect = data ? parseArea(data) : null;
          if (dataRect) rectOf.set(childRef, { sheet: p.sc.index, rect: dataRect });
        } else if (m.rect) rectOf.set(childRef, { sheet: p.sc.index, rect: m.rect });
      });
      regionNodes.push(b.node);
    });
    // obj nodes: child of the smallest region that fully contains them, else of the sheet
    const sheetObjs: OutlineNode[] = [];
    for (const o of p.objs) {
      const id = o.ref as string;
      byRef.set(id, o);
      const rect = metaOf(o).rect;
      if (rect) rectOf.set(id, { sheet: p.sc.index, rect });
      const host = rect
        ? p.built
            .filter((b) => inside(rect, metaOf(b.node).rect as Rect))
            .sort((a, b) => metaOf(a.node).area - metaOf(b.node).area)[0]
        : undefined;
      if (host && host.node.kind !== "text" && host.node.kind !== "kpi") {
        host.node.children = [...(host.node.children ?? []), o];
        setParent(o, host.node);
      } else sheetObjs.push(o);
    }
    const objectsNode = p.node.children?.[0];
    p.node.children = [...regionNodes, ...(objectsNode ? [objectsNode] : []), ...sheetObjs];
    for (const ch of p.node.children) setParent(ch, p.node);
    setParent(p.node, root);
    root.children?.push(p.node);
  });

  return { root, wb, byRef, rectOf, notes };
}

export function allNodes(n: OutlineNode, out: OutlineNode[] = []): OutlineNode[] {
  out.push(n);
  for (const c of n.children ?? []) allNodes(c, out);
  return out;
}

void trunc;
