// Hand-written snapshots for the tests of the pure lens code (read, find).
import type { Snapshot } from "../../../src/sheet-lens/engine/types.js";
import { sheetCellsOf } from "../../../src/sheet-lens/lens/index.js";

export type Cells = Record<number, Record<number, Record<string, unknown>>>;
export interface SheetInit {
  name?: string;
  cells?: Cells;
  extra?: Record<string, unknown>;
}

export const snapshot = (...sheets: SheetInit[]): Snapshot =>
  ({
    id: "wb",
    name: "wb",
    sheetOrder: sheets.map((_, i) => `id${i}`),
    styles: { bold: { bl: 1 }, red: { bg: { rgb: "#ff0000" }, cl: { rgb: "#0000ff" } } },
    sheets: Object.fromEntries(
      sheets.map((s, i) => [
        `id${i}`,
        {
          id: `id${i}`,
          name: s.name ?? `Sheet${i + 1}`,
          rowCount: 100,
          columnCount: 26,
          cellData: s.cells ?? {},
          ...s.extra,
        },
      ]),
    ),
  }) as unknown as Snapshot;

/** The display text of a test cell is its value (numbers use String()) unless `show` says otherwise. */
export const sheetOf = (
  data: Snapshot,
  index = 0,
  show?: (row: number, column: number) => string | undefined,
) =>
  sheetCellsOf(data, "wb", index, (id, r, c) => {
    const v = (data.sheets[id]?.cellData as Cells | undefined)?.[r]?.[c]?.v;
    return show?.(r, c) ?? (v === undefined || v === null ? "" : String(v));
  });

export const text = (v: unknown, extra: Record<string, unknown> = {}) => ({ v, t: 1, ...extra });
export const num = (v: number, extra: Record<string, unknown> = {}) => ({ v, t: 2, ...extra });
