/**
 * The browser Viewer composition.
 *
 * This is deliberately kept as a registration pipeline instead of relying on
 * the convenience presets.  The order is the same as the dsh-univer-office
 * viewer: shared engine/model plugins, product plugins, collaboration hooks,
 * output plugins, Embed core, and finally Embed UI.  Keeping the order here
 * makes the dependency boundary explicit and prevents a preset update from
 * silently dropping a Unit type.
 */

import {
  ICommandService,
  IImageIoService,
  IUniverInstanceService,
  UniverInstanceType,
  type Univer,
} from "@univerjs/core";
import { IAttachmentIoService } from "@univerjs-pro/collaboration-client";
import {
  BoardToolType,
  UniverBoardsPlugin,
} from "@univerjs-pro/boards";
import { UniverBoardsChartPlugin } from "@univerjs-pro/boards-chart";
import { UniverBoardsChartUIPlugin } from "@univerjs-pro/boards-chart-ui";
import { UniverBoardsMindPlugin } from "@univerjs-pro/boards-mind";
import { UniverBoardsMindUIPlugin } from "@univerjs-pro/boards-mind-ui";
import { UniverBoardsPrintPlugin } from "@univerjs-pro/boards-print";
import { UniverBoardsTablePlugin } from "@univerjs-pro/boards-table";
import { UniverBoardsTableUIPlugin } from "@univerjs-pro/boards-table-ui";
import { UniverBoardsUIPlugin } from "@univerjs-pro/boards-ui";
import { UniverBasesPlugin } from "@univerjs-pro/bases";
import { UniverBasesExchangeClientPlugin } from "@univerjs-pro/bases-exchange-client";
import { UniverBasesUIPlugin } from "@univerjs-pro/bases-ui";
import { UniverDocsCalloutPlugin } from "@univerjs-pro/docs-callout";
import { UniverDocsCalloutUIPlugin } from "@univerjs-pro/docs-callout-ui";
import { UniverDocsChartPlugin } from "@univerjs-pro/docs-chart";
import { UniverDocsChartUIPlugin } from "@univerjs-pro/docs-chart-ui";
import { UniverDocsCodePlugin } from "@univerjs-pro/docs-code";
import { UniverDocsCodeUIPlugin } from "@univerjs-pro/docs-code-ui";
import { UniverDocsColumnPlugin } from "@univerjs-pro/docs-column";
import { UniverDocsColumnUIPlugin } from "@univerjs-pro/docs-column-ui";
import { UniverDocsExchangeClientPlugin } from "@univerjs-pro/docs-exchange-client";
import { UniverDocsListPlugin } from "@univerjs-pro/docs-list";
import { UniverDocsListUIPlugin } from "@univerjs-pro/docs-list-ui";
import { UniverDocsPrintPlugin } from "@univerjs-pro/docs-print";
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
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { UniverRangePreprocessPlugin } from "@univerjs-pro/range-preprocess";
import { UniverSheetsChartPlugin } from "@univerjs-pro/sheets-chart";
import { UniverSheetsChartUIPlugin } from "@univerjs-pro/sheets-chart-ui";
import { UniverSheetsExchangeClientPlugin } from "@univerjs-pro/sheets-exchange-client";
import { UniverSheetsOutlinePlugin } from "@univerjs-pro/sheets-outline";
import { UniverSheetsOutlineUIPlugin } from "@univerjs-pro/sheets-outline-ui";
import {
  UniverSheetsPivotTablePlugin,
} from "@univerjs-pro/sheets-pivot";
import { UniverSheetsPivotTableUIPlugin } from "@univerjs-pro/sheets-pivot-ui";
import { UniverSheetsPrintPlugin } from "@univerjs-pro/sheets-print";
import { UniverSheetsShapePlugin } from "@univerjs-pro/sheets-shape";
import { UniverSheetsShapeUIPlugin } from "@univerjs-pro/sheets-shape-ui";
import {
  UniverSheetSparklinePlugin,
} from "@univerjs-pro/sheets-sparkline";
import { UniverSheetSparklineUIPlugin } from "@univerjs-pro/sheets-sparkline-ui";
import { UniverSlidesPlugin } from "@univerjs-pro/slides";
import { UniverSlidesChartPlugin } from "@univerjs-pro/slides-chart";
import { UniverSlidesChartUIPlugin } from "@univerjs-pro/slides-chart-ui";
import { UniverSlidesExchangeClientPlugin } from "@univerjs-pro/slides-exchange-client";
import { UniverSlidesPrintPlugin } from "@univerjs-pro/slides-print";
import { UniverSlidesTablePlugin } from "@univerjs-pro/slides-table";
import { UniverSlidesTableUIPlugin } from "@univerjs-pro/slides-table-ui";
import { UniverSlidesUIPlugin } from "@univerjs-pro/slides-ui";
import { UniverDataValidationPlugin } from "@univerjs/data-validation";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import { UniverDocsDrawingPlugin } from "@univerjs/docs-drawing";
import { UniverDocsDrawingUIPlugin } from "@univerjs/docs-drawing-ui";
import { UniverDocsHyperLinkPlugin } from "@univerjs/docs-hyper-link";
import { UniverDocsHyperLinkUIPlugin } from "@univerjs/docs-hyper-link-ui";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverDrawingUIPlugin } from "@univerjs/drawing-ui";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsUIPlugin } from "@univerjs/sheets-ui";
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
import { UniverUIPlugin, type RibbonType } from "@univerjs/ui";
import {
  FormulaCalculationSessionService,
  SetTriggerFormulaCalculationStartMutation,
} from "@univerjs/engine-formula";
import { UniverLicensePlugin } from "@univerjs-pro/license";
import type { IEmbedResourceRefDataProviderRegistration } from "@univerjs-pro/embed";
import {
  IReferencedUnitManagerService,
  UniverEmbedPlugin,
} from "@univerjs-pro/embed";
import { UniverEmbedUIPlugin } from "@univerjs-pro/embed-ui";
import type { ViewerUnitType } from "../viewer-types.ts";
import type { ViewerUrls } from "./proxy.ts";
import { UniverSheetsImportRangeFormulaPlugin } from "./importrange-formula/index.ts";
import {
  COLLABORATION_SHEET_RESOURCE_REF_DATA_PROVIDER_ID,
  createBaseResourceRefDataProviderRegistration,
  createSheetResourceRefDataProvider,
} from "./resource-ref.ts";

