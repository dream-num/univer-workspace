/**
 * Compatibility registration for the published edit-history viewer.
 *
 * Office's history viewer creates a nested Univer composition.  In that
 * composition the Pro formula plugin can satisfy ShapeEditor's dependency by
 * name before the external-reference models have been installed.  Keep the
 * same small compatibility plugin in this package and install it once before
 * any viewer is created.
 */

import {
  FormulaCacheEligibilityService,
  FormulaLastValuePersistenceService,
  HostExternalReferenceModel,
  UniverProFormulaEnginePlugin,
} from "@univerjs-pro/engine-formula";
import { UniverShapePlugin } from "@univerjs-pro/engine-shape";
import { UniverLicensePlugin } from "@univerjs-pro/license";
import { UniverShapeEditorPlugin } from "@univerjs-pro/shape-editor";
import {
  DependentOn,
  Injector,
  Plugin,
  setDependencies,
  UniverInstanceType,
} from "@univerjs/core";

class HistoryShapeFormulaModelPlugin extends Plugin {
  static override type = UniverInstanceType.UNIVER_UNKNOWN;
  static override pluginName = "DSH_HISTORY_SHAPE_FORMULA_MODEL_PLUGIN";
  static override packageName = "dsh-univer-workspace-plugin";

  constructor(protected override _injector: Injector) {
    super();
  }

  override onStarting(): void {
    if (!this._injector.has(HostExternalReferenceModel)) {
      this._injector.add([HostExternalReferenceModel]);
    }
    if (!this._injector.has(FormulaCacheEligibilityService)) {
      this._injector.add([FormulaCacheEligibilityService]);
    }
    if (!this._injector.has(FormulaLastValuePersistenceService)) {
      this._injector.add([FormulaLastValuePersistenceService]);
    }
  }
}

setDependencies(HistoryShapeFormulaModelPlugin, [Injector]);

let installed = false;

/** Install the Office-compatible Shape/Formula dependency edge exactly once. */
export function installHistoryShapeFormulaCompatibility(): void {
  if (installed) return;
  installed = true;
  DependentOn(
    UniverLicensePlugin,
    UniverProFormulaEnginePlugin,
    UniverShapePlugin,
    HistoryShapeFormulaModelPlugin,
  )(UniverShapeEditorPlugin);
}
