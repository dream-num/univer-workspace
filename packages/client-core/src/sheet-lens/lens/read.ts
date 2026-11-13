// `uxl read`: a bounded rectangle of cells with complete fields. Pure: a snapshot and the
// cell model in, a page out; text, CSV and JSON are all rendered from the same page. The grid format follows
// dream-num/unvdp RFC 04 section 8 (tab separated, one JSON token per cell, facts below the grid).
import type { Snapshot, SnapshotCell } from "../engine/types.js";
import { SheetLensError } from "../platform/errors.js";
import { type Cell, COLS, cellAt, type SheetCells, typeOfCell } from "./outline/cells.js";
import { trunc } from "./outline/format.js";
import { mergesIn } from "./outline/merges.js";
import { colName, MAX_COL, MAX_ROW, parseArea, type Rect, rectToA1 } from "./ranges.js";

export type Content = "both" | "display" | "formula" | "style" | "formula+style";

/** Contents that carry cell styles. */
const withStyle = (c: Content): boolean => c === "style" || c === "formula+style";

// ---------------------------------------------------------------- RANGE text

export interface RangeSpec {
  /** The part before the last `!`, unquoted; undefined when the text has none. */
  sheet: string | undefined;
  /** What the area part looked like: a rectangle of cells, whole columns or whole rows. */
  kind: "cells" | "cols" | "rows";
  rect: Rect;
  /** The area part as typed (trimmed), for messages. */
  area: string;
}

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
const COL = /^\$?([A-Za-z]{1,3})$/;
const ROW = /^\$?(\d+)$/;
const FORMS =
  "write A1, A1:C20, A:C or 3:5, optionally preceded by Sheet!, for example Sheet1!A1:C20";

const badRange = (text: string, why: string): SheetLensError =>
  new SheetLensError("E_RANGE", `invalid range '${text}': ${why}`, { hint: FORMS });

export function parseRange(text: string): RangeSpec {
  const bang = text.lastIndexOf("!");
  let sheet: string | undefined;
  let area = text;
  if (bang >= 0) {
    sheet = text.slice(0, bang);
    area = text.slice(bang + 1);
    if (sheet.length >= 2 && sheet.startsWith("'") && sheet.endsWith("'"))
      sheet = sheet.slice(1, -1).replaceAll("''", "'");
    if (sheet === "") throw badRange(text, "the sheet name before ! is empty");
  }
  area = area.trim();
  if (area === "") throw badRange(text, "there is no cell range after the sheet name");
  const parts = area.split(":");
  if (parts.length > 2) throw badRange(text, "a range has at most one colon");
  const kindOf = (p: string): RangeSpec["kind"] | undefined =>
    CELL.test(p) ? "cells" : COL.test(p) ? "cols" : ROW.test(p) ? "rows" : undefined;
  const kinds = parts.map(kindOf);
  if (kinds.some((k) => k === undefined))
    throw badRange(text, `'${parts[kinds.indexOf(undefined)]}' is not a cell, column or row`);
  const kind = kinds[0] as RangeSpec["kind"];
  if (kinds[1] !== undefined && kinds[1] !== kind)
    throw badRange(
      text,
      "both ends of a range must be the same kind: cells (A1:C20), columns (A:C) or rows (3:5)",
    );
  if (kind !== "cells" && parts.length === 1)
    throw badRange(
      text,
      `'${area}' is a single ${kind === "cols" ? "column" : "row"}; write it with a colon (${area}:${area})`,
    );
  const rect = parseArea(area);
  if (!rect || rect.r0 < 0 || rect.c0 < 0)
    throw badRange(text, "rows and columns start at 1 and A");
  if (rect.r1 > MAX_ROW) throw badRange(text, `a sheet has ${MAX_ROW + 1} rows at most`);
  if (rect.c1 > MAX_COL)
    throw badRange(text, `a sheet has ${colName(MAX_COL)} (${MAX_COL + 1}) columns at most`);
  return { sheet, kind, rect, area };
}

export const sheetNames = (data: Snapshot): string[] =>
  data.sheetOrder.map((id) => data.sheets[id]?.name ?? id);

export function nameList(names: string[]): string {
  const shown = names.slice(0, 10).join(", ");
  return names.length > 10 ? `${shown}, …+${names.length - 10}` : shown;
}

