/**
 * The sheet viewer definition: the Univer Sheets collaboration presets, the
 * sheet locale packs, and the load call, adapted for the DSH client viewer.
 * @module dsh-univer-workspace-plugin/client/viewer-sheet
 */

import type { IPreset } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { UniverSheetsCollaborationPreset } from "@univerjs/preset-sheets-collaboration";
import { UniverSheetsAdvancedPreset } from "@univerjs/preset-sheets-advanced";
import { greenTheme } from "@univerjs/themes";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import UniverPresetSheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import UniverPresetSheetsAdvancedEnUS from "@univerjs/preset-sheets-advanced/locales/en-US";
import UniverPresetSheetsAdvancedZhCN from "@univerjs/preset-sheets-advanced/locales/zh-CN";
import UniverPresetSheetsCollaborationEnUS from "@univerjs/preset-sheets-collaboration/locales/en-US";
import UniverPresetSheetsCollaborationZhCN from "@univerjs/preset-sheets-collaboration/locales/zh-CN";
import { mergeLocales } from "@univerjs/presets";
import type { ViewerDefinition } from "./collaboration-viewer.tsx";

export const sheetViewerDefinition: ViewerDefinition = {
  label: "sheet",
  theme: greenTheme,
  locales: {
    "zh-CN": mergeLocales(
      UniverPresetSheetsCoreZhCN,
      UniverPresetSheetsAdvancedZhCN,
      UniverPresetSheetsCollaborationZhCN,
    ),
    "en-US": mergeLocales(
      UniverPresetSheetsCoreEnUS,
      UniverPresetSheetsAdvancedEnUS,
      UniverPresetSheetsCollaborationEnUS,
    ),
  },
  createPresets: (container, license): IPreset[] => [
    UniverSheetsCorePreset({ container, ribbonType: "grid" }),
    UniverSheetsAdvancedPreset({
      license,
      universerEndpoint: window.location.origin,
      print: { enforceWatermark: true },
    }),
    UniverSheetsCollaborationPreset({
      univerContainerId: container.id,
      universerEndpoint: window.location.origin,
    }),
  ],
  load: (univerAPI, unitId) => univerAPI.getCollaboration().loadSheetAsync(unitId),
};
