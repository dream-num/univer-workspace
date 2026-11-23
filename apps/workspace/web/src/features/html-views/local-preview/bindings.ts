import type { HtmlCellReference, HtmlRangeReference, HtmlViewBinding } from "@univerjs-labs/html-view";

export const BINDING_WARNINGS = ["empty", "header-text", "formula-under-control", "date-serial"] as const;
export type BindingWarning = (typeof BINDING_WARNINGS)[number];
export const MAX_BINDING_SAMPLES = 60;

export interface BindingSample {
  attribute: string;
  reference: string;
  sample: unknown;
  warnings: BindingWarning[];
  /** For the panel only; the report sends the four fields above. */
  binding: HtmlViewBinding;
  sheetName: string | undefined;
}

export interface CellFacts {
  value: unknown;
  /** The value one row down, to tell a header from a number. */
  below: unknown;
  formula: boolean;
  dateFormat: boolean;
}

export interface BindingProbe {
  cell(reference: HtmlCellReference): CellFacts | undefined;
  range(reference: HtmlRangeReference): unknown[][] | undefined;
  sheetName(reference: { unitId: string; sheetId: string }): string | undefined;
}

const ATTRIBUTES = {
  text: "data-univer-cell-text",
  model: "data-univer-cell-model",
  cell: "data-univer-cell-subscribe",
  range: "data-univer-range-subscribe",
} as const;

export const isEmpty = (value: unknown) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");

function columnName(column: number): string {
  let name = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
const address = (row: number, column: number) => `${columnName(column)}${row + 1}`;
const start = (binding: HtmlViewBinding) => binding.kind === "range"
  ? { row: binding.reference.range.startRow, col: binding.reference.range.startColumn } : binding.reference;

/** "B9" for a cell, "A1:F6" for a range. */
export function bindingAddress(binding: HtmlViewBinding): string {
  if (binding.kind !== "range") return address(binding.reference.row, binding.reference.col);
  const { startRow, startColumn, endRow, endColumn } = binding.reference.range;
  return `${address(startRow, startColumn)}:${address(endRow, endColumn)}`;
}

export const byPosition = (a: HtmlViewBinding, b: HtmlViewBinding) => start(a).row - start(b).row || start(a).col - start(b).col;
const sheetPrefix = (reference: { unitId: string; sheetId: string }) => `${encodeURIComponent(reference.unitId)}:${encodeURIComponent(reference.sheetId)}`;
const clip = (value: unknown) => (typeof value === "string" && value.length > 200 ? `${value.slice(0, 200)}…` : value ?? null);

export function sampleBindings(bindings: readonly HtmlViewBinding[], probe: BindingProbe): BindingSample[] {
  return bindings.slice(0, MAX_BINDING_SAMPLES).map((binding): BindingSample => {
    const attribute = ATTRIBUTES[binding.kind];
    const warnings: BindingWarning[] = [];
    const reference = `${sheetPrefix(binding.reference)}:${bindingAddress(binding)}`;
    const sheetName = probe.sheetName(binding.reference);
    if (binding.kind === "range") {
      const rows = probe.range(binding.reference);
      if (!rows || rows.every((row) => row.every(isEmpty))) warnings.push("empty");
      return { attribute, reference, warnings, sample: (rows?.[0] ?? []).slice(0, 20).map(clip), binding, sheetName };
    }
    const facts = probe.cell(binding.reference);
    if (!facts || isEmpty(facts.value)) warnings.push("empty");
    else {
      if (typeof facts.value === "string" && Number.isNaN(Number(facts.value)) && typeof facts.below === "number") warnings.push("header-text");
      if (binding.kind === "model" && facts.formula) warnings.push("formula-under-control");
      if (typeof facts.value === "number" && facts.dateFormat) warnings.push("date-serial");
    }
    return { attribute, reference, warnings, sample: clip(facts?.value), binding, sheetName };
  });
}

interface ProbeEngine {
  getCellState(reference: { sheetId: string; row: number; col: number }): { value: unknown };
  getRangeState(reference: { sheetId: string; range: HtmlRangeReference["range"] }): { value: readonly (readonly unknown[])[] };
  readCellMeta(sheetId: string, row: number, col: number): { formula: boolean; dateFormat: boolean };
  readSheetName(sheetId: string): string | undefined;
}

/** Reads from the engines the page already loaded; a unit that never loaded reads as empty. */
export function engineProbe(engines: ReadonlyMap<string, ProbeEngine>): BindingProbe {
  const attempt = <T>(read: () => T): T | undefined => { try { return read(); } catch { return undefined; } };
  return {
    cell: ({ unitId, sheetId, row, col }) => attempt(() => {
      const engine = engines.get(unitId);
      if (!engine) return undefined;
      return { value: engine.getCellState({ sheetId, row, col }).value, below: engine.getCellState({ sheetId, row: row + 1, col }).value,
        ...engine.readCellMeta(sheetId, row, col) };
    }),
    range: ({ unitId, sheetId, range }) => attempt(() => engines.get(unitId)?.getRangeState({ sheetId, range }).value.map((row) => [...row])),
    sheetName: ({ unitId, sheetId }) => attempt(() => engines.get(unitId)?.readSheetName(sheetId)),
  };
}
