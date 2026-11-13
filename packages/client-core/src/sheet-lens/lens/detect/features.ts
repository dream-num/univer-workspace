// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/detect/features.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// Layer 2 (cell features): turns one imported sheet into a dense feature grid over the bounding box of its non-empty cells.
//
// Conventions (documented once, relied on by every later layer):
// - Coordinates are absolute 0-based sheet coordinates; the grid is the bounding box of non-empty cells, widened over
//   the formatting-only cells within STYLE_REACH of it.
// - "Empty" for region extent = no value, OR a formula whose cached text is empty/whitespace (it renders blank), OR a
//   whitespace-only string. `notes.blankFormulaCells` counts the blank-rendering formula cells that were dropped.
// - Formatting-only cells (no value, but a border or a non-white fill) stay empty for counts, components and tighten;
//   they carry FL.styled, which segmentation and extension read as "the region's grid continues here" (gold rule R2 of
//   the sheet-regions evaluation: a bordered empty template body belongs to its table). Other styles are ignored.
// - Hidden rows/columns (rowData.hd / columnData.hd) are kept as ordinary content for extents (the gold frame shows
//   them), but they are transparent for gap counting: a hidden empty line does not count as an empty separator line.
//   Rows hidden only by an active autofilter are NOT detected (limitation).
// - Size guard: if the bounding box has more than MAX_GRID_CELLS cells the dense grid is NOT built (`tooLarge`);
//   the detector then returns no regions and says so in `notes`. There is no silent sampling anywhere.
import type { SnapshotCell as ICellData, Snapshot as IWorkbookData } from "../../engine/types.js";
import type { Rect } from "../ranges.js";

export const MAX_GRID_CELLS = 8_000_000;

export const VT = { empty: 0, num: 1, date: 2, text: 3, bool: 4, error: 5 } as const;
export type VType = (typeof VT)[keyof typeof VT];
export const NF = {
  none: 0,
  general: 1,
  integer: 2,
  decimal: 3,
  percent: 4,
  currency: 5,
  date: 6,
  time: 7,
  text: 8,
  other: 9,
} as const;
export type NumFmtCat = (typeof NF)[keyof typeof NF];
export const FL = {
  formula: 1,
  bold: 2,
  fill: 4,
  border: 8,
  merged: 16,
  year: 32,
  styled: 64,
  covered: 128,
} as const;
/** formatting-only cells (border or non-white fill, no value) are read this far beyond the value box (rows, cols) */
export const STYLE_REACH = { rows: 50, cols: 10 } as const;

export interface CellSpec {
  r: number;
  c: number;
  kind: "text" | "num" | "date" | "bool" | "error";
  text: string;
  formula?: boolean;
  bold?: boolean;
  fill?: string | null; // colour key, null/undefined = none
  border?: boolean;
  nf?: NumFmtCat;
}
export interface SheetMeta {
  key: string;
  file: string;
  index: number;
  name: string;
}
export interface FeatureSheet extends SheetMeta {
  r0: number;
  c0: number;
  nr: number;
  nc: number;
  /** bounding box of the value cells (the grid may be wider: formatting-only cells within STYLE_REACH) */
  valueBox: Rect | null;
  tooLarge: boolean;
  nonEmpty: number;
  blankFormulaCells: number;
  /** bounding box of those cells, so that a note can say where they are */
  blankBox: Rect | null;
  vt: Uint8Array; // VT per grid cell
  nf: Uint8Array; // NF per grid cell
  flags: Uint8Array; // FL bits
  fillId: Uint16Array; // 0 = none, else palette index + 1
  texts: Map<number, string>; // grid index -> text (text/bool/error cells only)
  merges: Rect[];
  mergeAnchors: Map<number, Rect>; // grid index of the top-left cell -> merge rect
  hiddenRows: Set<number>;
  hiddenCols: Set<number>;
  rowCount: Int32Array; // non-empty cells per grid row
  colCount: Int32Array;
  ps: Int32Array; // 2D prefix sums of non-empty cells, (nr+1)*(nc+1)
}