/** The sheet a RANGE names: exact name first, then a sheet ref (`s2`). No prefix is allowed when there is one sheet. */
export function sheetIndexOf(data: Snapshot, key: string | undefined, range: string): number {
  const names = sheetNames(data);
  if (key === undefined) {
    if (names.length === 1) return 0;
    throw new SheetLensError(
      "E_RANGE",
      `range '${range}' has no sheet, and this workbook has ${names.length} sheets (${nameList(names)})`,
      {
        hint: `name the sheet in front of the range, for example ${names[0]?.includes("'") ? `'${(names[0] ?? "").replaceAll("'", "''")}'` : (names[0] ?? "Sheet1")}!${range}`,
      },
    );
  }
  const byName = names.indexOf(key);
  if (byName >= 0) return byName;
  const ref = /^s([1-9]\d*)$/.exec(key);
  if (ref && Number(ref[1]) <= names.length) return Number(ref[1]) - 1;
  throw new SheetLensError(
    "E_SHEET_NOT_FOUND",
    `no sheet '${key}' in this file (sheets: ${nameList(names)})`,
  );
}

/** Whole columns and rows take their open side from the used range; an explicit rectangle is never trimmed. */
export function resolveRect(spec: RangeSpec, sc: SheetCells): Rect | null {
  if (spec.kind === "cells") return spec.rect;
  const used = sc.used;
  if (!used) return null;
  return spec.kind === "cols"
    ? { ...spec.rect, r0: 0, r1: used.r1 }
    : { ...spec.rect, c0: 0, c1: used.c1 };
}

// ---------------------------------------------------------------- naming

const BARE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
/** The sheet name as it is written in front of `!` in a title (Excel quoting). */
export const sheetLabel = (name: string): string =>
  BARE.test(name) ? name : `'${name.replaceAll("'", "''")}'`;
/** `<sheet>!<A1>` as a RANGE argument: the name itself unless it holds a quote. */
export const rangeText = (name: string, rect: Rect): string =>
  `${name.includes("'") ? sheetLabel(name) : name}!${rectToA1(rect)}`;

// ---------------------------------------------------------------- styles

// Hand-written copies of @univerjs/core enums (the lens cannot import Univer); test/engine/read.test.ts compares them.
export const HORIZONTAL = { 1: "left", 2: "center", 3: "right", 4: "justify" } as const;
export const VERTICAL = { 1: "top", 2: "middle", 3: "bottom" } as const;
export const WRAP = 3;

interface StyleLike {
  bl?: number | null;
  it?: number | null;
  ul?: { s?: number } | null;
  st?: { s?: number } | null;
  fs?: number | null;
  ff?: string | null;
  cl?: { rgb?: string | null } | null;
  bg?: { rgb?: string | null } | null;
  ht?: number | null;
  vt?: number | null;
  tb?: number | null;
  n?: { pattern?: string | null } | null;
}
export type CellStyle = Record<string, string | number | true>;

