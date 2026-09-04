import type { ILanguagePack } from "@univerjs/core";
import type { IPreset } from "@univerjs/presets";
import ChartUIEnUS from "@univerjs-pro/chart-ui/locale/en-US";
import ChartUIZhCN from "@univerjs-pro/chart-ui/locale/zh-CN";
import EngineChartEnUS from "@univerjs-pro/engine-chart/locale/en-US";
import EngineChartZhCN from "@univerjs-pro/engine-chart/locale/zh-CN";
import { UniverSheetsAdvancedPreset } from "@univerjs/preset-sheets-advanced";
import UniverPresetSheetsAdvancedEnUS from "@univerjs/preset-sheets-advanced/locales/en-US";
import UniverPresetSheetsAdvancedZhCN from "@univerjs/preset-sheets-advanced/locales/zh-CN";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import UniverPresetSheetsConditionalFormattingEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import UniverPresetSheetsConditionalFormattingZhCN from "@univerjs/preset-sheets-conditional-formatting/locales/zh-CN";
import { UniverSheetsCollaborationPreset } from "@univerjs/preset-sheets-collaboration";
import UniverPresetSheetsCollaborationEnUS from "@univerjs/preset-sheets-collaboration/locales/en-US";
import UniverPresetSheetsCollaborationZhCN from "@univerjs/preset-sheets-collaboration/locales/zh-CN";
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
import { mergeLocales } from "@univerjs/presets";
import type { AppLanguage } from "../../shared/i18n";
import { MAX_UNIVER_IMAGE_BYTES } from "./univer-assets";

export const sheetEditorLocales: Readonly<
  Record<AppLanguage, ILanguagePack>
> = {
  "zh-CN": mergeLocales(
    ChartUIZhCN,
    EngineChartZhCN,
    UniverPresetSheetsCoreZhCN,
    UniverPresetSheetsDrawingZhCN,
    UniverPresetSheetsConditionalFormattingZhCN,
    UniverPresetSheetsDataValidationZhCN,
    UniverPresetSheetsFilterZhCN,
    UniverPresetSheetsFindReplaceZhCN,
    UniverPresetSheetsHyperLinkZhCN,
    UniverPresetSheetsNoteZhCN,
    UniverPresetSheetsSortZhCN,
    UniverPresetSheetsTableZhCN,
    UniverPresetSheetsThreadCommentZhCN,
    UniverPresetSheetsAdvancedZhCN,
    UniverPresetSheetsCollaborationZhCN
  ),
  "en-US": mergeLocales(
    ChartUIEnUS,
    EngineChartEnUS,
    UniverPresetSheetsCoreEnUS,
    UniverPresetSheetsDrawingEnUS,
    UniverPresetSheetsConditionalFormattingEnUS,
    UniverPresetSheetsDataValidationEnUS,
    UniverPresetSheetsFilterEnUS,
    UniverPresetSheetsFindReplaceEnUS,
    UniverPresetSheetsHyperLinkEnUS,
    UniverPresetSheetsNoteEnUS,
    UniverPresetSheetsSortEnUS,
    UniverPresetSheetsTableEnUS,
    UniverPresetSheetsThreadCommentEnUS,
    UniverPresetSheetsAdvancedEnUS,
    UniverPresetSheetsCollaborationEnUS
  ),
};

interface CreateSheetEditorPresetsOptions {
  readonly container: HTMLElement;
  readonly license?: string;
  readonly universerEndpoint: string;
  readonly threadCommentsEnabled?: boolean;
  readonly collaborationEnabled?: boolean;
}

/**
 * Keep this list aligned with
 * univer-pro/examples/src/preset-sheets-collaboration.
 * CollaborationEditor replaces the collaboration preset's endpoint config at
 * runtime so the same stack also works for Workspace worktree scopes.
 */
export function createSheetEditorPresets({
  container,
  license,
  universerEndpoint,
  threadCommentsEnabled = true,
  collaborationEnabled = true,
}: CreateSheetEditorPresetsOptions): IPreset[] {
  return [
    UniverSheetsCorePreset({
      container,
      ribbonType: "grid",
    }),
    UniverSheetsDrawingPreset({
      collaboration: collaborationEnabled,
      allowImageSize: MAX_UNIVER_IMAGE_BYTES,
    }),
    UniverSheetsConditionalFormattingPreset(),
    UniverSheetsFilterPreset({
      enableSyncSwitch: true,
    }),
    UniverSheetsHyperLinkPreset(),
    UniverSheetsDataValidationPreset(),
    UniverSheetsFindReplacePreset(),
    UniverSheetsNotePreset(),
    UniverSheetsSortPreset(),
    UniverSheetsTablePreset(),
    ...(threadCommentsEnabled ? [UniverSheetsThreadCommentPreset()] : []),
    UniverSheetsAdvancedPreset({
      license: license ?? "",
      universerEndpoint,
      print: {
        enforceWatermark: true,
      },
    }),
    ...(collaborationEnabled
      ? [
          UniverSheetsCollaborationPreset({
            univerContainerId: container.id,
            universerEndpoint,
          }),
        ]
      : []),
  ];
}
