import { IImageIoService, IUniverInstanceService } from "@univerjs/core";
import type { Univer } from "@univerjs/core";
import { IAttachmentIoService } from "@univerjs-pro/collaboration-client";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { UniverLicensePlugin } from "@univerjs-pro/license";
import { UniverBasesPlugin } from "@univerjs-pro/bases";
import { UniverBasesUIPlugin } from "@univerjs-pro/bases-ui";
import { BoardToolType, UniverBoardsPlugin } from "@univerjs-pro/boards";
import { UniverBoardsChartPlugin } from "@univerjs-pro/boards-chart";
import { UniverBoardsChartUIPlugin } from "@univerjs-pro/boards-chart-ui";
import { UniverBoardsMindPlugin } from "@univerjs-pro/boards-mind";
import { UniverBoardsMindUIPlugin } from "@univerjs-pro/boards-mind-ui";
import { UniverBoardsTablePlugin } from "@univerjs-pro/boards-table";
import { UniverBoardsTableUIPlugin } from "@univerjs-pro/boards-table-ui";
import { UniverBoardsUIPlugin } from "@univerjs-pro/boards-ui";
import { UniverDocsCalloutPlugin } from "@univerjs-pro/docs-callout";
import { UniverDocsCalloutUIPlugin } from "@univerjs-pro/docs-callout-ui";
import { UniverDocsChartPlugin } from "@univerjs-pro/docs-chart";
import { UniverDocsChartUIPlugin } from "@univerjs-pro/docs-chart-ui";
import { UniverDocsCodePlugin } from "@univerjs-pro/docs-code";
import { UniverDocsCodeUIPlugin } from "@univerjs-pro/docs-code-ui";
import { UniverDocsColumnPlugin } from "@univerjs-pro/docs-column";
import { UniverDocsColumnUIPlugin } from "@univerjs-pro/docs-column-ui";
import { UniverDocsListPlugin } from "@univerjs-pro/docs-list";
import { UniverDocsListUIPlugin } from "@univerjs-pro/docs-list-ui";
import { UniverDocsQuotePlugin } from "@univerjs-pro/docs-quote";
import { UniverDocsQuoteUIPlugin } from "@univerjs-pro/docs-quote-ui";
import { UniverDocsShapePlugin } from "@univerjs-pro/docs-shape";
import { UniverDocsShapeUIPlugin } from "@univerjs-pro/docs-shape-ui";
import { UniverDocsTablePlugin } from "@univerjs-pro/docs-table";
import { UniverDocsTableUIPlugin } from "@univerjs-pro/docs-table-ui";
import { UniverDocsLatexPlugin } from "@univerjs-pro/docs-latex";
import { UniverDocsLatexUIPlugin } from "@univerjs-pro/docs-latex-ui";
import { UniverExchangeClientPlugin } from "@univerjs-pro/exchange-client";
import { UniverInkPlugin } from "@univerjs-pro/ink";
import { UniverInkUIPlugin } from "@univerjs-pro/ink-ui";
import { UniverRangePreprocessPlugin } from "@univerjs-pro/range-preprocess";
import { UniverSheetsChartPlugin } from "@univerjs-pro/sheets-chart";
import { UniverSheetsChartUIPlugin } from "@univerjs-pro/sheets-chart-ui";
import { UniverSheetsOutlinePlugin } from "@univerjs-pro/sheets-outline";
import { UniverSheetsOutlineUIPlugin } from "@univerjs-pro/sheets-outline-ui";
import { UniverSheetsPivotTablePlugin } from "@univerjs-pro/sheets-pivot";
import { UniverSheetsPivotTableUIPlugin } from "@univerjs-pro/sheets-pivot-ui";
import { UniverSheetsShapePlugin } from "@univerjs-pro/sheets-shape";
import { UniverSheetsShapeUIPlugin } from "@univerjs-pro/sheets-shape-ui";
import { UniverSheetSparklinePlugin } from "@univerjs-pro/sheets-sparkline";
import { UniverSheetSparklineUIPlugin } from "@univerjs-pro/sheets-sparkline-ui";
import { UniverSlidesPlugin } from "@univerjs-pro/slides";
import { UniverSlidesChartPlugin } from "@univerjs-pro/slides-chart";
import { UniverSlidesChartUIPlugin } from "@univerjs-pro/slides-chart-ui";
import { UniverSlidesTablePlugin } from "@univerjs-pro/slides-table";
import { UniverSlidesTableUIPlugin } from "@univerjs-pro/slides-table-ui";
import { UniverSlidesUIPlugin } from "@univerjs-pro/slides-ui";
import { UniverDataValidationPlugin } from "@univerjs/data-validation";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsDrawingPlugin } from "@univerjs/docs-drawing";
import { UniverDocsDrawingUIPlugin } from "@univerjs/docs-drawing-ui";
import { UniverDocsHyperLinkPlugin } from "@univerjs/docs-hyper-link";
import { UniverDocsHyperLinkUIPlugin } from "@univerjs/docs-hyper-link-ui";
import { UniverDocsThreadCommentUIPlugin } from "@univerjs/docs-thread-comment-ui";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverDrawingUIPlugin } from "@univerjs/drawing-ui";
import { IReferencedUnitManagerService, UniverEmbedPlugin } from "@univerjs-pro/embed";
import { UniverEmbedUIPlugin } from "@univerjs-pro/embed-ui";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsConditionalFormattingPlugin } from "@univerjs/sheets-conditional-formatting";
import { UniverSheetsConditionalFormattingUIPlugin } from "@univerjs/sheets-conditional-formatting-ui";
import { UniverSheetsCrosshairHighlightPlugin } from "@univerjs/sheets-crosshair-highlight";
import { UniverSheetsDataValidationPlugin } from "@univerjs/sheets-data-validation";
import { UniverSheetsDataValidationUIPlugin } from "@univerjs/sheets-data-validation-ui";
import { UniverSheetsDrawingPlugin } from "@univerjs/sheets-drawing";
import { UniverSheetsDrawingUIPlugin } from "@univerjs/sheets-drawing-ui";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsFilterUIPlugin } from "@univerjs/sheets-filter-ui";
import { UniverSheetsFindReplacePlugin } from "@univerjs/sheets-find-replace";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsFormulaUIPlugin } from "@univerjs/sheets-formula-ui";
import { UniverSheetsHyperLinkPlugin } from "@univerjs/sheets-hyper-link";
import { UniverSheetsHyperLinkUIPlugin } from "@univerjs/sheets-hyper-link-ui";
import { UniverSheetsNotePlugin } from "@univerjs/sheets-note";
import { UniverSheetsNoteUIPlugin } from "@univerjs/sheets-note-ui";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverSheetsNumfmtUIPlugin } from "@univerjs/sheets-numfmt-ui";
import { UniverSheetsSortPlugin } from "@univerjs/sheets-sort";
import { UniverSheetsSortUIPlugin } from "@univerjs/sheets-sort-ui";
import { UniverSheetsTablePlugin } from "@univerjs/sheets-table";
import { UniverSheetsTableUIPlugin } from "@univerjs/sheets-table-ui";
import { UniverSheetsThreadCommentPlugin } from "@univerjs/sheets-thread-comment";
import { UniverSheetsThreadCommentUIPlugin } from "@univerjs/sheets-thread-comment-ui";
import { UniverSheetsUIPlugin } from "@univerjs/sheets-ui";
import { UniverThreadCommentUIPlugin } from "@univerjs/thread-comment-ui";
import { UniverUIPlugin, type RibbonType } from "@univerjs/ui";
import { UniverSheetsImportRangeFormulaPlugin } from "./import-range-formula.js";
import { createViewBaseResourceRefDataProviderRegistration } from "./view-base-resource-ref-data-provider.js";