// Facade modules are side-effect registrations. Keep these imports static;
// loading them after a Unit has been created leaves FUniver methods absent.
import "@univerjs-pro/bases/facade";
import "@univerjs-pro/bases-exchange-client/facade";
import "@univerjs-pro/boards/facade";
import "@univerjs-pro/boards-chart/facade";
import "@univerjs-pro/boards-mind/facade";
import "@univerjs-pro/boards-table/facade";
import "@univerjs-pro/boards-ui/facade";
import "@univerjs-pro/chart-ui/facade";
import "@univerjs-pro/docs-callout/facade";
import "@univerjs-pro/docs-chart/facade";
import "@univerjs-pro/docs-code/facade";
import "@univerjs-pro/docs-column/facade";
import "@univerjs-pro/docs-exchange-client/facade";
import "@univerjs-pro/docs-latex/facade";
import "@univerjs-pro/docs-list/facade";
import "@univerjs-pro/docs-quote/facade";
import "@univerjs-pro/docs-shape/facade";
import "@univerjs-pro/docs-table/facade";
import "@univerjs-pro/embed/facade";
import "@univerjs-pro/engine-chart/facade";
import "@univerjs-pro/engine-formula/facade";
import "@univerjs-pro/ink/facade";
import "@univerjs-pro/exchange-client/facade";
import "@univerjs-pro/sheets-chart/facade";
import "@univerjs-pro/sheets-exchange-client/facade";
import "@univerjs-pro/sheets-outline/facade";
import "@univerjs-pro/sheets-pivot/facade";
import "@univerjs-pro/sheets-print/facade";
import "@univerjs-pro/sheets-shape/facade";
import "@univerjs-pro/sheets-sparkline/facade";
import "@univerjs-pro/slides/facade";
import "@univerjs-pro/slides-chart/facade";
import "@univerjs-pro/slides-exchange-client/facade";
import "@univerjs-pro/slides-print/facade";
import "@univerjs-pro/slides-table/facade";
import "@univerjs/docs/facade";
import "@univerjs/sheets/facade";

export interface ViewExchangeClientConfig {
  readonly uploadFileServerUrl: string;
  readonly getTaskServerUrl: string;
  readonly signUrlServerUrl: string;
  readonly importServerUrl: string;
  readonly exportServerUrl: string;
  readonly downloadEndpointUrl: string;
}

export enum ViewAssetIoOwner {
  Local = "local",
  CollaborationClient = "collaboration-client",
}

export interface ViewRenderingOptions {
  readonly container: string;
  readonly assetIoOwner: ViewAssetIoOwner;
  readonly license: string;
  readonly workbenchChrome: "hidden" | "visible";
  readonly ribbonType?: RibbonType;
  /** Omit for a headless/local composition that does not need output plugins. */
  readonly unitType?: UniverInstanceType;
  readonly exchangeClientConfig?: ViewExchangeClientConfig;
  readonly resourceRefDataProviderRegistrations?: readonly IEmbedResourceRefDataProviderRegistration[];
  readonly registerBeforeEmbedCore?: () => void;
  readonly registerAfterEmbedCore?: () => void;
}

/** Register the complete Office-compatible browser composition. */
export function registerViewerRendering(
  univer: Univer,
  options: ViewRenderingOptions,
): void {
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
  if (options.unitType !== undefined) {
    registerOutputPlugins(univer, options.unitType, options.exchangeClientConfig);
  }
  registerEmbedCorePlugin(
    univer,
    options.resourceRefDataProviderRegistrations ?? [],
  );
  options.registerAfterEmbedCore?.();
  registerEmbedUIPlugin(univer);
}