const hex = (c: { rgb?: string | null } | null | undefined): string | undefined => {
  const v = c?.rgb?.toUpperCase().replace(/^#?/, "#");
  return v && /^#[0-9A-F]{6}$/.test(v) ? v : undefined;
};

/** Properties that differ from the sheet's default style, resolved cell > row > column (per property). */
export function styleAt(
  data: Snapshot,
  sheetId: string,
  row: number,
  column: number,
): CellStyle | undefined {
  const sheet = data.sheets[sheetId];
  if (!sheet) return undefined;
  const resolve = (s: unknown): StyleLike | undefined =>
    (typeof s === "string" ? data.styles?.[s] : s) as StyleLike | undefined;
  const cell = sheet.cellData?.[row]?.[column] as SnapshotCell | null | undefined;
  const layers = [cell?.s, sheet.rowData?.[row]?.s, sheet.columnData?.[column]?.s].map(resolve);
  const base = resolve(sheet.defaultStyle);
  const pick = <K extends keyof StyleLike>(key: K): StyleLike[K] =>
    (layers.find((s) => s?.[key] !== undefined)?.[key] ?? undefined) as StyleLike[K];
  const out: CellStyle = {};
  const on = (v: number | null | undefined, b: number | null | undefined) => v === 1 && b !== 1;
  if (on(pick("bl"), base?.bl)) out.bold = true;
  if (on(pick("it"), base?.it)) out.italic = true;
  if (pick("ul")?.s === 1 && base?.ul?.s !== 1) out.underline = true;
  if (pick("st")?.s === 1 && base?.st?.s !== 1) out.strike = true;
  const size = pick("fs");
  if (typeof size === "number" && size !== base?.fs) out.size = size;
  const font = pick("ff");
  if (font && font !== base?.ff) out.font = font;
  const color = hex(pick("cl"));
  if (color && color !== hex(base?.cl)) out.color = color;
  const fill = hex(pick("bg"));
  if (fill && fill !== hex(base?.bg)) out.fill = fill;
  const ht = HORIZONTAL[pick("ht") as keyof typeof HORIZONTAL];
  if (ht && ht !== HORIZONTAL[base?.ht as keyof typeof HORIZONTAL]) out.halign = ht;
  const vt = VERTICAL[pick("vt") as keyof typeof VERTICAL];
  if (vt && vt !== VERTICAL[base?.vt as keyof typeof VERTICAL]) out.valign = vt;
  if (pick("tb") === WRAP && base?.tb !== WRAP) out.wrap = true;
  const format = pick("n")?.pattern;
  if (format && format.toLowerCase() !== "general" && format !== base?.n?.pattern)
    out.format = format;
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- the page

export interface ReadCell {
  ref: string;
  type: string;
  display: string;
  value: string | number | boolean | null;
  formula?: string;
  style?: CellStyle;
}

export interface Facts {
  hiddenRows: number[];
  hiddenCols: string[];
  filteredRows: number[];
  merges: string[];
  covered: string[];
  invisible: string[];
  notes: { at: string; text: string }[];
}

export interface ReadPage {
  sheet: string;
  /** `s<n>` */
  ref: string;
  content: Content;
  /** The rectangle that was asked for; null when a whole-column or whole-row range met an empty sheet. */
  requested: Rect | null;
  /** The rows of it that this page holds; null together with `requested`. */
  shown: Rect | null;
  /** The area as typed, for the title of an empty page. */
  area: string;
  /** Sparse, row-major: cells with a stored value or formula (and, for `style`, cells with a style). */
  cells: ReadCell[];
  facts: Facts;
  /** Rows of `requested` after this page. */
  remaining: number;
  /** The rest of `requested` when there is one: the same columns, from the next row. */
  next: Rect | null;
}

export const hasContent = (c: Cell): boolean =>
  c.formula !== undefined || (c.raw !== null && c.raw !== "");

function cellsIn(sc: SheetCells, q: Rect): Cell[] {
  const out: Cell[] = [];
  let lo = 0;
  let hi = sc.rowNums.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sc.rowNums[mid] ?? 0) < q.r0) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < sc.rowNums.length && (sc.rowNums[i] ?? 0) <= q.r1; i++)
    for (const cell of sc.byRow.get(sc.rowNums[i] as number) ?? [])
      if (cell.c >= q.c0 && cell.c <= q.c1) out.push(cell);
  return out;
}

export const refOf = (r: number, c: number): string => `${colName(c)}${r + 1}`;

export function readCell(
  cell: Cell | undefined,
  r: number,
  c: number,
  style: CellStyle | undefined,
): ReadCell {
  const out: ReadCell = {
    ref: refOf(r, c),
    type: !cell || cell.raw === null ? "empty" : typeOfCell(cell),
    display: cell?.text ?? "",
    value: cell?.raw ?? null,
  };
  if (cell?.formula !== undefined) out.formula = `=${cell.formula}`;
  if (style) out.style = style;
  return out;
}

function factsOf(sc: SheetCells, q: Rect, stored: Cell[]): Facts {
  const rowMajor = (a: { r: number; c: number }, b: { r: number; c: number }) =>
    a.r - b.r || a.c - b.c;
  const covered: { r: number; c: number }[] = [];
  for (const m of mergesIn(sc, q)) {
    for (let r = Math.max(m.r0, q.r0); r <= Math.min(m.r1, q.r1); r++)
      for (let c = Math.max(m.c0, q.c0); c <= Math.min(m.c1, q.c1); c++) {
        const cell = (r !== m.r0 || c !== m.c0) && cellAt(sc, r, c);
        if (cell && hasContent(cell)) covered.push({ r, c });
      }
  }
  const notes: { r: number; c: number; text: string }[] = [];
  for (const [key, text] of sc.notes) {
    const r = Math.floor(key / COLS);
    const c = key % COLS;
    if (r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1) notes.push({ r, c, text });
  }
  const within = (n: number, lo: number, hi: number) => n >= lo && n <= hi;
  return {
    hiddenRows: [...sc.hiddenRows]
      .filter((r) => within(r, q.r0, q.r1))
      .sort((a, b) => a - b)
      .map((r) => r + 1),
    hiddenCols: [...sc.hiddenCols]
      .filter((c) => within(c, q.c0, q.c1))
      .sort((a, b) => a - b)
      .map(colName),
    filteredRows: [...sc.filteredRows]
      .filter((r) => within(r, q.r0, q.r1))
      .sort((a, b) => a - b)
      .map((r) => r + 1),
    merges: mergesIn(sc, q).map((m) => rectToA1(m)),
    covered: covered.sort(rowMajor).map((x) => refOf(x.r, x.c)),
    invisible: stored.filter((x) => x.invisible).map((x) => refOf(x.r, x.c)),
    notes: notes.sort(rowMajor).map((n) => ({ at: refOf(n.r, n.c), text: n.text })),
  };
}

