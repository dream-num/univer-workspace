import { IImageIoService } from "@univerjs/core";
import { UniverDataValidationPlugin } from "@univerjs/data-validation";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsDrawingPlugin } from "@univerjs/docs-drawing";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverDrawingMobileUIPlugin } from "@univerjs/drawing-ui";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverFindReplaceMobileUIPlugin } from "@univerjs/find-replace";
import { UniverNetworkPlugin } from "@univerjs/network";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsConditionalFormattingPlugin } from "@univerjs/sheets-conditional-formatting";
import { UniverSheetsConditionalFormattingMobileUIPlugin } from "@univerjs/sheets-conditional-formatting-ui";
import { UniverSheetsDataValidationPlugin } from "@univerjs/sheets-data-validation";
import { UniverSheetsDataValidationMobileUIPlugin } from "@univerjs/sheets-data-validation-ui";
import { UniverSheetsDrawingPlugin } from "@univerjs/sheets-drawing";
import { UniverSheetsDrawingMobileUIPlugin } from "@univerjs/sheets-drawing-ui";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsFilterMobileUIPlugin } from "@univerjs/sheets-filter-ui";
import { UniverSheetsFindReplaceMobileUIPlugin } from "@univerjs/sheets-find-replace";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsFormulaMobileUIPlugin } from "@univerjs/sheets-formula-ui";
import { UniverSheetsHyperLinkPlugin } from "@univerjs/sheets-hyper-link";
import { UniverSheetsHyperLinkMobileUIPlugin } from "@univerjs/sheets-hyper-link-ui";
import { UniverSheetsNotePlugin } from "@univerjs/sheets-note";
import { UniverSheetsNoteUIPlugin } from "@univerjs/sheets-note-ui";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverSheetsNumfmtMobileUIPlugin } from "@univerjs/sheets-numfmt-ui";
import { UniverSheetsSortPlugin } from "@univerjs/sheets-sort";
import { UniverSheetsSortMobileUIPlugin } from "@univerjs/sheets-sort-ui";
import { UniverSheetsTablePlugin } from "@univerjs/sheets-table";
import { UniverSheetsTableMobileUIPlugin } from "@univerjs/sheets-table-ui";
import { UniverSheetsThreadCommentPlugin } from "@univerjs/sheets-thread-comment";
import { UniverSheetsMobileUIPlugin } from "@univerjs/sheets-ui";
import { UniverMobileUIPlugin } from "@univerjs/ui";
import { UniverChartMobileUIPlugin } from "@univerjs-pro/chart-ui";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { UniverSheetsChartPlugin } from "@univerjs-pro/sheets-chart";
import { UniverSheetsChartMobileUIPlugin } from "@univerjs-pro/sheets-chart-ui";
import { UniverSheetsOutlinePlugin } from "@univerjs-pro/sheets-outline";
import { UniverSheetsOutlineMobileUIPlugin } from "@univerjs-pro/sheets-outline-ui";
import { UniverSheetsPivotTablePlugin } from "@univerjs-pro/sheets-pivot";
import { UniverSheetsPivotTableMobileUIPlugin } from "@univerjs-pro/sheets-pivot-ui";
import { UniverSheetsPrintMobileUIPlugin } from "@univerjs-pro/sheets-print";
import { UniverSheetsShapePlugin } from "@univerjs-pro/sheets-shape";
import { UniverSheetsShapeMobileUIPlugin } from "@univerjs-pro/sheets-shape-ui";
import { UniverSheetSparklinePlugin } from "@univerjs-pro/sheets-sparkline";
import { UniverSheetSparklineMobileUIPlugin } from "@univerjs-pro/sheets-sparkline-ui";
import type { IPreset } from "@univerjs/presets";
import { MAX_UNIVER_IMAGE_BYTES } from "../../features/univer-assets";

