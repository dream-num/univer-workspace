/**
 * Static locale composition for the embedded Viewer.
 *
 * Keep this list in lock-step with the Office render preset.  Loading only the
 * top-level preset locale leaves direct plugin UI (notably Slides, print,
 * history, Embed and Sheet formula controls) untranslated.  All imports are
 * static so the browser bundle contains the packs before a Unit is created.
 */

import { LocaleType, type ILanguagePack } from "@univerjs/core";
import UniverDesignEnUS from "@univerjs/design/locale/en-US";
import UniverDesignZhCN from "@univerjs/design/locale/zh-CN";
import UniverSheetsEnUS from "@univerjs/sheets/locale/en-US";
import UniverSheetsZhCN from "@univerjs/sheets/locale/zh-CN";
import UniverSheetsUIEnUS from "@univerjs/sheets-ui/locale/en-US";
import UniverSheetsUIZhCN from "@univerjs/sheets-ui/locale/zh-CN";
import UniverSheetsFormulaEnUS from "@univerjs/sheets-formula/locale/en-US";
import UniverSheetsFormulaZhCN from "@univerjs/sheets-formula/locale/zh-CN";
import UniverSheetsFormulaUIEnUS from "@univerjs/sheets-formula-ui/locale/en-US";
import UniverSheetsFormulaUIZhCN from "@univerjs/sheets-formula-ui/locale/zh-CN";
import UniverUIEnUS from "@univerjs/ui/locale/en-US";
import UniverUIZhCN from "@univerjs/ui/locale/zh-CN";
import UniverDocsUIEnUS from "@univerjs/docs-ui/locale/en-US";
import UniverDocsUIZhCN from "@univerjs/docs-ui/locale/zh-CN";
import UniverDataValidationEnUS from "@univerjs/data-validation/locale/en-US";
import UniverDataValidationZhCN from "@univerjs/data-validation/locale/zh-CN";
import UniverDocsDrawingUIEnUS from "@univerjs/docs-drawing-ui/locale/en-US";
import UniverDocsDrawingUIZhCN from "@univerjs/docs-drawing-ui/locale/zh-CN";
import UniverDocsHyperLinkUIEnUS from "@univerjs/docs-hyper-link-ui/locale/en-US";
import UniverDocsHyperLinkUIZhCN from "@univerjs/docs-hyper-link-ui/locale/zh-CN";
import UniverDocsThreadCommentUIEnUS from "@univerjs/docs-thread-comment-ui/locale/en-US";
import UniverDocsThreadCommentUIZhCN from "@univerjs/docs-thread-comment-ui/locale/zh-CN";
import UniverDrawingUIEnUS from "@univerjs/drawing-ui/locale/en-US";
import UniverDrawingUIZhCN from "@univerjs/drawing-ui/locale/zh-CN";
import UniverEmbedUIEnUS from "@univerjs-pro/embed-ui/locale/en-US";
import UniverEmbedUIZhCN from "@univerjs-pro/embed-ui/locale/zh-CN";
import UniverBasesEnUS from "@univerjs-pro/bases/locale/en-US";
import UniverBasesZhCN from "@univerjs-pro/bases/locale/zh-CN";
import UniverBasesUIEnUS from "@univerjs-pro/bases-ui/locale/en-US";
import UniverBasesUIZhCN from "@univerjs-pro/bases-ui/locale/zh-CN";
import UniverBasesExchangeEnUS from "@univerjs-pro/bases-exchange-client/locale/en-US";
import UniverBasesExchangeZhCN from "@univerjs-pro/bases-exchange-client/locale/zh-CN";
import UniverShapeEditorUIEnUS from "@univerjs-pro/shape-editor-ui/locale/en-US";
import UniverShapeEditorUIZhCN from "@univerjs-pro/shape-editor-ui/locale/zh-CN";
import UniverInkUIEnUS from "@univerjs-pro/ink-ui/locale/en-US";
import UniverInkUIZhCN from "@univerjs-pro/ink-ui/locale/zh-CN";
import UniverBoardsUIEnUS from "@univerjs-pro/boards-ui/locale/en-US";
import UniverBoardsUIZhCN from "@univerjs-pro/boards-ui/locale/zh-CN";
import UniverBoardsChartUIEnUS from "@univerjs-pro/boards-chart-ui/locale/en-US";
import UniverBoardsChartUIZhCN from "@univerjs-pro/boards-chart-ui/locale/zh-CN";
import UniverBoardsMindUIEnUS from "@univerjs-pro/boards-mind-ui/locale/en-US";
import UniverBoardsMindUIZhCN from "@univerjs-pro/boards-mind-ui/locale/zh-CN";
import UniverBoardsTableUIEnUS from "@univerjs-pro/boards-table-ui/locale/en-US";
import UniverBoardsTableUIZhCN from "@univerjs-pro/boards-table-ui/locale/zh-CN";
import UniverBoardsPrintEnUS from "@univerjs-pro/boards-print/locale/en-US";
import UniverBoardsPrintZhCN from "@univerjs-pro/boards-print/locale/zh-CN";
import UniverDocsCalloutUIEnUS from "@univerjs-pro/docs-callout-ui/locale/en-US";
import UniverDocsCalloutUIZhCN from "@univerjs-pro/docs-callout-ui/locale/zh-CN";
import UniverDocsChartUIEnUS from "@univerjs-pro/docs-chart-ui/locale/en-US";
import UniverDocsChartUIZhCN from "@univerjs-pro/docs-chart-ui/locale/zh-CN";
import UniverDocsColumnUIEnUS from "@univerjs-pro/docs-column-ui/locale/en-US";
import UniverDocsColumnUIZhCN from "@univerjs-pro/docs-column-ui/locale/zh-CN";
import UniverDocsExchangeEnUS from "@univerjs-pro/docs-exchange-client/locale/en-US";
import UniverDocsExchangeZhCN from "@univerjs-pro/docs-exchange-client/locale/zh-CN";
import UniverDocsCodeUIEnUS from "@univerjs-pro/docs-code-ui/locale/en-US";
import UniverDocsCodeUIZhCN from "@univerjs-pro/docs-code-ui/locale/zh-CN";
import UniverDocsListUIEnUS from "@univerjs-pro/docs-list-ui/locale/en-US";
import UniverDocsListUIZhCN from "@univerjs-pro/docs-list-ui/locale/zh-CN";
import UniverDocsQuoteUIEnUS from "@univerjs-pro/docs-quote-ui/locale/en-US";
import UniverDocsQuoteUIZhCN from "@univerjs-pro/docs-quote-ui/locale/zh-CN";
import UniverDocsShapeUIEnUS from "@univerjs-pro/docs-shape-ui/locale/en-US";
import UniverDocsShapeUIZhCN from "@univerjs-pro/docs-shape-ui/locale/zh-CN";
import UniverDocsTableUIEnUS from "@univerjs-pro/docs-table-ui/locale/en-US";
import UniverDocsTableUIZhCN from "@univerjs-pro/docs-table-ui/locale/zh-CN";
import UniverDocsLatexUIEnUS from "@univerjs-pro/docs-latex-ui/locale/en-US";
import UniverDocsLatexUIZhCN from "@univerjs-pro/docs-latex-ui/locale/zh-CN";
import UniverDocsPrintEnUS from "@univerjs-pro/docs-print/locale/en-US";
import UniverDocsPrintZhCN from "@univerjs-pro/docs-print/locale/zh-CN";
import UniverSheetsChartEnUS from "@univerjs-pro/sheets-chart/locale/en-US";
import UniverSheetsChartZhCN from "@univerjs-pro/sheets-chart/locale/zh-CN";
import UniverSheetsChartUIEnUS from "@univerjs-pro/sheets-chart-ui/locale/en-US";
import UniverSheetsChartUIZhCN from "@univerjs-pro/sheets-chart-ui/locale/zh-CN";
import UniverSheetsConditionalFormattingEnUS from "@univerjs/sheets-conditional-formatting/locale/en-US";
import UniverSheetsConditionalFormattingZhCN from "@univerjs/sheets-conditional-formatting/locale/zh-CN";
import UniverSheetsConditionalFormattingUIEnUS from "@univerjs/sheets-conditional-formatting-ui/locale/en-US";
import UniverSheetsConditionalFormattingUIZhCN from "@univerjs/sheets-conditional-formatting-ui/locale/zh-CN";
import UniverSheetsCrosshairEnUS from "@univerjs/sheets-crosshair-highlight/locale/en-US";
import UniverSheetsCrosshairZhCN from "@univerjs/sheets-crosshair-highlight/locale/zh-CN";
import UniverSheetsDataValidationEnUS from "@univerjs/sheets-data-validation/locale/en-US";
import UniverSheetsDataValidationZhCN from "@univerjs/sheets-data-validation/locale/zh-CN";
import UniverSheetsDataValidationUIEnUS from "@univerjs/sheets-data-validation-ui/locale/en-US";
import UniverSheetsDataValidationUIZhCN from "@univerjs/sheets-data-validation-ui/locale/zh-CN";
import UniverSheetsDrawingUIEnUS from "@univerjs/sheets-drawing-ui/locale/en-US";
import UniverSheetsDrawingUIZhCN from "@univerjs/sheets-drawing-ui/locale/zh-CN";
import UniverSheetsFilterEnUS from "@univerjs/sheets-filter/locale/en-US";
import UniverSheetsFilterZhCN from "@univerjs/sheets-filter/locale/zh-CN";
import UniverSheetsFilterUIEnUS from "@univerjs/sheets-filter-ui/locale/en-US";
import UniverSheetsFilterUIZhCN from "@univerjs/sheets-filter-ui/locale/zh-CN";
import UniverSheetsHyperLinkEnUS from "@univerjs/sheets-hyper-link/locale/en-US";
import UniverSheetsHyperLinkZhCN from "@univerjs/sheets-hyper-link/locale/zh-CN";
import UniverSheetsHyperLinkUIEnUS from "@univerjs/sheets-hyper-link-ui/locale/en-US";
import UniverSheetsHyperLinkUIZhCN from "@univerjs/sheets-hyper-link-ui/locale/zh-CN";
import UniverSheetsNoteUIEnUS from "@univerjs/sheets-note-ui/locale/en-US";
import UniverSheetsNoteUIZhCN from "@univerjs/sheets-note-ui/locale/zh-CN";
import UniverSheetsNumfmtUIEnUS from "@univerjs/sheets-numfmt-ui/locale/en-US";
import UniverSheetsNumfmtUIZhCN from "@univerjs/sheets-numfmt-ui/locale/zh-CN";
import UniverSheetsOutlineUIEnUS from "@univerjs-pro/sheets-outline-ui/locale/en-US";
import UniverSheetsOutlineUIZhCN from "@univerjs-pro/sheets-outline-ui/locale/zh-CN";
import UniverSheetsPivotEnUS from "@univerjs-pro/sheets-pivot/locale/en-US";
import UniverSheetsPivotZhCN from "@univerjs-pro/sheets-pivot/locale/zh-CN";
import UniverSheetsPivotUIEnUS from "@univerjs-pro/sheets-pivot-ui/locale/en-US";
import UniverSheetsPivotUIZhCN from "@univerjs-pro/sheets-pivot-ui/locale/zh-CN";
import UniverSheetsExchangeEnUS from "@univerjs-pro/sheets-exchange-client/locale/en-US";
import UniverSheetsExchangeZhCN from "@univerjs-pro/sheets-exchange-client/locale/zh-CN";
import UniverSheetsPrintEnUS from "@univerjs-pro/sheets-print/locale/en-US";
import UniverSheetsPrintZhCN from "@univerjs-pro/sheets-print/locale/zh-CN";
import UniverSheetsShapeUIEnUS from "@univerjs-pro/sheets-shape-ui/locale/en-US";
import UniverSheetsShapeUIZhCN from "@univerjs-pro/sheets-shape-ui/locale/zh-CN";
import UniverSheetsSortUIEnUS from "@univerjs/sheets-sort-ui/locale/en-US";
import UniverSheetsSortUIZhCN from "@univerjs/sheets-sort-ui/locale/zh-CN";
import UniverSheetsSparklineUIEnUS from "@univerjs-pro/sheets-sparkline-ui/locale/en-US";
import UniverSheetsSparklineUIZhCN from "@univerjs-pro/sheets-sparkline-ui/locale/zh-CN";
import UniverSheetsTableEnUS from "@univerjs/sheets-table/locale/en-US";
import UniverSheetsTableZhCN from "@univerjs/sheets-table/locale/zh-CN";
import UniverSheetsTableUIEnUS from "@univerjs/sheets-table-ui/locale/en-US";
import UniverSheetsTableUIZhCN from "@univerjs/sheets-table-ui/locale/zh-CN";
import UniverSheetsThreadCommentUIEnUS from "@univerjs/sheets-thread-comment-ui/locale/en-US";
import UniverSheetsThreadCommentUIZhCN from "@univerjs/sheets-thread-comment-ui/locale/zh-CN";
import UniverThreadCommentUIEnUS from "@univerjs/thread-comment-ui/locale/en-US";
import UniverThreadCommentUIZhCN from "@univerjs/thread-comment-ui/locale/zh-CN";
import UniverSlidesEnUS from "@univerjs-pro/slides/locale/en-US";
import UniverSlidesZhCN from "@univerjs-pro/slides/locale/zh-CN";
import UniverSlidesUIEnUS from "@univerjs-pro/slides-ui/locale/en-US";
import UniverSlidesUIZhCN from "@univerjs-pro/slides-ui/locale/zh-CN";
import UniverSlidesChartUIEnUS from "@univerjs-pro/slides-chart-ui/locale/en-US";
import UniverSlidesChartUIZhCN from "@univerjs-pro/slides-chart-ui/locale/zh-CN";
import UniverSlidesTableUIEnUS from "@univerjs-pro/slides-table-ui/locale/en-US";
import UniverSlidesTableUIZhCN from "@univerjs-pro/slides-table-ui/locale/zh-CN";
import UniverSlidesExchangeEnUS from "@univerjs-pro/slides-exchange-client/locale/en-US";
import UniverSlidesExchangeZhCN from "@univerjs-pro/slides-exchange-client/locale/zh-CN";
import UniverSlidesPrintEnUS from "@univerjs-pro/slides-print/locale/en-US";
import UniverSlidesPrintZhCN from "@univerjs-pro/slides-print/locale/zh-CN";
import ChartUIEnUS from "@univerjs-pro/chart-ui/locale/en-US";
import ChartUIZhCN from "@univerjs-pro/chart-ui/locale/zh-CN";
import EngineChartEnUS from "@univerjs-pro/engine-chart/locale/en-US";
import EngineChartZhCN from "@univerjs-pro/engine-chart/locale/zh-CN";
import CollaborationClientEnUS from "@univerjs-pro/collaboration-client/locale/en-US";
import CollaborationClientZhCN from "@univerjs-pro/collaboration-client/locale/zh-CN";
import CollaborationClientUIEnUS from "@univerjs-pro/collaboration-client-ui/locale/en-US";
import CollaborationClientUIZhCN from "@univerjs-pro/collaboration-client-ui/locale/zh-CN";
import PresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import PresetDocsCoreZhCN from "@univerjs/preset-docs-core/locales/zh-CN";
import PresetDocsDrawingEnUS from "@univerjs/preset-docs-drawing/locales/en-US";
import PresetDocsDrawingZhCN from "@univerjs/preset-docs-drawing/locales/zh-CN";
import PresetDocsHyperLinkEnUS from "@univerjs/preset-docs-hyper-link/locales/en-US";
import PresetDocsHyperLinkZhCN from "@univerjs/preset-docs-hyper-link/locales/zh-CN";
import PresetDocsThreadCommentEnUS from "@univerjs/preset-docs-thread-comment/locales/en-US";
import PresetDocsThreadCommentZhCN from "@univerjs/preset-docs-thread-comment/locales/zh-CN";
import PresetSheetsAdvancedEnUS from "@univerjs/preset-sheets-advanced/locales/en-US";
import PresetSheetsAdvancedZhCN from "@univerjs/preset-sheets-advanced/locales/zh-CN";
import PresetSheetsConditionalFormattingEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import PresetSheetsConditionalFormattingZhCN from "@univerjs/preset-sheets-conditional-formatting/locales/zh-CN";
import PresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import PresetSheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import PresetSheetsDataValidationEnUS from "@univerjs/preset-sheets-data-validation/locales/en-US";
import PresetSheetsDataValidationZhCN from "@univerjs/preset-sheets-data-validation/locales/zh-CN";
import PresetSheetsDrawingEnUS from "@univerjs/preset-sheets-drawing/locales/en-US";
import PresetSheetsDrawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import PresetSheetsFilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import PresetSheetsFilterZhCN from "@univerjs/preset-sheets-filter/locales/zh-CN";
import PresetSheetsFindReplaceEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import PresetSheetsFindReplaceZhCN from "@univerjs/preset-sheets-find-replace/locales/zh-CN";
import PresetSheetsHyperLinkEnUS from "@univerjs/preset-sheets-hyper-link/locales/en-US";
import PresetSheetsHyperLinkZhCN from "@univerjs/preset-sheets-hyper-link/locales/zh-CN";
import PresetSheetsNoteEnUS from "@univerjs/preset-sheets-note/locales/en-US";
import PresetSheetsNoteZhCN from "@univerjs/preset-sheets-note/locales/zh-CN";
import PresetSheetsSortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import PresetSheetsSortZhCN from "@univerjs/preset-sheets-sort/locales/zh-CN";
import PresetSheetsTableEnUS from "@univerjs/preset-sheets-table/locales/en-US";
import PresetSheetsTableZhCN from "@univerjs/preset-sheets-table/locales/zh-CN";
import PresetSheetsThreadCommentEnUS from "@univerjs/preset-sheets-thread-comment/locales/en-US";
import PresetSheetsThreadCommentZhCN from "@univerjs/preset-sheets-thread-comment/locales/zh-CN";
import PresetSheetsCollaborationEnUS from "@univerjs/preset-sheets-collaboration/locales/en-US";
import PresetSheetsCollaborationZhCN from "@univerjs/preset-sheets-collaboration/locales/zh-CN";

