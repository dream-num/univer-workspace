import type { HtmlViewBinding } from "@univerjs-labs/html-view";
import { expect, it } from "vitest";
import { bindingAddress, byPosition, engineProbe, sampleBindings, type BindingProbe, type CellFacts } from "./bindings";

const cell = (kind: "text" | "model" | "cell", row: number, col: number): Extract<HtmlViewBinding, { kind: "text" | "model" | "cell" }> =>
  ({ id: "0", kind, disabled: false, reference: { unitId: "u 1", sheetId: "s", row, col } });
const facts = (overrides: Partial<CellFacts>): CellFacts => ({ value: 5, below: null, formula: false, dateFormat: false, ...overrides });
const probe = (cells: Record<string, CellFacts>, ranges: Record<string, unknown[][]> = {}): BindingProbe => ({
  cell: ({ row, col }) => cells[`${row},${col}`], range: ({ range }) => ranges[`${range.startRow},${range.startColumn}`],
  sheetName: ({ sheetId }) => sheetId === "s" ? "Sales" : undefined,
});

it("samples a cell, writes its reference back as unit:sheet:A1, and keeps the binding and sheet name for the panel", () => {
  const binding = cell("text", 1, 27);
  const [sample] = sampleBindings([binding], probe({ "1,27": facts({ value: "Alpha" }) }));
  expect(sample).toEqual({ attribute: "data-univer-cell-text", reference: "u%201:s:AB2", sample: "Alpha", warnings: [], binding, sheetName: "Sales" });
});

it("names a binding by its A1 address and orders bindings by row, then column", () => {
  const range: HtmlViewBinding = { id: "r", kind: "range", disabled: false, reference: { unitId: "u", sheetId: "s", range: { startRow: 0, endRow: 5, startColumn: 0, endColumn: 5 } } };
  expect([cell("cell", 8, 1), cell("text", 1, 2), range, cell("text", 1, 0)].sort(byPosition).map(bindingAddress)).toEqual(["A1:F6", "A2", "C2", "B9"]);
});

it("warns on an empty value, a missing unit, and an all-empty range", () => {
  const range: HtmlViewBinding = { id: "1", kind: "range", disabled: false, reference: { unitId: "u", sheetId: "s", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } } };
  const result = sampleBindings([cell("text", 0, 0), cell("cell", 5, 5), range, { ...range, reference: { ...range.reference, range: { ...range.reference.range, startRow: 3 } } }],
    probe({ "0,0": facts({ value: "  " }) }, { "0,0": [[null, ""], [null, null]], "3,0": [["Month", "Sales"], [1, 2]] }));
  expect(result.map((item) => item.warnings)).toEqual([["empty"], ["empty"], ["empty"], []]);
  expect(result[3]).toMatchObject({ attribute: "data-univer-range-subscribe", reference: "u:s:A4:B2", sample: ["Month", "Sales"] });
});

it("warns on header text where the cell below holds a number, but not on a plain title", () => {
  const result = sampleBindings([cell("text", 0, 0), cell("model", 0, 1), cell("text", 5, 0)],
    probe({ "0,0": facts({ value: "Quantity", below: 10 }), "0,1": facts({ value: "Amount", below: 3 }), "5,0": facts({ value: "Report", below: "Q1" }) }));
  expect(result.map((item) => item.warnings)).toEqual([["header-text"], ["header-text"], []]);
});

it("warns when a form control is bound to a formula cell, not a display binding", () => {
  const result = sampleBindings([cell("model", 0, 0), cell("text", 0, 0)], probe({ "0,0": facts({ formula: true }) }));
  expect(result.map((item) => item.warnings)).toEqual([["formula-under-control"], []]);
});

it("warns on a date serial only for a number in a date format", () => {
  const result = sampleBindings([cell("text", 0, 0), cell("text", 1, 0), cell("text", 2, 0)],
    probe({ "0,0": facts({ value: 45000, dateFormat: true }), "1,0": facts({ value: "2023-03-15", dateFormat: true }), "2,0": facts({ value: 45000 }) }));
  expect(result.map((item) => item.warnings)).toEqual([["date-serial"], [], []]);
});

it("caps samples at 60 and clips long text", () => {
  const many = Array.from({ length: 80 }, (_, i) => cell("text", i, 0));
  expect(sampleBindings(many, probe({ "0,0": facts({ value: "x".repeat(500) }) }))).toHaveLength(60);
  expect((sampleBindings([cell("text", 0, 0)], probe({ "0,0": facts({ value: "x".repeat(500) }) }))[0]!.sample as string).length).toBe(201);
});

it("reads through the loaded engines and treats a unit that never loaded as empty", () => {
  const engine = {
    getCellState: ({ row }: { row: number }) => ({ value: row === 0 ? "Total" : 7 }),
    getRangeState: () => ({ value: [[1, 2]] }),
    readCellMeta: () => ({ formula: true, dateFormat: false }),
    readSheetName: (sheetId: string) => sheetId === "s" ? "Q1" : undefined,
  };
  const result = sampleBindings([cell("model", 0, 0), { ...cell("text", 0, 0), reference: { unitId: "other", sheetId: "s", row: 0, col: 0 } }], engineProbe(new Map([["u 1", engine]])));
  expect(result.map((item) => item.warnings)).toEqual([["header-text", "formula-under-control"], ["empty"]]);
  expect(result.map((item) => item.sheetName)).toEqual(["Q1", undefined]);
  expect(engineProbe(new Map([["u", { ...engine, getCellState: () => { throw new Error("not ready"); } }]])).cell({ unitId: "u", sheetId: "s", row: 0, col: 0 })).toBeUndefined();
});
