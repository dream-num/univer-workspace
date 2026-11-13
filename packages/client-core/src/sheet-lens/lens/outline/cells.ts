// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/outline/cells.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
import type {
  SnapshotCell as ICellData,
  Snapshot as IWorkbookData,
  SnapshotSheet as IWorksheetData,
} from "../../engine/types.js";
import {
  emptyFeatureSheet,
  type FeatureSheet,
  featureSheetOf,
  NF,
  type NumFmtCat,
  numFmtCategory,
} from "../detect/features.js";
import type { WorkbookStructure } from "../explicit.js";
import { colName, parseArea, type Rect, rectToA1 } from "../ranges.js";
import { dateKind, listItem } from "./format.js";
import { shiftFormula, stripEq } from "./formula.js";
import { normalizeCell } from "./value.js";

export type Cls = "num" | "date" | "text" | "bool" | "error";
export interface Cell {
  r: number;
  c: number;
  cls: Cls;
  /** raw cached value: numbers as numbers, text as the string, bool as boolean */
  v: number | string | boolean;
  /** display text supplied by the host from Univer getDisplayValues() */
  text: string;
  /** Normalized stored value; null distinguishes an uncached formula from an empty string. */
  raw: number | string | boolean | null;
  blank: boolean;
  /** formula text without the leading '=' (shared-formula members are shifted from their master) */
  formula?: string;
  pattern?: string;
  nf: NumFmtCat;
  /** Holds a value that a UI does not show: empty display (e.g. `;;;`) or font colour equal to the fill. */
  invisible?: true;
  /** font colour equals the fill colour (white on white by default) */
  ink?: true;
}

export const COLS = 16384;
export const keyOf = (r: number, c: number): number => r * COLS + c;

export interface SheetCells {
  id: string;
  index: number;
  name: string;
  hidden: boolean;
  cells: Map<number, Cell>;
  rowNums: number[]; // sorted row numbers holding any cell (blank ones included)
  byRow: Map<number, Cell[]>; // sorted by column
  nonBlank: number;
  used: Rect | null; // bounding box of non-blank cells
  merges: Rect[];
  frozen: { rows: number; cols: number } | null;
  hiddenRows: Set<number>;
  hiddenCols: Set<number>;
  /** rows hidden by the live filter model (auto filter and table filters), not by `hd` */
  filteredRows: Set<number>;
  /** auto filter range and its criteria, one rendered item per filtered column (`E=open|done`, `C>5000`) */
  filter: { rect: Rect; criteria: string[] } | null;
  /** row / column groups (sheet outline), 0-based inclusive */
  groups: { axis: "row" | "col"; start: number; end: number; collapsed: boolean }[];
  /** cell notes and comment threads, keyed by keyOf(r, c); the text of the note or of the thread's first comment */
  notes: Map<number, string>;
  /** visible columns narrower than NARROW_PX: present in the model, practically invisible in a UI */
  narrowCols: Set<number>;
  fs: FeatureSheet;
}

export const NARROW_PX = 5;

export interface Workbook {
  name: string;
  file: string;
  sheets: SheetCells[];
  structure: WorkbookStructure | null;
}

export type DisplayReader = (sheetId: string, row: number, column: number) => string;
type StyleLike = {
  n?: { pattern?: string } | null;
  cl?: { rgb?: string | null } | null;
  bg?: { rgb?: string | null } | null;
};

