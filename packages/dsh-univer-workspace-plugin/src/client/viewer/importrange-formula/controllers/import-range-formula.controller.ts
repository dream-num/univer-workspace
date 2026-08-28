import type { IReferencedUnitManagerService } from "@univerjs-pro/embed";
import { Disposable, setDependencies, type IDisposable } from "@univerjs/core";
import { IReferencedUnitManagerService as ReferencedUnitManagerToken } from "@univerjs-pro/embed";
import { IRegisterFunctionService as RegisterFunctionServiceToken } from "@univerjs/engine-formula";
import {
  createImportRangeFunction,
  IMPORT_RANGE_FORMULA_NAME,
} from "../functions/import-range.function.ts";

interface ImportRangeFunctionRegistrar {
  registerAsyncFunction(params: {
    readonly name: string;
    readonly description: string;
    readonly func: ReturnType<typeof createImportRangeFunction>;
  }): IDisposable;
}

/** Registers IMPORTRANGE against the host's Embed reference manager. */
export class ImportRangeFormulaController extends Disposable {
  constructor(
    private readonly referencedUnitManager: IReferencedUnitManagerService,
    private readonly registerFunctionService: ImportRangeFunctionRegistrar,
  ) {
    super();
    this.disposeWithMe(
      this.registerFunctionService.registerAsyncFunction({
        name: IMPORT_RANGE_FORMULA_NAME,
        description: "Import a range from a referenced Univer sheet unit.",
        func: createImportRangeFunction(this.referencedUnitManager),
      }),
    );
  }
}

setDependencies(ImportRangeFormulaController, [
  ReferencedUnitManagerToken,
  RegisterFunctionServiceToken,
]);