export const emptyFeatureSheet = (meta: SheetMeta): FeatureSheet => ({
  ...meta,
  r0: 0,
  c0: 0,
  nr: 0,
  nc: 0,
  valueBox: null,
  tooLarge: false,
  nonEmpty: 0,
  blankFormulaCells: 0,
  blankBox: null,
  vt: new Uint8Array(0),
  nf: new Uint8Array(0),
  flags: new Uint8Array(0),
  fillId: new Uint16Array(0),
  texts: new Map(),
  merges: [],
  mergeAnchors: new Map(),
  hiddenRows: new Set(),
  hiddenCols: new Set(),
  rowCount: new Int32Array(0),
  colCount: new Int32Array(0),
  ps: new Int32Array(1),
});

const VT_OF = {
  text: VT.text,
  num: VT.num,
  date: VT.date,
  bool: VT.bool,
  error: VT.error,
} as const;

export function buildFeatureSheet(
  meta: SheetMeta,
  cells: CellSpec[],
  extra: {
    merges?: Rect[];
    hiddenRows?: Iterable<number>;
    hiddenCols?: Iterable<number>;
    styled?: Iterable<{ r: number; c: number }>;
  } = {},
): FeatureSheet {
  const live: CellSpec[] = [];
  let blank = 0;
  let blankBox: Rect | null = null;
  for (const c of cells) {
    if (c.kind === "text" && c.text.trim() === "") {
      blank++;
      blankBox = blankBox
        ? {
            r0: Math.min(blankBox.r0, c.r),
            c0: Math.min(blankBox.c0, c.c),
            r1: Math.max(blankBox.r1, c.r),
            c1: Math.max(blankBox.c1, c.c),
          }
        : { r0: c.r, c0: c.c, r1: c.r, c1: c.c };
      continue;
    }
    live.push(c);
  }
  const merges = (extra.merges ?? []).filter((m) => m.r1 > m.r0 || m.c1 > m.c0);
  const hiddenRows = new Set(extra.hiddenRows ?? []);
  const hiddenCols = new Set(extra.hiddenCols ?? []);
  if (!live.length)
    return {
      ...emptyFeatureSheet(meta),
      blankFormulaCells: blank,
      blankBox,
      merges,
      hiddenRows,
      hiddenCols,
    };
  let r0 = Infinity,
    c0 = Infinity,
    r1 = -1,
    c1 = -1;
  for (const c of live) {
    r0 = Math.min(r0, c.r);
    r1 = Math.max(r1, c.r);
    c0 = Math.min(c0, c.c);
    c1 = Math.max(c1, c.c);
  }
  const valueBox = { r0, c0, r1, c1 };
  // formatting-only cells near the values widen the grid (flag FL.styled, still empty for counts and extents)
  const styled = [...(extra.styled ?? [])].filter(
    (p) =>
      p.r >= r0 - STYLE_REACH.rows &&
      p.r <= r1 + STYLE_REACH.rows &&
      p.c >= c0 - STYLE_REACH.cols &&
      p.c <= c1 + STYLE_REACH.cols,
  );
  for (const p of styled) {
    r0 = Math.min(r0, p.r);
    r1 = Math.max(r1, p.r);
    c0 = Math.min(c0, p.c);
    c1 = Math.max(c1, p.c);
  }
  // a merge anchored on a value is one cell on screen: the grid holds its whole rectangle (FL.covered, see below)
  const valueAt = new Set(live.map((c) => `${c.r},${c.c}`));
  const valueMerges = merges.filter((m) => valueAt.has(`${m.r0},${m.c0}`));
  for (const m of valueMerges) {
    r0 = Math.min(r0, m.r0);
    r1 = Math.max(r1, m.r1);
    c0 = Math.min(c0, m.c0);
    c1 = Math.max(c1, m.c1);
  }
  const nr = r1 - r0 + 1,
    nc = c1 - c0 + 1;
  const base = {
    ...emptyFeatureSheet(meta),
    r0,
    c0,
    nr,
    nc,
    valueBox,
    nonEmpty: live.length,
    blankFormulaCells: blank,
    blankBox,
    merges,
    hiddenRows,
    hiddenCols,
  };
  if (nr * nc > MAX_GRID_CELLS) return { ...base, tooLarge: true };

  const n = nr * nc;
  const vt = new Uint8Array(n),
    nf = new Uint8Array(n),
    flags = new Uint8Array(n),
    fillId = new Uint16Array(n);
  const texts = new Map<number, string>();
  const palette = new Map<string, number>();
  const rowCount = new Int32Array(nr),
    colCount = new Int32Array(nc);
  for (const c of live) {
    const i = c.r - r0,
      j = c.c - c0,
      k = i * nc + j;
    vt[k] = VT_OF[c.kind];
    nf[k] = c.nf ?? NF.none;
    let f = 0;
    if (c.formula) f |= FL.formula;
    if (c.bold) f |= FL.bold;
    if (c.fill) {
      f |= FL.fill;
      if (!palette.has(c.fill)) palette.set(c.fill, Math.min(palette.size + 1, 65535));
      fillId[k] = palette.get(c.fill) ?? 0;
    }
    if (c.border) f |= FL.border;
    if (c.kind === "num" && /^\d{4}$/.test(c.text) && +c.text >= 1900 && +c.text <= 2100)
      f |= FL.year;
    flags[k] = f;
    if (c.kind !== "num" && c.kind !== "date") texts.set(k, c.text);
    rowCount[i] = (rowCount[i] ?? 0) + 1;
    colCount[j] = (colCount[j] ?? 0) + 1;
  }
  for (const p of styled) or(flags, (p.r - r0) * nc + (p.c - c0), FL.styled);
  // cells covered by a value-anchored merge are not blank space for gap and cut decisions; they stay empty for counts
  for (const m of valueMerges) {
    for (let r = m.r0; r <= m.r1; r++)
      for (let c = m.c0; c <= m.c1; c++)
        if (r !== m.r0 || c !== m.c0) or(flags, (r - r0) * nc + (c - c0), FL.covered);
  }
  const mergeAnchors = new Map<number, Rect>();
  for (const m of merges) {
    for (let r = Math.max(m.r0, r0); r <= Math.min(m.r1, r1); r++) {
      for (let c = Math.max(m.c0, c0); c <= Math.min(m.c1, c1); c++)
        or(flags, (r - r0) * nc + (c - c0), FL.merged);
    }
    if (m.r0 >= r0 && m.r0 <= r1 && m.c0 >= c0 && m.c0 <= c1)
      mergeAnchors.set((m.r0 - r0) * nc + (m.c0 - c0), m);
  }
  const w = nc + 1;
  const ps = new Int32Array((nr + 1) * w);
  for (let i = 0; i < nr; i++) {
    let run = 0;
    for (let j = 0; j < nc; j++) {
      if (vt[i * nc + j]) run++;
      ps[(i + 1) * w + j + 1] = (ps[i * w + j + 1] ?? 0) + run;
    }
  }
  return { ...base, vt, nf, flags, fillId, texts, mergeAnchors, rowCount, colCount, ps };
}

