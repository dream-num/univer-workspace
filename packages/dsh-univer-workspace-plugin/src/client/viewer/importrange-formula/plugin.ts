import type { Dependency } from "@univerjs/core";
import {
  DependentOn,
  Injector,
  Plugin,
  registerDependencies,
  setDependencies,
  touchDependencies,
  UniverInstanceType,
} from "@univerjs/core";
import { UniverEmbedPlugin } from "@univerjs-pro/embed";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { ImportRangeFormulaController } from "./controllers/import-range-formula.controller.ts";
import { SHEETS_IMPORT_RANGE_FORMULA_PLUGIN_NAME } from "./common/plugin-name.ts";

/** Private Office plugin kept in-repo because no public IMPORTRANGE package exists. */
export class UniverSheetsImportRangeFormulaPlugin extends Plugin {
  static override pluginName = SHEETS_IMPORT_RANGE_FORMULA_PLUGIN_NAME;
  static override packageName = "dsh-univer-workspace-plugin";
  static override type = UniverInstanceType.UNIVER_SHEET;

  constructor(
    _config: undefined,
    protected readonly _injector: Injector,
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
