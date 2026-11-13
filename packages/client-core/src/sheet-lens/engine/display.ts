// Display text of cells (what a person sees in a spreadsheet) from a snapshot, without a Univer instance.
//
// RFC 04 requires one source for display text: Univer's own. On a live model that is `getDisplayValues()`, which runs
// the cell through the numfmt cell-content interceptor (@univerjs/sheets-numfmt, SheetsNumfmtCellContentController) and
// then `getDisplayValueFromCell`. Both pieces are reproduced here with the same Univer functions (`numfmt.format`,
// `isDefaultFormat`, `isTextFormat`, `getDisplayValueFromCell`) so no number format is rendered by uxl code.
// test/engine/display.test.ts compares this reader with `getDisplayValues()` of a real instance on the fixtures.
import type { Snapshot, SnapshotCell } from "./types.js";

export type DisplayReader = (sheetId: string, row: number, column: number) => string;

type Core = typeof import("@univerjs/core");
interface StyleLike {
  n?: { pattern?: string } | null;
}
// CellValueType: STRING 1, NUMBER 2, BOOLEAN 3, FORCE_STRING 4
const NUMBER = 2;
const BOOLEAN = 3;
const FORCE_STRING = 4;

/** `checkCellValueType` of @univerjs/sheets: the type a value would be given when typed into a cell. */
function checkType(core: Core, v: unknown, t: unknown): number {
  if (typeof v === "string") {
    if (core.isRealNum(v)) {
      if ((+v === 0 || +v === 1) && t === BOOLEAN) return BOOLEAN;
      if (t !== 1 && t !== FORCE_STRING && core.willLoseNumericPrecision(v)) return FORCE_STRING;
      return NUMBER;
    }
    return core.isBooleanString(v) ? BOOLEAN : 1;
  }
  if (typeof v === "number") return (v === 0 || v === 1) && t === BOOLEAN ? BOOLEAN : NUMBER;
  return typeof v === "boolean" ? BOOLEAN : FORCE_STRING;
}

/** `stripErrorMargin` of @univerjs/engine-formula (not re-exported by core): 0.1 + 0.2 is shown as 0.3. Pinned by display.test.ts. */
function strip(num: number, precision = 15): number {
  if (Math.floor(Math.abs(num)).toString().length >= precision) return num;
  return Number.parseFloat(num.toPrecision(precision));
}
function stripErrorMargin(num: number, precision = 12, tolerance = 1e-10): number {
  const stripped = strip(num, precision);
  return Math.abs(num - stripped) < tolerance ? stripped : strip(num);
}

/** What @univerjs/sheets shows for a number in General format (its CELL_CONTENT interceptor with priority 11). */
function generalNumber(core: Core, cell: SnapshotCell): string | undefined {
  if (cell.t !== NUMBER || !core.isRealNum(cell.v)) return undefined;
  const text = String(stripErrorMargin(Number(cell.v)));
  return text.includes("e") ? text.toUpperCase() : text;
}

export async function createDisplayReader(snapshot: Snapshot): Promise<DisplayReader> {
  const core: Core = await import("@univerjs/core");
  const locale = core.getNumfmtLocaleTag(snapshot.locale);
  const dateSystem = ((snapshot as { dateSystem?: string }).dateSystem ?? "date1900") as never;
  const styles = (snapshot.styles ?? {}) as Record<string, StyleLike | undefined>;

  return (sheetId, row, column) => {
    const cell = snapshot.sheets[sheetId]?.cellData?.[row]?.[column];
    if (!cell) return "";
    const plain = () => core.getDisplayValueFromCell(cell);
    if (cell.v === undefined || cell.v === null || cell.t === BOOLEAN || cell.t === FORCE_STRING)
      return plain();
    const style =
      typeof cell.s === "string" ? styles[cell.s] : (cell.s as StyleLike | null | undefined);
    const pattern = style?.n?.pattern;
    if (core.isDefaultFormat(pattern)) return generalNumber(core, cell) ?? plain();
    if (core.isTextFormat(pattern)) return plain();
    // The cell is formatted as a number when its type says so, or (cell.t is not NUMBER) when its value reads as one.
    if (cell.t !== NUMBER && checkType(core, cell.v, cell.t) !== NUMBER) return plain();
    const value = Number(cell.v);
    let text: string;
    try {
      text = core.numfmt.format(pattern as string, value, { locale, dateSystem, throws: false });
    } catch {
      text = String(value);
    }
    return core.getDisplayValueFromCell({ ...cell, v: text, t: NUMBER });
  };
}