export type { BoardModel, IBoardLayoutAnalysisResult, IBoardRect } from "@univerjs-pro/boards";
export {
  BOARD_MAIN_VIEWPORT_KEY,
  IBoardElementStateService,
  IBoardUIStateService,
  getBoardElementRenderObjectKey,
} from "@univerjs-pro/boards-ui";
export { deepMerge, mergeLocalePacks } from "./locales/merge.js";

/**
 * Base plugins, registered in the same order as univer-pro's sheets example (`main.ts` top +
 * registerBasicPlugins), minus product-only infra (worker RPC, telemetry, watermark, debugger).
 * Drawing goes first. Live collaboration views disable its local `IImageIoService` so
 * collaboration-client owns remote image IO without a duplicate redi registration. Local Machine
 * and merge-preview views keep the drawing default. `notExecuteFormula:false` because collab-client
 * has no formula worker.
 * `hideWorkbenchChrome` mirrors the Board example, whose own tools sit inside an outer host shell.
 */
function registerBasePlugins(
  univer: Univer,
  container: string,
  collaborationOwnsAssetIo: boolean,
  license: string,
  hideWorkbenchChrome = false,
  ribbonType?: RibbonType,
): void {
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverUIPlugin, {
    container,
    ...(ribbonType === undefined ? {} : { ribbonType }),
    ...(hideWorkbenchChrome
      ? { header: false, toolbar: false, headerMenu: false, footer: false }
      : {}),
  });
  univer.registerPlugin(
    UniverDrawingPlugin,
    collaborationOwnsAssetIo ? { override: [[IImageIoService, null]] } : undefined,
  );
  univer.registerPlugin(UniverDrawingUIPlugin);
  univer.registerPlugin(UniverLicensePlugin, { license });
  univer.registerPlugin(UniverProFormulaEnginePlugin, { notExecuteFormula: false });
  univer.registerPlugin(UniverRangePreprocessPlugin);
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverDocsUIPlugin);
  univer.registerPlugin(UniverDocsLatexPlugin);
  univer.registerPlugin(UniverDocsLatexUIPlugin);
  univer.registerPlugin(UniverDocsDrawingPlugin);
  univer.registerPlugin(UniverDocsDrawingUIPlugin);
  univer.registerPlugin(UniverDocsHyperLinkPlugin);
  univer.registerPlugin(UniverDocsHyperLinkUIPlugin);
}