/** `a[i] |= bits` for typed arrays (indexing yields `number | undefined` under noUncheckedIndexedAccess). */
const or = (a: Uint8Array, i: number, bits: number): void => {
  a[i] = (a[i] ?? 0) | bits;
};

// ---------------------------------------------------------------- accessors (absolute coordinates, bounds-checked)
export const inGrid = (fs: FeatureSheet, r: number, c: number): boolean =>
  r >= fs.r0 && c >= fs.c0 && r < fs.r0 + fs.nr && c < fs.c0 + fs.nc;
export const gi = (fs: FeatureSheet, r: number, c: number): number =>
  (r - fs.r0) * fs.nc + (c - fs.c0);
export const vtAt = (fs: FeatureSheet, r: number, c: number): number =>
  inGrid(fs, r, c) ? (fs.vt[gi(fs, r, c)] ?? 0) : 0;
export const flagAt = (fs: FeatureSheet, r: number, c: number): number =>
  inGrid(fs, r, c) ? (fs.flags[gi(fs, r, c)] ?? 0) : 0;
export const textAt = (fs: FeatureSheet, r: number, c: number): string =>
  inGrid(fs, r, c) ? (fs.texts.get(gi(fs, r, c)) ?? "") : "";

/** Number of non-empty cells inside an absolute rectangle (clamped to the grid), O(1). */
export function countIn(fs: FeatureSheet, q: Rect): number {
  const i0 = Math.max(q.r0 - fs.r0, 0),
    j0 = Math.max(q.c0 - fs.c0, 0);
  const i1 = Math.min(q.r1 - fs.r0, fs.nr - 1),
    j1 = Math.min(q.c1 - fs.c0, fs.nc - 1);
  if (i0 > i1 || j0 > j1) return 0;
  const w = fs.nc + 1;
  const p = (i: number, j: number) => fs.ps[i * w + j] ?? 0;
  return p(i1 + 1, j1 + 1) - p(i0, j1 + 1) - p(i1 + 1, j0) + p(i0, j0);
}

