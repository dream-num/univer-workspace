import type { IReferencedUnitManagerService } from "@univerjs-pro/embed";
import { EmbedError, EmbedErrorCode } from "@univerjs-pro/embed";
import { ErrorType, StringValueObject } from "@univerjs/engine-formula";
import { describe, expect, it, vi } from "vitest";
import {
  createImportRangeFunction,
  type IImportRangeFunctionRegistrar,
  ImportRangeFormulaController,
  IMPORT_RANGE_FORMULA_NAME,
} from "../render-runtime/src/preset/import-range-formula.js";

describe("ImportRangeFormulaController", () => {
  it("registers IMPORTRANGE as an async formula", () => {
    const referencedUnitManager = { readData: vi.fn() } as unknown as IReferencedUnitManagerService;
    const disposable = { dispose: vi.fn() };
    const registerAsyncFunction = vi.fn(() => disposable);
    const controller = new ImportRangeFormulaController(referencedUnitManager, {
      registerAsyncFunction,
    } as IImportRangeFunctionRegistrar);

    expect(registerAsyncFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_RANGE_FORMULA_NAME,
        func: expect.any(Function),
      }),
    );

    controller.dispose();
    expect(disposable.dispose).toHaveBeenCalledOnce();
  });
});

describe("createImportRangeFunction", () => {
  it("reads a sheet range from referenced-unit manager", async () => {
    const readData = vi.fn(async () => ({
      values: [
        ["区域", "销售额"],
        ["华东", 128000],
      ],
    }));
    const formula = createImportRangeFunction({
      readData,
    } as unknown as IReferencedUnitManagerService);

    await expect(formula("#unit=sales-source&type=sheet", "'销售明细'!A1:B2")).resolves.toEqual([
      ["区域", "销售额"],
      ["华东", 128000],
    ]);
    expect(readData).toHaveBeenCalledWith(
      expect.objectContaining({
        file: { kind: "self" },
        unit: { selector: "sales-source", type: "sheet" },
        part: {
          kind: "range",
          ref: "'销售明细'!A1:B2",
          sheetName: "销售明细",
          range: "A1:B2",
        },
      }),
    );
  });

  it("accepts formula scalar string value shapes", async () => {
    const readData = vi.fn(async () => ({ values: [["ok"]] }));
    const formula = createImportRangeFunction({
      readData,
    } as unknown as IReferencedUnitManagerService);

    await expect(
      formula(StringValueObject.create("#unit=sales-source&type=sheet"), [["'销售明细'!A1"]]),
    ).resolves.toEqual([["ok"]]);
  });

  it("returns formula errors for unsupported arguments and references", async () => {
    const readData = vi.fn(async () => ({ values: [["unused"]] }));
    const formula = createImportRangeFunction({
      readData,
    } as unknown as IReferencedUnitManagerService);

    await expect(formula(1, "Sheet1!A1")).resolves.toBe(ErrorType.VALUE);
    await expect(formula("#unit=sales-source&type=doc", "Sheet1!A1")).resolves.toBe(ErrorType.REF);
    await expect(formula("#unit=sales-source&type=sheet", "A1:B2")).resolves.toBe(ErrorType.REF);
    expect(readData).not.toHaveBeenCalled();
  });

  it("returns #REF! for missing referenced data", async () => {
    const formula = createImportRangeFunction({
      readData: vi.fn(async () => {
        throw new EmbedError(EmbedErrorCode.LocalRuntimeResourceRefDataUnitNotFound);
      }),
    } as unknown as IReferencedUnitManagerService);

    await expect(formula("#unit=missing&type=sheet", "Sheet1!A1")).resolves.toBe(ErrorType.REF);
  });

  it("propagates provider failures", async () => {
    const formula = createImportRangeFunction({
      readData: vi.fn(async () => {
        throw new Error("provider failed");
      }),
    } as unknown as IReferencedUnitManagerService);

    await expect(formula("#unit=sales-source&type=sheet", "Sheet1!A1")).rejects.toThrow(
      "provider failed",
    );
  });
});