export type ViewerLocaleKey = "zh-CN" | "en-US";

export function localeKeyOf(locale: LocaleType): ViewerLocaleKey {
  return locale === LocaleType.EN_US ? "en-US" : "zh-CN";
}

const zhCN = [
  UniverDesignZhCN,
  UniverSheetsZhCN,
  UniverSheetsUIZhCN,
  UniverSheetsFormulaZhCN,
  UniverSheetsFormulaUIZhCN,
  UniverUIZhCN,
  UniverDocsUIZhCN,
  UniverDataValidationZhCN,
  UniverDocsDrawingUIZhCN,
  UniverDocsHyperLinkUIZhCN,
  UniverDocsThreadCommentUIZhCN,
  UniverDrawingUIZhCN,
  UniverEmbedUIZhCN,
  UniverBasesZhCN,
  UniverBasesUIZhCN,
  UniverBasesExchangeZhCN,
  UniverShapeEditorUIZhCN,
  UniverInkUIZhCN,
  UniverBoardsUIZhCN,
  UniverBoardsChartUIZhCN,
  UniverBoardsMindUIZhCN,
  UniverBoardsTableUIZhCN,
  UniverBoardsPrintZhCN,
  UniverDocsCalloutUIZhCN,
  UniverDocsChartUIZhCN,
  UniverDocsColumnUIZhCN,
  UniverDocsExchangeZhCN,
  UniverDocsCodeUIZhCN,
  UniverDocsListUIZhCN,
  UniverDocsQuoteUIZhCN,
  UniverDocsShapeUIZhCN,
  UniverDocsTableUIZhCN,
  UniverDocsLatexUIZhCN,
  UniverDocsPrintZhCN,
  UniverSheetsChartZhCN,
  UniverSheetsChartUIZhCN,
  UniverSheetsConditionalFormattingZhCN,
  UniverSheetsConditionalFormattingUIZhCN,
  UniverSheetsCrosshairZhCN,
  UniverSheetsDataValidationZhCN,
  UniverSheetsDataValidationUIZhCN,
  UniverSheetsDrawingUIZhCN,
  UniverSheetsFilterZhCN,
  UniverSheetsFilterUIZhCN,
  UniverSheetsHyperLinkZhCN,
  UniverSheetsHyperLinkUIZhCN,
  UniverSheetsNoteUIZhCN,
  UniverSheetsNumfmtUIZhCN,
  UniverSheetsOutlineUIZhCN,
  UniverSheetsPivotZhCN,
  UniverSheetsPivotUIZhCN,
  UniverSheetsExchangeZhCN,
  UniverSheetsPrintZhCN,
  UniverSheetsShapeUIZhCN,
  UniverSheetsSortUIZhCN,
  UniverSheetsSparklineUIZhCN,
  UniverSheetsTableZhCN,
  UniverSheetsTableUIZhCN,
  UniverSheetsThreadCommentUIZhCN,
  UniverThreadCommentUIZhCN,
  UniverSlidesZhCN,
  UniverSlidesUIZhCN,
  UniverSlidesChartUIZhCN,
  UniverSlidesTableUIZhCN,
  UniverSlidesExchangeZhCN,
  UniverSlidesPrintZhCN,
  ChartUIZhCN,
  EngineChartZhCN,
  CollaborationClientZhCN,
  CollaborationClientUIZhCN,
  PresetDocsCoreZhCN,
  PresetDocsDrawingZhCN,
  PresetDocsHyperLinkZhCN,
  PresetDocsThreadCommentZhCN,
  PresetSheetsAdvancedZhCN,
  PresetSheetsConditionalFormattingZhCN,
  PresetSheetsCoreZhCN,
  PresetSheetsDataValidationZhCN,
  PresetSheetsDrawingZhCN,
  PresetSheetsFilterZhCN,
  PresetSheetsFindReplaceZhCN,
  PresetSheetsHyperLinkZhCN,
  PresetSheetsNoteZhCN,
  PresetSheetsSortZhCN,
  PresetSheetsTableZhCN,
  PresetSheetsThreadCommentZhCN,
  PresetSheetsCollaborationZhCN,
] as const;