function registerDocPlugins(univer: Univer): void {
  univer.registerPlugin(UniverDocsChartPlugin);
  univer.registerPlugin(UniverDocsChartUIPlugin);
  univer.registerPlugin(UniverDocsColumnPlugin);
  univer.registerPlugin(UniverDocsColumnUIPlugin);
  univer.registerPlugin(UniverDocsTablePlugin);
  univer.registerPlugin(UniverDocsTableUIPlugin);
  univer.registerPlugin(UniverDocsListPlugin);
  univer.registerPlugin(UniverDocsListUIPlugin);
  univer.registerPlugin(UniverDocsShapePlugin);
  univer.registerPlugin(UniverDocsShapeUIPlugin);
  univer.registerPlugin(UniverDocsCalloutPlugin);
  univer.registerPlugin(UniverDocsCalloutUIPlugin);
  univer.registerPlugin(UniverDocsCodePlugin);
  univer.registerPlugin(UniverDocsCodeUIPlugin);
  univer.registerPlugin(UniverDocsQuotePlugin);
  univer.registerPlugin(UniverDocsQuoteUIPlugin);
  univer.registerPlugin(UniverDocsThreadCommentUIPlugin);
}

/**
 * The full sheet feature set, in the same order as univer-pro's sheets example
 * `registerSheetPlugins`, so any workbook the CLI can author renders correctly: number format,
 * outline, formula, conditional formatting, data validation, filter, images, sort, pivot, chart,
 * sparkline, table, shape, hyperlink, note, crosshair. `sheets-formula-ui` owns the cell editor's
 * input layer; without it the editor can't take keyboard input (only toolbar style commands work).
 */
function registerSheetPlugins(univer: Univer): void {
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsUIPlugin);
  univer.registerPlugin(UniverSheetsOutlinePlugin);
  univer.registerPlugin(UniverSheetsOutlineUIPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.registerPlugin(UniverSheetsFormulaUIPlugin);
  univer.registerPlugin(UniverSheetsImportRangeFormulaPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingUIPlugin);
  univer.registerPlugin(UniverDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationUIPlugin);
  univer.registerPlugin(UniverSheetsFilterPlugin);
  univer.registerPlugin(UniverSheetsFilterUIPlugin);
  univer.registerPlugin(UniverSheetsDrawingPlugin);
  univer.registerPlugin(UniverSheetsDrawingUIPlugin);
  univer.registerPlugin(UniverSheetsSortPlugin);
  univer.registerPlugin(UniverSheetsSortUIPlugin);
  univer.registerPlugin(UniverThreadCommentUIPlugin);
  univer.registerPlugin(UniverSheetsThreadCommentPlugin);
  univer.registerPlugin(UniverSheetsThreadCommentUIPlugin);
  univer.registerPlugin(UniverSheetsPivotTablePlugin);
  univer.registerPlugin(UniverSheetsPivotTableUIPlugin);
  univer.registerPlugin(UniverSheetsChartPlugin);
  univer.registerPlugin(UniverSheetsChartUIPlugin);
  univer.registerPlugin(UniverSheetSparklinePlugin);
  univer.registerPlugin(UniverSheetSparklineUIPlugin);
  univer.registerPlugin(UniverSheetsTablePlugin);
  univer.registerPlugin(UniverSheetsTableUIPlugin);
  univer.registerPlugin(UniverSheetsShapePlugin);
  univer.registerPlugin(UniverSheetsShapeUIPlugin);
  univer.registerPlugin(UniverSheetsHyperLinkPlugin);
  univer.registerPlugin(UniverSheetsHyperLinkUIPlugin);
  univer.registerPlugin(UniverSheetsNotePlugin);
  univer.registerPlugin(UniverSheetsNoteUIPlugin);
  univer.registerPlugin(UniverSheetsFindReplacePlugin);
  univer.registerPlugin(UniverSheetsCrosshairHighlightPlugin);
}