export interface ReadOptions {
  content: Content;
  /** Cells per page; a page holds whole rows only. */
  maxCells: number;
}

/** One page of `requested`: as many whole rows as `maxCells` allows. */
export function readPage(
  data: Snapshot,
  sc: SheetCells,
  requested: Rect | null,
  area: string,
  o: ReadOptions,
): ReadPage {
  const page: ReadPage = {
    sheet: sc.name,
    ref: `s${sc.index + 1}`,
    content: o.content,
    requested,
    shown: null,
    area,
    cells: [],
    facts: {
      hiddenRows: [],
      hiddenCols: [],
      filteredRows: [],
      merges: [],
      covered: [],
      invisible: [],
      notes: [],
    },
    remaining: 0,
    next: null,
  };
  if (!requested) return page;
  const columns = requested.c1 - requested.c0 + 1;
  if (columns > o.maxCells)
    throw new SheetLensError(
      "E_RANGE",
      `row ${requested.r0 + 1} of ${sheetLabel(sc.name)}!${rectToA1(requested)} has ${columns} cells, more than --max ${o.maxCells}`,
      { hint: "read fewer columns at a time, or raise --max" },
    );
  const total = requested.r1 - requested.r0 + 1;
  const rows = Math.min(total, Math.floor(o.maxCells / columns));
  const shown: Rect = { ...requested, r1: requested.r0 + rows - 1 };
  page.shown = shown;
  page.remaining = total - rows;
  if (page.remaining > 0) page.next = { ...requested, r0: shown.r1 + 1 };

  const stored = cellsIn(sc, shown);
  if (withStyle(o.content)) {
    for (let r = shown.r0; r <= shown.r1; r++)
      for (let c = shown.c0; c <= shown.c1; c++) {
        const cell = cellAt(sc, r, c);
        const style = styleAt(data, sc.id, r, c);
        if ((cell && hasContent(cell)) || style) page.cells.push(readCell(cell, r, c, style));
      }
  } else {
    for (const cell of stored)
      if (hasContent(cell)) page.cells.push(readCell(cell, cell.r, cell.c, undefined));
  }
  page.facts = factsOf(sc, shown, stored);
  return page;
}

// ---------------------------------------------------------------- text

