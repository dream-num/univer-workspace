// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/outline/value.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
import type { SnapshotCell as ICellData } from "../../engine/types.js";
import { isErrorCell } from "../../platform/cell-error.js";

export type CellValue = string | number | boolean | null;
export type CellType = "number" | "text" | "bool" | "error" | "empty";
const errors = new Set([
  "#DIV/0!",
  "#NAME?",
  "#VALUE!",
  "#NUM!",
  "#N/A",
  "#CYCLE!",
  "#REF!",
  "#SPILL!",
  "#CALC!",
  "#ERROR!",
  "#GETTING_DATA",
  "#NULL!",
]);
export const hasFormula = (cell: ICellData | null | undefined): boolean =>
  Boolean(cell?.f || cell?.si);

/** Decode storage, independently of display text and structural blankness. */
export function normalizeCell(cell: ICellData | null | undefined): {
  value: CellValue;
  type: CellType;
} {
  const v = cell?.v ?? cell?.p?.body?.dataStream?.replace(/\r\n?$/, "");
  if (v === undefined || v === null) return { value: null, type: "empty" };
  if (v === "") return { value: "", type: "text" };
  if (cell?.t === 3 || typeof v === "boolean")
    return {
      value: v === true || v === 1 || v === "1" || String(v).toUpperCase() === "TRUE",
      type: "bool",
    };
  if (isErrorCell(cell, (s) => errors.has(s))) return { value: String(v), type: "error" };
  if (
    typeof v === "number" ||
    (cell?.t === 2 && String(v).trim() !== "" && Number.isFinite(Number(v)))
  )
    return { value: Number(v), type: "number" };
  return { value: String(v), type: "text" };
}

/** Used bounds and merge warnings include formulas, but exclude stored empty strings and styles. */
export function hasCellContent(cell: ICellData | null | undefined): boolean {
  const { value } = normalizeCell(cell);
  return hasFormula(cell) || (value !== null && value !== "");
}

/** Presence does not establish that a formula cache is up to date. */
export const formulaCache = (cell: ICellData | null | undefined): "present" | "missing" | null =>
  hasFormula(cell) ? (cell?.v === undefined || cell.v === null ? "missing" : "present") : null;