function registerBasePlugins(
  univer: Univer,
  container: string,
  collaborationOwnsAssetIo: boolean,
  license: string,
  hideWorkbenchChrome: boolean,
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
  // The Pro formula plugin is needed even for read-only documents: it owns
  // external-reference models used by Embed and the history viewer.
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
  // Thread comment collaboration storage is not exposed by the Workspace
  // adapter yet. The native UI remains available where the SDK supplies it;
  // no client-side fake persistence is installed here.
}

function registerSheetPlugins(univer: Univer): void {
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsUIPlugin);
  univer.registerPlugin(UniverSheetsOutlinePlugin);
  univer.registerPlugin(UniverSheetsOutlineUIPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.registerPlugin(UniverSheetsFormulaUIPlugin);
  // Private in-repo IMPORTRANGE composition, matching Office's registration
  // order. Univer resolves its declared Embed dependency after all plugins
  // have been registered.
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

function registerBoardPlugins(univer: Univer): void {
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

function registerOutputPlugins(
  univer: Univer,
  unitType: UniverInstanceType,
  exchangeClientConfig: ViewExchangeClientConfig | undefined,
): void {
  const registerExchange = (): void => {
    if (exchangeClientConfig !== undefined) {
      univer.registerPlugin(UniverExchangeClientPlugin, exchangeClientConfig);
    }
  };
  switch (unitType) {
    case UniverInstanceType.UNIVER_SHEET:
      univer.registerPlugin(UniverSheetsPrintPlugin);
      registerExchange();
      if (exchangeClientConfig !== undefined) {
        univer.registerPlugin(UniverSheetsExchangeClientPlugin);
      }
      return;
    case UniverInstanceType.UNIVER_DOC:
      registerExchange();
      if (exchangeClientConfig !== undefined) {
        univer.registerPlugin(UniverDocsExchangeClientPlugin);
      }
      univer.registerPlugin(UniverDocsPrintPlugin);
      return;
    case UniverInstanceType.UNIVER_SLIDE:
      registerExchange();
      if (exchangeClientConfig !== undefined) {
        univer.registerPlugin(UniverSlidesExchangeClientPlugin);
      }
      univer.registerPlugin(UniverSlidesPrintPlugin);
      return;
    case UniverInstanceType.UNIVER_BASE:
      registerExchange();
      if (exchangeClientConfig !== undefined) {
        univer.registerPlugin(UniverBasesExchangeClientPlugin);
      }
      return;
    case UniverInstanceType.UNIVER_BOARD:
      univer.registerPlugin(UniverBoardsPrintPlugin);
      return;
    default:
      throw new Error(`Unsupported Browser View Unit type: ${String(unitType)}`);
  }
}

function registerEmbedCorePlugin(
  univer: Univer,
  registrations: readonly IEmbedResourceRefDataProviderRegistration[],
): void {
  const injector = univer.__getInjector();
  const baseRegistration = createBaseResourceRefDataProviderRegistration(() => ({
    referencedUnitManager: injector.get(IReferencedUnitManagerService),
    univerInstanceService: injector.get(IUniverInstanceService),
  }));
  // The collaboration viewer creates the Sheet provider up front so it can
  // subscribe to formula-result events. Reusing that registration here is
  // essential: Embed rejects duplicate registration IDs in one Univer
  // instance, which otherwise leaves every viewer with a noisy runtime error.
  const providedSheetRegistration = registrations.find(
    ({ registrationId }) =>
      registrationId === COLLABORATION_SHEET_RESOURCE_REF_DATA_PROVIDER_ID,
  );
  const ownedSheetRegistration = providedSheetRegistration
    ? undefined
    : createSheetResourceRefDataProvider(() => ({
        referencedUnitManager: injector.get(IReferencedUnitManagerService),
        univerInstanceService: injector.get(IUniverInstanceService),
        waitForFormulaResultApplied: () =>
          injector.get(FormulaCalculationSessionService).waitForLatestApplied(),
        executeFormulaCalculation: () => {
          void injector.get(ICommandService).executeCommand(
            SetTriggerFormulaCalculationStartMutation.id,
            { commands: [], forceCalculation: true },
            { onlyLocal: true },
          );
        },
      }));
  univer.registerPlugin(UniverEmbedPlugin, {
    resourceRefDataProviderRegistrations: [
      baseRegistration,
      ...(ownedSheetRegistration ? [ownedSheetRegistration.registration] : []),
      ...registrations,
    ],
  });
  univer.onDispose(() => {
    ownedSheetRegistration?.dispose();
  });
}

function registerEmbedUIPlugin(univer: Univer): void {
  univer.registerPlugin(UniverEmbedUIPlugin);
}