const LINE_BREAKS = /[\u007f\u0085\u2028\u2029]/g;
/** A JSON value on one line; the characters a line-oriented reader may treat as line breaks are written as escapes. */
export const json = (v: unknown): string =>
  JSON.stringify(v).replace(
    LINE_BREAKS,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

function token(cell: Cell | undefined, content: Content, style: CellStyle | undefined): string {
  const display = cell?.text ?? "";
  const formula = cell?.formula === undefined ? undefined : `=${cell.formula}`;
  // A constant error says so: as a string it would read like the text "#N/A". A formula error shows its formula.
  if (cell?.cls === "error" && formula === undefined)
    return json({ display, type: "error", ...(style ? { style } : {}) });
  if (content === "both" && formula !== undefined) return json({ display, formula });
  if (content === "formula" && formula !== undefined) return json(formula);
  if (content === "style" && style) return json({ display, style });
  if (content === "formula+style" && (formula !== undefined || style))
    return json({
      display,
      ...(formula !== undefined ? { formula } : {}),
      ...(style ? { style } : {}),
    });
  return json(display);
}

const cap = (items: string[], n: number): string =>
  (items.length > n ? [...items.slice(0, n), `…+${items.length - n}`] : items).join(" ");

function factLines(f: Facts): string[] {
  const out: string[] = [];
  const hidden = [
    f.hiddenRows.length ? `rows ${cap(f.hiddenRows.map(String), 10)}` : "",
    f.hiddenCols.length ? `cols ${cap(f.hiddenCols, 10)}` : "",
  ].filter(Boolean);
  if (hidden.length) out.push(`hidden: ${hidden.join("; ")} (shown, not removed)`);
  if (f.filteredRows.length)
    out.push(`filtered: rows ${cap(f.filteredRows.map(String), 10)} (shown, not removed)`);
  if (f.merges.length) out.push(`merged: ${cap(f.merges, 20)}`);
  if (f.covered.length) out.push(`covered: ${cap(f.covered, 5)}`);
  if (f.invisible.length) out.push(`invisible: ${cap(f.invisible, 5)}`);
  if (f.notes.length)
    out.push(
      `notes: ${cap(
        f.notes.map((n) => `${n.at}=${json(trunc(n.text, 40))}`),
        5,
      )}`,
    );
  return out;
}

export function renderGrid(data: Snapshot, sc: SheetCells, page: ReadPage): string {
  const name = sheetLabel(page.sheet);
  const attrs = [`ref=${page.ref}`, page.content, ...(page.cells.length === 0 ? ["empty"] : [])];
  const shown = page.shown;
  const title = `read ${name}!${shown ? rectToA1(shown) : page.area} [${attrs.join(", ")}]`;
  if (!shown) return `${title}\n`;
  const lines = [
    title,
    [
      "row",
      ...Array.from({ length: shown.c1 - shown.c0 + 1 }, (_, i) => colName(shown.c0 + i)),
    ].join("\t"),
  ];
  for (let r = shown.r0; r <= shown.r1; r++) {
    const fields = [String(r + 1)];
    for (let c = shown.c0; c <= shown.c1; c++)
      fields.push(
        token(
          cellAt(sc, r, c),
          page.content,
          withStyle(page.content) ? styleAt(data, sc.id, r, c) : undefined,
        ),
      );
    lines.push(fields.join("\t"));
  }
  return `${[...lines, ...factLines(page.facts)].join("\n")}\n`;
}

// ---------------------------------------------------------------- CSV

/** RFC 4180 quoting: a field is wrapped when it holds the separator, a quote or a line break. */
const csvField = (s: string, separator = ","): string =>
  s.includes('"') || s.includes(separator) || s.includes("\r") || s.includes("\n")
    ? `"${s.replaceAll('"', '""')}"`
    : s;

/**
 * Numbers are the stored value (15 significant digits, as a spreadsheet keeps them) so that pandas gets a number
 * column; everything else, dates included, is the display text.
 */
function csvValue(cell: Cell | undefined, formulas: boolean): string {
  if (!cell) return "";
  if (formulas && cell.formula !== undefined) return `=${cell.formula}`;
  if (cell.cls === "num" && typeof cell.raw === "number")
    return String(Number.parseFloat(cell.raw.toPrecision(15)));
  return cell.text;
}

export function renderCsv(sc: SheetCells, page: ReadPage, formulas: boolean): string {
  const shown = page.shown;
  if (!shown) return "";
  const lines: string[] = [];
  for (let r = shown.r0; r <= shown.r1; r++) {
    const fields: string[] = [];
    for (let c = shown.c0; c <= shown.c1; c++)
      fields.push(csvField(csvValue(cellAt(sc, r, c), formulas)));
    lines.push(fields.join(","));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A whole sheet as delimited text, for `uxl convert`: the cell text as shown, from A1 to the
 * last row and column that hold a value, every record with the same number of fields. An empty sheet is an empty string.
 */
export function renderSheetText(sc: SheetCells, format: "csv" | "tsv"): string {
  const used = sc.used;
  if (!used) return "";
  const separator = format === "csv" ? "," : "\t";
  // ponytail: the whole sheet is built in memory; stream rows to the temporary file if multi-GB sheets ever matter.
  const lines: string[] = [];
  for (let r = 0; r <= used.r1; r++) {
    const fields: string[] = [];
    for (let c = 0; c <= used.c1; c++)
      fields.push(csvField(cellAt(sc, r, c)?.text ?? "", separator));
    lines.push(fields.join(separator));
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- JSON

/** The `result` fields that come from the page; the caller adds `file` and `format`. */
export function pageJson(page: ReadPage): Record<string, unknown> {
  const f = page.facts;
  const hidden = {
    ...(f.hiddenRows.length ? { rows: f.hiddenRows } : {}),
    ...(f.hiddenCols.length ? { cols: f.hiddenCols } : {}),
  };
  return {
    sheet: page.sheet,
    ref: page.ref,
    range: page.shown ? rectToA1(page.shown) : null,
    requested: page.requested ? rectToA1(page.requested) : null,
    content: page.content,
    rows: page.shown ? page.shown.r1 - page.shown.r0 + 1 : 0,
    columns: page.shown ? page.shown.c1 - page.shown.c0 + 1 : 0,
    empty: page.cells.length === 0,
    cells: page.cells,
    ...(f.merges.length ? { merges: f.merges } : {}),
    ...(f.covered.length ? { covered: f.covered } : {}),
    ...(Object.keys(hidden).length ? { hidden } : {}),
    ...(f.filteredRows.length ? { filteredRows: f.filteredRows } : {}),
    ...(f.invisible.length ? { invisible: f.invisible } : {}),
    ...(f.notes.length ? { notes: f.notes } : {}),
  };
}