const rgb = (c: { rgb?: string | null } | null | undefined): string | undefined => {
  const v = c?.rgb?.toUpperCase().replace(/^#?/, "#");
  return v && /^#[0-9A-F]{3}$/.test(v) ? `#${[...v.slice(1)].map((x) => x + x).join("")}` : v;
};

function resource<T>(data: IWorkbookData, name: string): T | undefined {
  const raw = data.resources?.find((r) => r.name === name)?.data;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

const OPS: Record<string, string> = {
  equal: "=",
  notEqual: "<>",
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  lessThanOrEqual: "<=",
};
interface FilterColumnLike {
  colId: number;
  filters?: { blank?: boolean; filters?: string[] };
  customFilters?: { and?: unknown; customFilters?: { operator?: string; val?: unknown }[] };
  colorFilters?: unknown;
  dynamicFilters?: unknown;
}

/** One filter column as text: `E=open|done`, `C>5000`, `C>=1 and C<=5`, or `E:color` for criteria kinds without a value. */
export function criteriaText(fc: FilterColumnLike): string {
  const col = colName(fc.colId);
  if (fc.filters) {
    const values = (fc.filters.filters ?? []).map((v) => listItem(String(v)));
    if (fc.filters.blank) values.push("(blank)");
    return `${col}=${values.slice(0, 5).join("|")}${values.length > 5 ? "…" : ""}`;
  }
  const custom = fc.customFilters?.customFilters ?? [];
  if (custom.length)
    return custom
      .map((f) => `${col}${OPS[f.operator ?? "equal"] ?? "="}${listItem(String(f.val ?? ""))}`)
      .join(fc.customFilters?.and ? " and " : " or ");
  return `${col}:${fc.colorFilters ? "color" : fc.dynamicFilters ? "dynamic" : "other"}`;
}

type FilterResource = Record<
  string,
  {
    ref?: { startRow: number; startColumn: number; endRow: number; endColumn: number };
    filterColumns?: FilterColumnLike[];
    cachedFilteredOut?: number[];
  }
>;
type TableResource = Record<string, { tableFilteredOutRows?: number[] }>;
type OutlineResource = Record<
  string,
  { outlineList?: { axis?: string; start: number; end: number; collapsed?: boolean }[] }
>;
type NoteResource = Record<string, Record<string, Record<string, { note?: string }>>>;
type CommentResource = Record<
  string,
  { ref?: string; text?: { dataStream?: string }; parentId?: string }[]
>;

function toCell(
  r: number,
  c: number,
  raw: ICellData,
  wb: IWorkbookData,
  sheet: Partial<IWorksheetData>,
  masters: Map<string, { r: number; c: number; f: string }>,
): Cell | null {
  const si = raw.si !== undefined && raw.si !== null && raw.si !== "" ? String(raw.si) : "";
  const hasF = (typeof raw.f === "string" && raw.f !== "") || si !== "";
  const decoded = normalizeCell(raw);
  if (!hasF && decoded.value === null) return null;
  const style = (typeof raw.s === "string" ? wb.styles?.[raw.s] : raw.s) as StyleLike | undefined;
  const pattern = style?.n?.pattern ?? undefined;
  const nf = numFmtCategory(pattern);
  let formula: string | undefined;
  if (typeof raw.f === "string" && raw.f !== "") {
    formula = stripEq(raw.f);
    if (si) masters.set(si, { r, c, f: formula });
  } else if (si) {
    const m = masters.get(si);
    formula = m ? shiftFormula(m.f, r - m.r, c - m.c) : undefined; // master not seen yet: resolved in a second pass
  }
  const val = decoded.value ?? "";
  const cls: Cls =
    decoded.type === "number"
      ? nf === NF.date || nf === NF.time
        ? "date"
        : "num"
      : decoded.type === "empty"
        ? "text"
        : decoded.type;
  const out: Cell = {
    r,
    c,
    cls,
    v: val,
    text: "",
    raw: decoded.value,
    blank: decoded.value === null || (cls === "text" && String(val).trim() === ""),
    nf,
  };
  if (formula !== undefined) out.formula = formula;
  if (pattern !== undefined) out.pattern = pattern;
  // font colour equal to the fill; no fill at all means the default white. A theme or unknown fill never matches.
  // Match Univer's default precedence: cell > row > column > sheet default, per style property.
  const inherited = [
    raw.s,
    sheet.rowData?.[r]?.s,
    sheet.columnData?.[c]?.s,
    sheet.defaultStyle,
  ].map((s) => (typeof s === "string" ? wb.styles?.[s] : s) as StyleLike | undefined);
  const foreground = inherited.find((s) => s?.cl !== undefined)?.cl;
  const background = inherited.find((s) => s?.bg !== undefined)?.bg;
  const ink = rgb(foreground);
  if (ink && ink === (background ? rgb(background) : "#FFFFFF")) out.ink = true;
  return out;
}

export function sheetCellsOf(
  data: IWorkbookData,
  file: string,
  index: number,
  display: DisplayReader,
  { maxBoxCells = 500_000 }: { maxBoxCells?: number } = {},
): SheetCells {
  const id = data.sheetOrder[index];
  const s = id === undefined ? undefined : data.sheets[id];
  if (id === undefined || !s) throw new Error(`workbook has no sheet number ${index}`);
  const cells = new Map<number, Cell>();
  const byRow = new Map<number, Cell[]>();
  const masters = new Map<string, { r: number; c: number; f: string }>();
  const pending: { raw: ICellData; r: number; c: number }[] = [];
  const entries = Object.entries(s.cellData ?? {})
    .map(([rk, row]) => [Number(rk), row] as const)
    .sort((a, b) => a[0] - b[0]);
  for (const [r, row] of entries) {
    const cols = Object.entries((row ?? {}) as Record<string, ICellData | null>)
      .map(([ck, raw]) => [Number(ck), raw] as const)
      .sort((a, b) => a[0] - b[0]);
    for (const [c, raw] of cols) {
      if (!raw) continue;
      const cell = toCell(r, c, raw, data, s, masters);
      if (!cell) continue;
      cell.text = display(id, r, c);
      if (!cell.blank && (cell.ink || cell.text.trim() === "")) cell.invisible = true;
      if (raw.si !== undefined && raw.si !== null && raw.si !== "" && cell.formula === undefined)
        pending.push({ raw, r, c });
      cells.set(keyOf(r, c), cell);
      const list = byRow.get(r);
      if (list) list.push(cell);
      else byRow.set(r, [cell]);
    }
  }
  for (const p of pending) {
    const m = masters.get(String(p.raw.si));
    const target = cells.get(keyOf(p.r, p.c));
    if (m && target) target.formula = shiftFormula(m.f, p.r - m.r, p.c - m.c);
  }
  let used: Rect | null = null;
  let nonBlank = 0;
  for (const cell of cells.values()) {
    if (!cell.blank) nonBlank++;
    if (cell.v === "" && cell.formula === undefined) continue;
    used = used
      ? {
          r0: Math.min(used.r0, cell.r),
          c0: Math.min(used.c0, cell.c),
          r1: Math.max(used.r1, cell.r),
          c1: Math.max(used.c1, cell.c),
        }
      : { r0: cell.r, c0: cell.c, r1: cell.r, c1: cell.c };
  }
  const hidden = (d: Record<string, { hd?: number } | undefined> | undefined) =>
    new Set(
      Object.entries(d ?? {})
        .filter(([, v]) => v?.hd === 1)
        .map(([k]) => Number(k)),
    );
  const hiddenCols = hidden(s.columnData as never);
  const fz = s.freeze;
  const af = resource<FilterResource>(data, "SHEET_FILTER_PLUGIN")?.[id];
  const filteredRows = new Set([
    ...(af?.cachedFilteredOut ?? []),
    ...(resource<TableResource>(data, "SHEET_TABLE_PLUGIN")?.[id]?.tableFilteredOutRows ?? []),
  ]);
  const notes = new Map<number, string>();
  for (const [rk, row] of Object.entries(
    resource<NoteResource>(data, "SHEET_NOTE_PLUGIN")?.[id] ?? {},
  )) {
    for (const [ck, n] of Object.entries(row ?? {}))
      if (n?.note) notes.set(keyOf(Number(rk), Number(ck)), n.note);
  }
  for (const t of resource<CommentResource>(data, "SHEET_UNIVER_THREAD_COMMENT_PLUGIN")?.[id] ??
    []) {
    const at = t.ref && !t.parentId ? parseArea(t.ref) : null;
    if (at && !notes.has(keyOf(at.r0, at.c0)))
      notes.set(keyOf(at.r0, at.c0), (t.text?.dataStream ?? "").replace(/\r?\n$/, ""));
  }
  const widths = Object.entries((s.columnData ?? {}) as Record<string, { w?: number } | undefined>);
  return {
    id,
    index,
    name: s.name ?? id,
    hidden: Boolean(s.hidden),
    cells,
    rowNums: [...byRow.keys()].sort((a, b) => a - b),
    byRow,
    nonBlank,
    used,
    merges: (s.mergeData ?? []).map((m) => ({
      r0: m.startRow,
      c0: m.startColumn,
      r1: m.endRow,
      c1: m.endColumn,
    })),
    frozen: fz && (fz.xSplit > 0 || fz.ySplit > 0) ? { rows: fz.ySplit, cols: fz.xSplit } : null,
    hiddenRows: hidden(s.rowData as never),
    hiddenCols,
    filteredRows,
    filter: af?.ref
      ? {
          rect: {
            r0: af.ref.startRow,
            c0: af.ref.startColumn,
            r1: af.ref.endRow,
            c1: af.ref.endColumn,
          },
          criteria: (af.filterColumns ?? []).map(criteriaText),
        }
      : null,
    groups: (resource<OutlineResource>(data, "SHEET_OUTLINE_PLUGIN")?.[id]?.outlineList ?? [])
      .map((g) => ({
        axis: g.axis === "row" ? ("row" as const) : ("col" as const),
        start: g.start,
        end: g.end,
        collapsed: Boolean(g.collapsed),
      }))
      .sort(
        (a, b) =>
          (a.axis === b.axis ? 0 : a.axis === "row" ? -1 : 1) || a.start - b.start || a.end - b.end,
      ),
    notes,
    narrowCols: new Set(
      widths
        .filter(
          ([k, v]) => typeof v?.w === "number" && v.w < NARROW_PX && !hiddenCols.has(Number(k)),
        )
        .map(([k]) => Number(k)),
    ),
    fs:
      used && (used.r1 - used.r0 + 1) * (used.c1 - used.c0 + 1) > maxBoxCells
        ? { ...emptyFeatureSheet({ key: id, file, index, name: s.name ?? id }), tooLarge: true }
        : featureSheetOf(data, file, index),
  };
}

export function workbookFromData(
  data: IWorkbookData,
  file: string,
  display: DisplayReader,
  structure: WorkbookStructure | null = null,
  opts: { maxBoxCells?: number } = {},
): Workbook {
  return {
    name: data.name || file,
    file,
    sheets: data.sheetOrder.map((_, i) => sheetCellsOf(data, file, i, display, opts)),
    structure,
  };
}

// ---------------------------------------------------------------- accessors
export const cellAt = (sc: SheetCells, r: number, c: number): Cell | undefined =>
  sc.cells.get(keyOf(r, c));
export const isBlankAt = (sc: SheetCells, r: number, c: number): boolean => {
  const x = sc.cells.get(keyOf(r, c));
  return !x || x.blank;
};

/** Calls fn for every NON-BLANK cell inside the rectangle in row-major order. */
export function eachCell(sc: SheetCells, q: Rect, fn: (cell: Cell) => void): void {
  // binary search the first row >= q.r0
  let lo = 0;
  let hi = sc.rowNums.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sc.rowNums[mid] ?? 0) < q.r0) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < sc.rowNums.length && (sc.rowNums[i] ?? 0) <= q.r1; i++) {
    for (const cell of sc.byRow.get(sc.rowNums[i] as number) ?? [])
      if (!cell.blank && cell.c >= q.c0 && cell.c <= q.c1) fn(cell);
  }
}

export function countCells(sc: SheetCells, q: Rect): number {
  let n = 0;
  eachCell(sc, q, () => n++);
  return n;
}

/** The type word of spec 4.3 for one non-blank, non-error cell. */
export function typeOfCell(
  cell: Cell,
): "number" | "percent" | "currency" | "date" | "time" | "datetime" | "text" | "bool" | "error" {
  switch (cell.cls) {
    case "num":
      return cell.nf === NF.percent ? "percent" : cell.nf === NF.currency ? "currency" : "number";
    case "date":
      return dateKind(cell.pattern);
    default:
      return cell.cls;
  }
}

export const usedA1 = (sc: SheetCells): string | undefined =>
  sc.used ? rectToA1(sc.used) : undefined;

export function findSheet(wb: Workbook, key: string | number | undefined): SheetCells | undefined {
  if (key === undefined) return undefined;
  if (typeof key === "number") return wb.sheets[key];
  return wb.sheets.find((s) => s.name === key || s.id === key);
}