/** Slide plugins. The drawing base is already registered by {@link registerCorePlugins}. */
function registerSlidePlugins(univer: Univer): void {
  univer.registerPlugin(UniverSlidesPlugin);
  univer.registerPlugin(UniverSlidesUIPlugin, { editor: { enabled: true } });
  univer.registerPlugin(UniverSlidesChartPlugin);
  univer.registerPlugin(UniverSlidesChartUIPlugin);
  univer.registerPlugin(UniverSlidesTablePlugin);
  univer.registerPlugin(UniverSlidesTableUIPlugin);
}

function registerBaseUnitPlugins(univer: Univer, collaborationOwnsAssetIo: boolean): void {
  univer.registerPlugin(UniverBasesPlugin);
  univer.registerPlugin(
    UniverBasesUIPlugin,
    collaborationOwnsAssetIo ? { override: [[IAttachmentIoService, null]] } : undefined,
  );
}

/** Stable Board plugins in the version-matched univer-pro browser example order. */
function registerBoardPlugins(univer: Univer): void {
  univer.registerPlugin(UniverExchangeClientPlugin);
  univer.registerPlugin(UniverBoardsPlugin);
  univer.registerPlugin(UniverInkPlugin);
  univer.registerPlugin(UniverInkUIPlugin);
  univer.registerPlugin(UniverBoardsUIPlugin, {
    toolbar: { tools: { [BoardToolType.Import]: true } },
  });
  univer.registerPlugin(UniverBoardsChartPlugin);
  univer.registerPlugin(UniverBoardsChartUIPlugin);
  univer.registerPlugin(UniverBoardsMindPlugin);
  univer.registerPlugin(UniverBoardsMindUIPlugin);
  univer.registerPlugin(UniverBoardsTablePlugin);
  univer.registerPlugin(UniverBoardsTableUIPlugin);
}

function registerEmbedCorePlugin(univer: Univer): void {
  const injector = univer.__getInjector();
  univer.registerPlugin(UniverEmbedPlugin, {
    resourceRefDataProviderRegistrations: [
      createViewBaseResourceRefDataProviderRegistration(() => ({
        referencedUnitManager: injector.get(IReferencedUnitManagerService),
        univerInstanceService: injector.get(IUniverInstanceService),
      })),
    ],
  });
}

function registerEmbedUIPlugin(univer: Univer): void {
  univer.registerPlugin(UniverEmbedUIPlugin);
}

export enum ViewAssetIoOwner {
  Local = "local",
  CollaborationClient = "collaboration-client",
}

export interface ViewRenderingOptions {
  container: string;
  assetIoOwner: ViewAssetIoOwner;
  license: string;
  workbenchChrome: "hidden" | "visible";
  ribbonType?: RibbonType;
  registerBeforeEmbedCore?: () => void;
  registerAfterEmbedCore?: () => void;
}

/**
 * The authoritative Browser View content composition.
 *
 * Host extensions can register dependencies before Embed core starts and extensions that depend on
 * Embed core afterward. The preset still owns the complete shared content and Embed UI order.
 */
export function registerViewRendering(univer: Univer, options: ViewRenderingOptions): void {
  const collaborationOwnsAssetIo = options.assetIoOwner === ViewAssetIoOwner.CollaborationClient;
  registerBasePlugins(
    univer,
    options.container,
    collaborationOwnsAssetIo,
    options.license,
    options.workbenchChrome === "hidden",
    options.ribbonType,
  );
  registerDocPlugins(univer);
  registerSheetPlugins(univer);
  registerSlidePlugins(univer);
  registerBaseUnitPlugins(univer, collaborationOwnsAssetIo);
  registerBoardPlugins(univer);
  options.registerBeforeEmbedCore?.();
  registerEmbedCorePlugin(univer);
  options.registerAfterEmbedCore?.();
  registerEmbedUIPlugin(univer);
}