const enUS = [
  UniverDesignEnUS,
  UniverSheetsEnUS,
  UniverSheetsUIEnUS,
  UniverSheetsFormulaEnUS,
  UniverSheetsFormulaUIEnUS,
  UniverUIEnUS,
  UniverDocsUIEnUS,
  UniverDataValidationEnUS,
  UniverDocsDrawingUIEnUS,
  UniverDocsHyperLinkUIEnUS,
  UniverDocsThreadCommentUIEnUS,
  UniverDrawingUIEnUS,
  UniverEmbedUIEnUS,
  UniverBasesEnUS,
  UniverBasesUIEnUS,
  UniverBasesExchangeEnUS,
  UniverShapeEditorUIEnUS,
  UniverInkUIEnUS,
  UniverBoardsUIEnUS,
  UniverBoardsChartUIEnUS,
  UniverBoardsMindUIEnUS,
  UniverBoardsTableUIEnUS,
  UniverBoardsPrintEnUS,
  UniverDocsCalloutUIEnUS,
  UniverDocsChartUIEnUS,
  UniverDocsColumnUIEnUS,
  UniverDocsExchangeEnUS,
  UniverDocsCodeUIEnUS,
  UniverDocsListUIEnUS,
  UniverDocsQuoteUIEnUS,
  UniverDocsShapeUIEnUS,
  UniverDocsTableUIEnUS,
  UniverDocsLatexUIEnUS,
  UniverDocsPrintEnUS,
  UniverSheetsChartEnUS,
  UniverSheetsChartUIEnUS,
  UniverSheetsConditionalFormattingEnUS,
  UniverSheetsConditionalFormattingUIEnUS,
  UniverSheetsCrosshairEnUS,
  UniverSheetsDataValidationEnUS,
  UniverSheetsDataValidationUIEnUS,
  UniverSheetsDrawingUIEnUS,
  UniverSheetsFilterEnUS,
  UniverSheetsFilterUIEnUS,
  UniverSheetsHyperLinkEnUS,
  UniverSheetsHyperLinkUIEnUS,
  UniverSheetsNoteUIEnUS,
  UniverSheetsNumfmtUIEnUS,
  UniverSheetsOutlineUIEnUS,
  UniverSheetsPivotEnUS,
  UniverSheetsPivotUIEnUS,
  UniverSheetsExchangeEnUS,
  UniverSheetsPrintEnUS,
  UniverSheetsShapeUIEnUS,
  UniverSheetsSortUIEnUS,
  UniverSheetsSparklineUIEnUS,
  UniverSheetsTableEnUS,
  UniverSheetsTableUIEnUS,
  UniverSheetsThreadCommentUIEnUS,
  UniverThreadCommentUIEnUS,
  UniverSlidesEnUS,
  UniverSlidesUIEnUS,
  UniverSlidesChartUIEnUS,
  UniverSlidesTableUIEnUS,
  UniverSlidesExchangeEnUS,
  UniverSlidesPrintEnUS,
  ChartUIEnUS,
  EngineChartEnUS,
  CollaborationClientEnUS,
  CollaborationClientUIEnUS,
  PresetDocsCoreEnUS,
  PresetDocsDrawingEnUS,
  PresetDocsHyperLinkEnUS,
  PresetDocsThreadCommentEnUS,
  PresetSheetsAdvancedEnUS,
  PresetSheetsConditionalFormattingEnUS,
  PresetSheetsCoreEnUS,
  PresetSheetsDataValidationEnUS,
  PresetSheetsDrawingEnUS,
  PresetSheetsFilterEnUS,
  PresetSheetsFindReplaceEnUS,
  PresetSheetsHyperLinkEnUS,
  PresetSheetsNoteEnUS,
  PresetSheetsSortEnUS,
  PresetSheetsTableEnUS,
  PresetSheetsThreadCommentEnUS,
  PresetSheetsCollaborationEnUS,
] as const;

/** Deep merge locale namespaces so one feature pack cannot erase another. */
function mergeLocalePacks(...packs: readonly ILanguagePack[]): ILanguagePack {
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(source)) {
      const current = target[key];
      if (isPlainRecord(current) && isPlainRecord(value)) merge(current, value);
      else target[key] = value;
    }
  };
  const result: Record<string, unknown> = {};
  for (const pack of packs) merge(result, pack as unknown as Record<string, unknown>);
  return result as ILanguagePack;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const LOCALE_PACKS: Record<ViewerLocaleKey, ILanguagePack> = {
  "zh-CN": mergeLocalePacks(...zhCN),
  "en-US": mergeLocalePacks(...enUS),
};
