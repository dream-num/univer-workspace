import { ICommandService, IPermissionService, IUniverInstanceService, Univer, UniverInstanceType, type UnitModel } from "@univerjs/core";
import { CollaborationController } from "@univerjs-pro/collaboration-client";
import type { UnitComparisonUniverFactory, UnitComparisonViewerValue } from "@univer/unit-comparison-viewer";
import { EMPTY } from "rxjs";
import { setDocumentPermissionValue } from "@univerjs/docs";
import { UnitAction } from "@univerjs/protocol";
import { LOCALE_PACKS, localeKeyOf } from "./locales.ts";
import { blockLocalEditingCommands, enforceSheetViewerReadOnlyPermissions } from "./readonly.ts";
import { registerViewerRendering, ViewAssetIoOwner } from "./rendering.ts";
import { installHistoryShapeFormulaCompatibility } from "./history-compatibility.ts";


/** The host supplies rendering; the shared viewer owns decoded Unit mounting. */
export function comparisonUniverFactory(license: string): UnitComparisonUniverFactory {
  return async (options) => {
    installHistoryShapeFormulaCompatibility();
    options.container.id ||= `uwh-comparison-${crypto.randomUUID()}`;
    const univer = new Univer({
      locale: options.locale,
      locales: { [options.locale]: LOCALE_PACKS[localeKeyOf(options.locale)] },
      darkMode: options.darkMode,
    });
    try {
      // Global collaboration Facade mixins also run in local snapshot runtimes.
      // This composition-only bridge matches the Workspace Browser integration;
      // no collaboration transport or mutable remote document is attached.
      univer.__getInjector().add([CollaborationController, {
        useValue: { entityInit$: EMPTY } as unknown as CollaborationController,
      }]);
      registerViewerRendering(univer, {
        container: options.container.id,
        assetIoOwner: ViewAssetIoOwner.Local,
        license,
        workbenchChrome: "hidden",
        readOnly: true,
        unitType: options.unitType,
      });
      blockLocalEditingCommands(univer.__getInjector().get(ICommandService));
      const docPermissions = univer.__getInjector().get(IUniverInstanceService)
        .getTypeOfUnitAdded$(UniverInstanceType.UNIVER_DOC).subscribe(({ unit }) => {
          // Sheets also create internal Docs for their cell editor. Those are
          // rendering helpers; sheet permissions already protect the real Unit.
          if (options.unitType !== UniverInstanceType.UNIVER_DOC) return;
          setDocumentPermissionValue(univer.__getInjector().get(IPermissionService),
            unit.getUnitId(), unit.getUnitId(), UnitAction.Edit, false);
        });
      return { univer, dispose: () => { docPermissions.unsubscribe(); univer.dispose(); } };
    } catch (error) {
      univer.dispose();
      throw error;
    }
  };
}


export function createComparisonUnit(univer: Univer, comparison: UnitComparisonViewerValue): void {
  const data = comparison.right.unitData;
  if (data === null) throw new Error("The selected version has no document.");
  univer.createUnit<typeof data, UnitModel>(comparison.result.unit.type, structuredClone(data));
  if (comparison.result.unit.type === UniverInstanceType.UNIVER_SHEET) {
    enforceSheetViewerReadOnlyPermissions(univer.__getInjector().get(IPermissionService), data.id);
  }
}
