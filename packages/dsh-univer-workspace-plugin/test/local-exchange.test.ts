import { describe, expect, it } from "vitest";
import {
  MAX_INITIAL_DATA_BYTES,
  LocalExchangeError,
  assertCompatibleExport,
  exportUnitData,
  importUnitData,
  inferExportFormat,
  inferImportUnitType,
} from "../src/provider/local-exchange.js";

describe("local Office exchange", () => {
  it("infers supported import types and rejects mismatches", () => {
    expect(inferImportUnitType("report.xlsx")).toBe("sheet");
    expect(inferImportUnitType("report.csv", "base")).toBe("base");
    expect(inferImportUnitType("deck.pptx")).toBe("slide");
    expect(() => inferImportUnitType("deck.pptx", "sheet")).toThrowError(LocalExchangeError);
    expect(() => inferImportUnitType("notes.txt")).toThrow(/Cannot import/);
  });

  it("checks export extensions and Unit type pairs before calling the SDK", () => {
    expect(inferExportFormat("book.xlsx")).toBe("xlsx");
    expect(inferExportFormat("book.tsv")).toBe("tsv");
    expect(() => inferExportFormat("book.pdf")).toThrowError(LocalExchangeError);
    expect(() => assertCompatibleExport("doc", "xlsx")).toThrow(/Cannot export a doc/);
    expect(() => assertCompatibleExport("sheet", "docx")).toThrow(/Cannot export a sheet/);
  });

  it("round-trips a Sheet through the pinned exchange SDK", async () => {
    const source = {
      id: "source-unit",
      name: "Source",
      sheetOrder: ["sheet-1"],
      sheets: {
        "sheet-1": {
          id: "sheet-1",
          name: "Sheet1",
          cellData: { 0: { 0: { v: "hello" }, 1: { v: 42 } } },
        },
      },
      locale: "enUS",
      styles: {},
      resources: [],
    };
    const xlsx = await exportUnitData(source, "sheet", "source.xlsx");
    const imported = await importUnitData(xlsx, "source.xlsx");
    expect(imported.unitType).toBe("sheet");
    expect(imported.data).toMatchObject({ name: "source" });
    expect(imported.data).toHaveProperty("sheets");
  });

  it("fails before the product request when serialized initial data is too large", async () => {
    const huge = {
      id: "source-unit",
      name: "Huge",
      sheetOrder: ["sheet-1"],
      sheets: {
        "sheet-1": {
          id: "sheet-1",
          name: "Sheet1",
          cellData: { 0: { 0: { v: "x".repeat(MAX_INITIAL_DATA_BYTES + 1) } } },
        },
      },
      locale: "enUS",
      styles: {},
      resources: [],
    };
    const xlsx = await exportUnitData(huge, "sheet", "huge.xlsx");
    await expect(importUnitData(xlsx, "huge.xlsx")).rejects.toMatchObject({ code: "INITIAL_DATA_TOO_LARGE" });
  });
});
