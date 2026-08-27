/**
 * The sheet viewer definition: the Univer Sheets preset stack aligned with the
 * Workspace Browser editor (core, drawing, feature presets, advanced), minus
 * the SheetsCollaboration preset — the collaboration core/client/UI plugins
 * are added by CollaborationViewer with the harness proxy URLs, and adding
 * the preset here would register them twice with endpoints that bypass the
 * proxy, failing the Univer mount.
 * @module dsh-univer-workspace-plugin/client/viewer-sheet
 */

import type { IPreset } from "@univerjs/presets";
import { UniverSheetsAdvancedPreset } from "@univerjs/preset-sheets-advanced";
import UniverPresetSheetsAdvancedEnUS from "@univerjs/preset-sheets-advanced/locales/en-US";
import UniverPresetSheetsAdvancedZhCN from "@univerjs/preset-sheets-advanced/locales/zh-CN";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import UniverPresetSheetsConditionalFormattingEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import UniverPresetSheetsConditionalFormattingZhCN from "@univerjs/preset-sheets-conditional-formatting/locales/zh-CN";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import UniverPresetSheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import UniverPresetSheetsDataValidationEnUS from "@univerjs/preset-sheets-data-validation/locales/en-US";
import UniverPresetSheetsDataValidationZhCN from "@univerjs/preset-sheets-data-validation/locales/zh-CN";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import UniverPresetSheetsDrawingEnUS from "@univerjs/preset-sheets-drawing/locales/en-US";
import UniverPresetSheetsDrawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import UniverPresetSheetsFilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import UniverPresetSheetsFilterZhCN from "@univerjs/preset-sheets-filter/locales/zh-CN";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import UniverPresetSheetsFindReplaceEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import UniverPresetSheetsFindReplaceZhCN from "@univerjs/preset-sheets-find-replace/locales/zh-CN";
import { UniverSheetsHyperLinkPreset } from "@univerjs/preset-sheets-hyper-link";
import UniverPresetSheetsHyperLinkEnUS from "@univerjs/preset-sheets-hyper-link/locales/en-US";
import UniverPresetSheetsHyperLinkZhCN from "@univerjs/preset-sheets-hyper-link/locales/zh-CN";
import { UniverSheetsNotePreset } from "@univerjs/preset-sheets-note";
import UniverPresetSheetsNoteEnUS from "@univerjs/preset-sheets-note/locales/en-US";
import UniverPresetSheetsNoteZhCN from "@univerjs/preset-sheets-note/locales/zh-CN";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import UniverPresetSheetsSortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import UniverPresetSheetsSortZhCN from "@univerjs/preset-sheets-sort/locales/zh-CN";
import { UniverSheetsTablePreset } from "@univerjs/preset-sheets-table";
import UniverPresetSheetsTableEnUS from "@univerjs/preset-sheets-table/locales/en-US";
import UniverPresetSheetsTableZhCN from "@univerjs/preset-sheets-table/locales/zh-CN";
import { UniverSheetsThreadCommentPreset } from "@univerjs/preset-sheets-thread-comment";
import UniverPresetSheetsThreadCommentEnUS from "@univerjs/preset-sheets-thread-comment/locales/en-US";
import UniverPresetSheetsThreadCommentZhCN from "@univerjs/preset-sheets-thread-comment/locales/zh-CN";
import { greenTheme } from "@univerjs/themes";
import { mergeLocales } from "@univerjs/presets";
import type { ViewerDefinition } from "./collaboration-viewer.tsx";

export const sheetViewerDefinition: ViewerDefinition = {
  label: "sheet",
  theme: greenTheme,
  locales: {
    "zh-CN": mergeLocales(
      UniverPresetSheetsCoreZhCN,
      UniverPresetSheetsAdvancedZhCN,
      UniverPresetSheetsConditionalFormattingZhCN,
      UniverPresetSheetsDataValidationZhCN,
      UniverPresetSheetsDrawingZhCN,
      UniverPresetSheetsFilterZhCN,
      UniverPresetSheetsFindReplaceZhCN,
      UniverPresetSheetsHyperLinkZhCN,
      UniverPresetSheetsNoteZhCN,
      UniverPresetSheetsSortZhCN,
      UniverPresetSheetsTableZhCN,
      UniverPresetSheetsThreadCommentZhCN,
    ),
    "en-US": mergeLocales(
      UniverPresetSheetsCoreEnUS,
      UniverPresetSheetsAdvancedEnUS,
      UniverPresetSheetsConditionalFormattingEnUS,
      UniverPresetSheetsDataValidationEnUS,
      UniverPresetSheetsDrawingEnUS,
      UniverPresetSheetsFilterEnUS,
      UniverPresetSheetsFindReplaceEnUS,
      UniverPresetSheetsHyperLinkEnUS,
      UniverPresetSheetsNoteEnUS,
      UniverPresetSheetsSortEnUS,
      UniverPresetSheetsTableEnUS,
      UniverPresetSheetsThreadCommentEnUS,
    ),
  },
  createPresets: (container, license): IPreset[] => [
    // Keep aligned with apps/workspace/web sheet-presets.createSheetEditorPresets.
    UniverSheetsCorePreset({ container, ribbonType: "grid" }),
    UniverSheetsDrawingPreset({ collaboration: true }),
    UniverSheetsConditionalFormattingPreset(),
    UniverSheetsFilterPreset({ enableSyncSwitch: true }),
    UniverSheetsHyperLinkPreset(),
    UniverSheetsDataValidationPreset(),
    UniverSheetsFindReplacePreset(),
    UniverSheetsNotePreset(),
    UniverSheetsSortPreset(),
    UniverSheetsTablePreset(),
    UniverSheetsThreadCommentPreset(),
    UniverSheetsAdvancedPreset({
      license,
      universerEndpoint: window.location.origin,
      print: { enforceWatermark: true },
    }),
  ],
  load: (univerAPI, unitId) => univerAPI.getCollaboration().loadSheetAsync(unitId),
};