interface CreateSheetMobilePresetsOptions {
  readonly container: HTMLElement;
  readonly threadCommentsEnabled?: boolean;
  readonly collaborationEnabled?: boolean;
}

/**
 * Plugin-mode mobile counterpart of createSheetEditorPresets, modeled on
 * univer-pro examples/src/sheets-mobile. Formulas intentionally execute on
 * the main thread (no UniverRPCMainThreadPlugin, no notExecuteFormula),
 * matching the Workspace desktop stack; the official mobile composition
 * offloads them to a worker, and adopting that is a separate decision.
 */
export function createSheetMobilePresets({
  container,
  threadCommentsEnabled = true,
  collaborationEnabled = true,
}: CreateSheetMobilePresetsOptions): IPreset[] {
  return [
    {
      plugins: [
        UniverNetworkPlugin,
        UniverDocsPlugin,
        UniverRenderEnginePlugin,
        [UniverMobileUIPlugin, { container }],
        UniverDocsUIPlugin,
        UniverFormulaEnginePlugin,
        UniverSheetsPlugin,
        UniverSheetsMobileUIPlugin,
        UniverSheetsNumfmtPlugin,
        UniverSheetsNumfmtMobileUIPlugin,
        UniverSheetsFormulaPlugin,
        UniverSheetsFormulaMobileUIPlugin,
      ],
    },
    {
      plugins: [
        UniverSheetsConditionalFormattingPlugin,
        UniverSheetsConditionalFormattingMobileUIPlugin,
        [
          UniverSheetsFilterPlugin,
          { enableSyncSwitch: true },
        ],
        UniverSheetsFilterMobileUIPlugin,
        UniverSheetsHyperLinkPlugin,
        UniverSheetsHyperLinkMobileUIPlugin,
        UniverDataValidationPlugin,
        UniverSheetsDataValidationPlugin,
        UniverSheetsDataValidationMobileUIPlugin,
        UniverFindReplaceMobileUIPlugin,
        UniverSheetsFindReplaceMobileUIPlugin,
        UniverSheetsSortPlugin,
        UniverSheetsSortMobileUIPlugin,
        UniverSheetsTablePlugin,
        UniverSheetsTableMobileUIPlugin,
        // sheets-note-ui has no Mobile variant on this SDK release.
        UniverSheetsNotePlugin,
        UniverSheetsNoteUIPlugin,
      ],
    },
    {
      plugins: [
        [
          UniverDrawingPlugin,
          {
            override: collaborationEnabled ? [[IImageIoService, null]] : [],
            allowImageSize: MAX_UNIVER_IMAGE_BYTES,
          },
        ],
        UniverDocsDrawingPlugin,
        UniverDrawingMobileUIPlugin,
        UniverSheetsDrawingPlugin,
        UniverSheetsDrawingMobileUIPlugin,
      ],
    },
    // The UI plugin is supplied through collaborationFeaturePlugins;
    // registering it here as well would duplicate its pluginName.
    ...(threadCommentsEnabled && collaborationEnabled
      ? [{ plugins: [UniverSheetsThreadCommentPlugin] }]
      : []),
    {
      plugins: [
        UniverSheetsPivotTablePlugin,
        UniverSheetsPivotTableMobileUIPlugin,
        // createUniver lets later presets replace earlier plugins with the
        // same pluginName, so this supersedes UniverFormulaEnginePlugin.
        UniverProFormulaEnginePlugin,
        [UniverSheetsPrintMobileUIPlugin, { enforceWatermark: true }],
        UniverSheetsChartPlugin,
        UniverSheetsChartMobileUIPlugin,
        UniverChartMobileUIPlugin,
        UniverSheetsOutlinePlugin,
        UniverSheetsOutlineMobileUIPlugin,
        UniverSheetsShapePlugin,
        UniverSheetsShapeMobileUIPlugin,
        UniverSheetSparklinePlugin,
        UniverSheetSparklineMobileUIPlugin,
      ],
    },
  ];
}
