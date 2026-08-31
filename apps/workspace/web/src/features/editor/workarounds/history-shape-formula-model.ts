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
  UniverInstanceType,
  setDependencies,
} from "@univerjs/core";

/**
 * SDK workaround for the nested Univer instance created by History UI.
 *
 * In the current SDK cohort, the History loader can register the core Formula
 * plugin before Shape plugins. The Pro Formula plugin then appears satisfied by
 * name while its three models are absent, causing Shape history preview to fail
 * during dependency injection. Remove this entire workaround when the upstream
 * History/Shape plugin dependency is fixed; it is not Workspace History logic.
 */
class WorkspaceHistoryShapeFormulaModelPlugin extends Plugin {
  static override type = UniverInstanceType.UNIVER_UNKNOWN;
  static override pluginName =
    "UNIVER_WORKSPACE_HISTORY_SHAPE_FORMULA_MODEL_PLUGIN";
  static override packageName = "@univerjs/univer-workspace";

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

setDependencies(WorkspaceHistoryShapeFormulaModelPlugin, [Injector]);

let installed = false;

export function installHistoryShapeFormulaSdkWorkaround(): void {
  if (installed) return;
  installed = true;
  DependentOn(
    UniverLicensePlugin,
    UniverProFormulaEnginePlugin,
    UniverShapePlugin,
    WorkspaceHistoryShapeFormulaModelPlugin
  )(UniverShapeEditorPlugin);
}
