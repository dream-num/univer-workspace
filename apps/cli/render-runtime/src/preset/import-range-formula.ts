import type { IReferencedUnitManagerService, IResourceRef } from "@univerjs-pro/embed";
import type { Dependency, IDisposable } from "@univerjs/core";
import {
  DependentOn,
  Disposable,
  Injector,
  Plugin,
  registerDependencies,
  setDependencies,
  touchDependencies,
  UniverInstanceType,
} from "@univerjs/core";
import {
  EmbedError,
  EmbedErrorCode,
  IReferencedUnitManagerService as IReferencedUnitManagerServiceToken,
  parseResourceRef,
  UniverEmbedPlugin,
} from "@univerjs-pro/embed";
import type {
  FormulaFunctionResultValueType,
  FormulaFunctionValueType,
} from "@univerjs/engine-formula";
import {
  BaseValueObject,
  deserializeRangeWithSheet,
  ErrorType,
  IRegisterFunctionService as IRegisterFunctionServiceToken,
  type PrimitiveValueType,
  serializeRange,
} from "@univerjs/engine-formula";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";

export const IMPORT_RANGE_FORMULA_NAME = "IMPORTRANGE";

const SHEETS_IMPORT_RANGE_FORMULA_PLUGIN_NAME = "SHEETS_IMPORT_RANGE_FORMULA_PLUGIN";
const READ_DATA_REF_ERROR_CODES = new Set<EmbedErrorCode>([
  EmbedErrorCode.LocalRuntimeResourceRefUnitNotFound,
  EmbedErrorCode.LocalRuntimeResourceRefDataUnitNotFound,
  EmbedErrorCode.LocalRuntimeResourceRefDataSheetNotFound,
]);

interface RangeSelector {
  ref: string;
  range: string;
  sheetName: string;
}

export interface IImportRangeFunctionRegistrar {
  registerAsyncFunction(params: {
    name: string;
    description: string;
    func: ReturnType<typeof createImportRangeFunction>;
  }): IDisposable;
}

export function createImportRangeFunction(
  referencedUnitManager: IReferencedUnitManagerService,
): (...args: FormulaFunctionValueType[]) => Promise<FormulaFunctionResultValueType> {
  return async (...args) => {
    if (args.length !== 2) {
      return ErrorType.VALUE;
    }

    const refText = normalizeScalarStringArgument(args[0]);
    const rangeText = normalizeScalarStringArgument(args[1]);
    if (refText === undefined || rangeText === undefined) {
      return ErrorType.VALUE;
    }

    const ref = parseSheetResourceRef(refText);
    const selector = parseRangeSelector(rangeText);
    if (ref === undefined || selector === undefined) {
      return ErrorType.REF;
    }

    return await readReferencedRangeValues(referencedUnitManager, {
      ...ref,
      part: {
        kind: "range",
        ref: selector.ref,
        sheetName: selector.sheetName,
        range: selector.range,
      },
    });
  };
}

export class ImportRangeFormulaController extends Disposable {
  constructor(
    private readonly _referencedUnitManager: IReferencedUnitManagerService,
    private readonly _registerFunctionService: IImportRangeFunctionRegistrar,
  ) {
    super();

    this.disposeWithMe(
      this._registerFunctionService.registerAsyncFunction({
        name: IMPORT_RANGE_FORMULA_NAME,
        description: "Import a range from a referenced Univer sheet unit.",
        func: createImportRangeFunction(this._referencedUnitManager),
      }),
    );
  }
}

setDependencies(ImportRangeFormulaController, [
  IReferencedUnitManagerServiceToken,
  IRegisterFunctionServiceToken,
]);

export class UniverSheetsImportRangeFormulaPlugin extends Plugin {
  static override pluginName = SHEETS_IMPORT_RANGE_FORMULA_PLUGIN_NAME;
  static override packageName = "@univer-cli/univer-render-runtime";
  static override type = UniverInstanceType.UNIVER_SHEET;

  constructor(
    _config: undefined,
    protected override readonly _injector: Injector,
  ) {
    super();
  }

  override onStarting(): void {
    registerDependencies(this._injector, [[ImportRangeFormulaController]] as Dependency[]);
  }

  override onReady(): void {
    touchDependencies(this._injector, [[ImportRangeFormulaController]]);
  }
}

DependentOn(UniverSheetsFormulaPlugin, UniverEmbedPlugin)(UniverSheetsImportRangeFormulaPlugin);
setDependencies(UniverSheetsImportRangeFormulaPlugin, [Injector], 1);

async function readReferencedRangeValues(
  referencedUnitManager: IReferencedUnitManagerService,
  ref: Parameters<IReferencedUnitManagerService["readData"]>[0],
): Promise<FormulaFunctionResultValueType> {
  try {
    const result = await referencedUnitManager.readData(ref);
    return result.values;
  } catch (error) {
    if (error instanceof EmbedError && READ_DATA_REF_ERROR_CODES.has(error.code)) {
      return ErrorType.REF;
    }
    throw error;
  }
}

function normalizeScalarStringArgument(
  value: FormulaFunctionValueType | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const cellValue = getSingleMatrixValue(value);
    return typeof cellValue === "string" ? cellValue : undefined;
  }

  if (value instanceof BaseValueObject) {
    return value.isString() ? String(value.getValue()) : undefined;
  }

  return undefined;
}

function getSingleMatrixValue(value: PrimitiveValueType[][]): PrimitiveValueType | undefined {
  if (value.length !== 1 || value[0]?.length !== 1) {
    return undefined;
  }
  return value[0][0];
}

function parseSheetResourceRef(input: string): IResourceRef | undefined {
  try {
    const ref = parseResourceRef(input);
    return ref.file.kind === "self" && ref.unit.type === "sheet" && ref.unit.selector !== ""
      ? ref
      : undefined;
  } catch {
    return undefined;
  }
}

function parseRangeSelector(input: string): RangeSelector | undefined {
  try {
    const parsed = deserializeRangeWithSheet(input);
    if (parsed.unitId !== "" || parsed.sheetName === "") {
      return undefined;
    }
    return {
      ref: input,
      sheetName: parsed.sheetName,
      range: serializeRange(parsed.range),
    };
  } catch {
    return undefined;
  }
}