/** Number of cells carrying `flag` inside an absolute rectangle clamped to the grid. */
function flaggedIn(fs: FeatureSheet, q: Rect, flag: number): number {
  let n = 0;
  for (let r = Math.max(q.r0, fs.r0); r <= Math.min(q.r1, fs.r0 + fs.nr - 1); r++) {
    for (let c = Math.max(q.c0, fs.c0); c <= Math.min(q.c1, fs.c0 + fs.nc - 1); c++)
      if ((fs.flags[gi(fs, r, c)] ?? 0) & flag) n++;
  }
  return n;
}
/** Formatting-only cells (FL.styled) inside q. */
export const styledIn = (fs: FeatureSheet, q: Rect): number => flaggedIn(fs, q, FL.styled);
/** Cells covered by a value-anchored merge (FL.covered) inside q. */
export const coveredIn = (fs: FeatureSheet, q: Rect): number => flaggedIn(fs, q, FL.covered);

/** Smallest rectangle around the non-empty cells inside `q`, or null. */
export function tighten(fs: FeatureSheet, q: Rect): Rect | null {
  if (countIn(fs, q) === 0) return null;
  let { r0, c0, r1, c1 } = q;
  r0 = Math.max(r0, fs.r0);
  c0 = Math.max(c0, fs.c0);
  r1 = Math.min(r1, fs.r0 + fs.nr - 1);
  c1 = Math.min(c1, fs.c0 + fs.nc - 1);
  while (countIn(fs, { r0, c0, r1: r0, c1 }) === 0) r0++;
  while (countIn(fs, { r0: r1, c0, r1, c1 }) === 0) r1--;
  while (countIn(fs, { r0, c0, r1, c1: c0 }) === 0) c0++;
  while (countIn(fs, { r0, c0: c1, r1, c1 }) === 0) c1--;
  return { r0, c0, r1, c1 };
}

// ---------------------------------------------------------------- reading from an imported workbook
const isDatePattern = (p: string): boolean => {
  const q = p.replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, "");
  return /[ymdhs]/i.test(q) && !/[0#]/.test(q);
};
const serialToIso = (n: number): string =>
  new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 16);

