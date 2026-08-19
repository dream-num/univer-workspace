import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExchangeFormat,
  FormulaCalculationMode,
  exportToFile,
  importFile,
} from "@univerjs-pro/exchange-node";
import {
  LocaleType,
  UniverInstanceType,
  type IWorkbookData,
} from "@univerjs/core";
import { describe, expect, it } from "vitest";

describe("Exchange Node runtime", () => {
  it("round-trips a real XLSX through the native binding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-exchange-node-"));
    const outputPath = join(directory, "roundtrip.xlsx");
    try {
      await exportToFile(workbookData(), outputPath, {
        format: ExchangeFormat.XLSX,
        formulaCalculation: FormulaCalculationMode.FORCED,
        type: UniverInstanceType.UNIVER_SHEET,
      });
      expect((await stat(outputPath)).size).toBeGreaterThan(0);
      const imported = await importFile(outputPath, {
        formulaCalculation: FormulaCalculationMode.FORCED,
        type: UniverInstanceType.UNIVER_SHEET,
      });
      expect(imported.sheets[imported.sheetOrder[0]!]!.cellData?.[0]?.[0]?.v).toBe("A1");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function workbookData(): IWorkbookData {
  return {
    appVersion: "",
    id: "sheet-unit",
    locale: LocaleType.EN_US,
    name: "Workbook",
    resources: [],
    rev: 1,
    sheetOrder: ["sheet-1"],
    sheets: {
      "sheet-1": {
        cellData: { 0: { 0: { v: "A1" } } },
        columnCount: 10,
        id: "sheet-1",
        name: "Sheet 1",
        rowCount: 20,
      },
    },
    styles: {},
  };
}
