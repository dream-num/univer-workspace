import type { HtmlCellReference, HtmlViewDocument } from "./types.js";

export function parseCellReference(value: string): HtmlCellReference {
  const parts = value.split(":");
  if (parts.length !== 3) throw new Error("Expected <unitId>:<sheetId>:<cell address>.");
  const unitId = decodeURIComponent(parts[0]!);
  const sheetId = decodeURIComponent(parts[1]!);
  if (!unitId.trim() || !sheetId.trim()) throw new Error("Unit ID and Sheet ID are required.");
  const match = /^([A-Z]+)([1-9][0-9]*)$/i.exec(parts[2]!);
  if (!match) throw new Error("Expected a single A1 cell address.");
  const row = Number(match[2]) - 1;
  const col = [...match[1]!.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col))
    throw new Error("Cell address is too large.");
  return { unitId, sheetId, row, col };
}
export function cellReferenceKey(ref: HtmlCellReference): string {
  return JSON.stringify([ref.unitId, ref.sheetId, ref.row, ref.col]);
}
export function getHtmlViewUnitIds(document: HtmlViewDocument): string[] {
  return [...new Set(document.bindings.map((binding) => binding.reference.unitId))];
}