export function numFmtCategory(pattern: string | undefined): NumFmtCat {
  if (!pattern || /^general$/i.test(pattern)) return NF.general;
  const q = pattern.replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, "");
  if (q.trim() === "@") return NF.text;
  if (isDatePattern(pattern)) return /[yd]/i.test(q) ? NF.date : NF.time;
  if (q.includes("%")) return NF.percent;
  if (/[$€£¥]/.test(pattern)) return NF.currency;
  if (/[0#]\.[0#]/.test(q)) return NF.decimal;
  if (/[0#]/.test(q)) return NF.integer;
  return NF.other;
}

const WHITE = new Set(["#ffffff", "#fff"]);
interface StyleLike {
  bl?: number;
  bg?: { rgb?: string | null } | null;
  n?: { pattern?: string } | null;
  bd?: Record<string, { s?: number } | null | undefined> | null;
}

function toSpec(
  r: number,
  c: number,
  raw: ICellData,
  wb: IWorkbookData,
): CellSpec | "styled" | null {
  const formula =
    (typeof raw.f === "string" && raw.f !== "") ||
    (raw.si !== undefined && raw.si !== null && raw.si !== "");
  const rich = (raw as { p?: { body?: { dataStream?: string } } }).p?.body?.dataStream;
  const v = raw.v ?? (rich !== undefined ? rich.replace(/\r\n?$/, "") : undefined);
  const hasV = v !== undefined && v !== null && v !== "";
  const style = (typeof raw.s === "string" ? wb.styles?.[raw.s] : raw.s) as StyleLike | undefined;
  const bg = style?.bg?.rgb?.toLowerCase();
  const border = style?.bd
    ? Object.values(style.bd).some(
        (b) => b && typeof b === "object" && b.s !== undefined && b.s !== 0,
      )
    : false;
  // formatting-only cell: not a value; it only marks where a region's border grid or fill band continues (FL.styled)
  if (!formula && !hasV) return border || (bg && !WHITE.has(bg)) ? "styled" : null;
  const pattern = style?.n?.pattern;
  let kind: CellSpec["kind"] = "text";
  let text = "";
  if (hasV) {
    if (typeof v === "number" || (typeof v === "string" && raw.t === 2)) {
      const n = Number(v);
      kind = isDatePattern(pattern ?? "General") ? "date" : "num";
      text = kind === "date" ? serialToIso(n) : String(Number(n.toPrecision(10)));
    } else if (raw.t === 3 || typeof v === "boolean") {
      kind = "bool";
      text = v === true || v === "1" || String(v).toUpperCase() === "TRUE" ? "TRUE" : "FALSE";
    } else {
      text = String(v);
      if (/^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!)/.test(text)) kind = "error";
    }
  }
  return {
    r,
    c,
    kind,
    text,
    formula,
    bold: style?.bl === 1,
    fill: bg && !WHITE.has(bg) ? bg : null,
    border,
    nf: numFmtCategory(pattern),
  };
}

/** Build the feature grid of sheet number `index` of an already imported workbook. */
export function featureSheetOf(workbook: IWorkbookData, file: string, index: number): FeatureSheet {
  const id = workbook.sheetOrder[index];
  const s = id === undefined ? undefined : workbook.sheets[id];
  if (id === undefined || !s) throw new Error(`workbook has no sheet number ${index}`);
  const specs: CellSpec[] = [];
  const styled: { r: number; c: number }[] = [];
  for (const [rk, row] of Object.entries(s.cellData ?? {})) {
    for (const [ck, raw] of Object.entries((row ?? {}) as Record<string, ICellData | null>)) {
      const spec = raw ? toSpec(Number(rk), Number(ck), raw, workbook) : null;
      if (spec === "styled") styled.push({ r: Number(rk), c: Number(ck) });
      else if (spec) specs.push(spec);
    }
  }
  const hidden = (d: Record<string, { hd?: number } | undefined> | undefined) =>
    Object.entries(d ?? {})
      .filter(([, v]) => v?.hd === 1)
      .map(([k]) => Number(k));
  return buildFeatureSheet(
    {
      key: `${file.replace(/\.xlsx$/i, "").replace(/[^A-Za-z0-9_.-]/g, "_")}__s${index}`,
      file,
      index,
      name: s.name ?? id,
    },
    specs,
    {
      merges: (s.mergeData ?? []).map((m) => ({
        r0: m.startRow,
        c0: m.startColumn,
        r1: m.endRow,
        c1: m.endColumn,
      })),
      hiddenRows: hidden(s.rowData as never),
      hiddenCols: hidden(s.columnData as never),
      styled,
    },
  );
}
