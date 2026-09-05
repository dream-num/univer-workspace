/**
 * Browser Viewer content compositions.
 *
 * Keep the unit-specific stacks in one module so the runtime can select a
 * complete, statically bundled composition without importing application
 * source from `apps/workspace`.  The public beta.2 editor packages are the
 * source of truth for these stacks; collaboration and policy remain in their
 * own seams.
 */

import { IImageIoService } from "@univerjs/core";
import type { IPreset, IPresetPlugin } from "@univerjs/presets";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import { UniverDocsDrawingPreset } from "@univerjs/preset-docs-drawing";
import { UniverDocsHyperLinkPreset } from "@univerjs/preset-docs-hyper-link";
import { UniverDocsThreadCommentPreset } from "@univerjs/preset-docs-thread-comment";
import { UniverSheetsAdvancedPreset } from "@univerjs/preset-sheets-advanced";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import { UniverSheetsHyperLinkPreset } from "@univerjs/preset-sheets-hyper-link";
import { UniverSheetsNotePreset } from "@univerjs/preset-sheets-note";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import { UniverSheetsTablePreset } from "@univerjs/preset-sheets-table";
import { UniverSheetsThreadCommentPreset } from "@univerjs/preset-sheets-thread-comment";
import { UniverBasesPlugin } from "@univerjs-pro/bases";
import { UniverBasesExchangeClientPlugin } from "@univerjs-pro/bases-exchange-client";
import { UniverBasesUIPlugin } from "@univerjs-pro/bases-ui";
import { IAttachmentIoService } from "@univerjs-pro/collaboration-client";
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
import { UniverDocsExchangeClientPlugin } from "@univerjs-pro/docs-exchange-client";
import { UniverDocsLatexPlugin } from "@univerjs-pro/docs-latex";
import { UniverDocsLatexUIPlugin } from "@univerjs-pro/docs-latex-ui";
import { UniverDocsListPlugin } from "@univerjs-pro/docs-list";
import { UniverDocsListUIPlugin } from "@univerjs-pro/docs-list-ui";
import { UniverDocsQuotePlugin } from "@univerjs-pro/docs-quote";
import { UniverDocsQuoteUIPlugin } from "@univerjs-pro/docs-quote-ui";
import { UniverDocsShapePlugin } from "@univerjs-pro/docs-shape";
import { UniverDocsShapeUIPlugin } from "@univerjs-pro/docs-shape-ui";
import { UniverDocsTablePlugin } from "@univerjs-pro/docs-table";
import { UniverDocsTableUIPlugin } from "@univerjs-pro/docs-table-ui";
import { UniverExchangeClientPlugin } from "@univerjs-pro/exchange-client";
import { UniverInkPlugin } from "@univerjs-pro/ink";
import { UniverInkUIPlugin } from "@univerjs-pro/ink-ui";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { UniverSlidesPlugin } from "@univerjs-pro/slides";
import { UniverSlidesChartPlugin } from "@univerjs-pro/slides-chart";
import { UniverSlidesChartUIPlugin } from "@univerjs-pro/slides-chart-ui";
import { UniverSlidesExchangeClientPlugin } from "@univerjs-pro/slides-exchange-client";
import { UniverSlidesTablePlugin } from "@univerjs-pro/slides-table";
import { UniverSlidesTableUIPlugin } from "@univerjs-pro/slides-table-ui";
import { UniverSlidesUIPlugin } from "@univerjs-pro/slides-ui";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsDrawingPlugin } from "@univerjs/docs-drawing";
import { UniverDocsDrawingUIPlugin } from "@univerjs/docs-drawing-ui";
import { UniverDocsHyperLinkPlugin } from "@univerjs/docs-hyper-link";
import { UniverDocsHyperLinkUIPlugin } from "@univerjs/docs-hyper-link-ui";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverDrawingUIPlugin } from "@univerjs/drawing-ui";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverUIPlugin } from "@univerjs/ui";
import type { ViewerUnitType } from "../viewer-types.ts";
import type { ViewerUrls } from "./proxy.ts";

// Static facade imports are intentional.  Univer's FUniver extensions are
// registered as module side effects and must be present in the browser bundle
// before a unit is loaded.
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
import "@univerjs-pro/engine-chart/facade";
import "@univerjs-pro/ink/facade";
import "@univerjs-pro/slides/facade";
import "@univerjs-pro/slides-chart/facade";
import "@univerjs-pro/slides-exchange-client/facade";
import "@univerjs-pro/slides-table/facade";
export interface ViewerPresetOptions {
  readonly container: string;
  readonly license: string;
  readonly editable: boolean;
  /** Used by the sheet advanced preset for exchange/print endpoints. */
  readonly universerEndpoint?: string;
  /** DSH-proxied exchange endpoints owned by the selected Viewer scope. */
  readonly exchangeUrls?: ViewerUrls;
}

function preset(plugins: IPresetPlugin[]): IPreset {
  return { plugins };
}

/**
 * Return the complete browser content stack for one Unit type.
 *
 * Every branch includes the render/UI primitives required to mount a canvas;
 * unit-specific model/UI plugins are kept together so adding a new Unit does
 * not silently reuse the Sheet-only preset.
 */
export function createViewerContentPresets(
  options: ViewerPresetOptions & { readonly unitType: ViewerUnitType },
): IPreset[] {
  const { container, license, editable, universerEndpoint = "", exchangeUrls } = options;
  switch (options.unitType) {
    case "sheet":
      // `exactOptionalPropertyTypes` treats an omitted exchangeUrls field
      // differently from `exchangeUrls: undefined`; preserve that distinction
      // for callers that use the preset factory without a proxy override.
      return exchangeUrls === undefined
        ? createSheetPresets({ container, license, editable, universerEndpoint })
        : createSheetPresets({ container, license, editable, universerEndpoint, exchangeUrls });
    case "doc":
      return createDocPresets({ container, editable });
    case "slide":
      return createSlidePresets({ container, editable });
    case "base":
      return createBasePresets({ container, editable });
    case "board":
      return createBoardPresets({ container, editable });
  }
}

function createSheetPresets({
  container,
  license,
  editable,
  universerEndpoint = "",
  exchangeUrls,
}: Pick<
  ViewerPresetOptions,
  "container" | "license" | "editable" | "universerEndpoint" | "exchangeUrls"
>): IPreset[] {
  const coreConfig = {
    container,
    ribbonType: "grid" as const,
    ...(editable
      ? {}
      : ({ header: false, headerMenu: false, toolbar: false, footer: false, contextMenu: false } as const)),
  };
  return [
    UniverSheetsCorePreset(coreConfig),
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
    withViewerExchangeUrls(
      UniverSheetsAdvancedPreset({
        license,
        universerEndpoint,
        print: { enforceWatermark: true },
      }),
      exchangeUrls,
    ),
  ];
}

function createDocPresets({
  container,
  editable,
}: Pick<ViewerPresetOptions, "container" | "editable">): IPreset[] {
  const coreConfig = {
    container,
    ribbonType: "grid" as const,
    ...(editable
      ? {}
      : ({ header: false, headerMenu: false, toolbar: false, footer: false, contextMenu: false } as const)),
  };
  return [
    UniverDocsCorePreset(coreConfig),
    UniverDocsDrawingPreset({ collaboration: true }),
    UniverDocsHyperLinkPreset(),
    UniverDocsThreadCommentPreset(),
    preset([
      [UniverProFormulaEnginePlugin, { notExecuteFormula: false }],
      UniverDocsCalloutPlugin,
      UniverDocsCalloutUIPlugin,
      UniverDocsChartPlugin,
      UniverDocsChartUIPlugin,
      UniverDocsCodePlugin,
      UniverDocsCodeUIPlugin,
      UniverDocsColumnPlugin,
      UniverDocsColumnUIPlugin,
      UniverDocsLatexPlugin,
      UniverDocsLatexUIPlugin,
      UniverDocsListPlugin,
      UniverDocsListUIPlugin,
      UniverDocsQuotePlugin,
      UniverDocsQuoteUIPlugin,
      UniverDocsShapePlugin,
      UniverDocsShapeUIPlugin,
      UniverDocsTablePlugin,
      UniverDocsTableUIPlugin,
    ]),
  ];
}

function createCommonDocumentPlugins(container: string, editable: boolean): IPresetPlugin[] {
  return [
    UniverRenderEnginePlugin,
    [
      UniverUIPlugin,
      {
        container,
        ribbonType: "grid",
        toolbar: editable ? undefined : false,
      },
    ],
    [UniverProFormulaEnginePlugin, { notExecuteFormula: false }],
    UniverDocsPlugin,
    UniverDocsUIPlugin,
    [UniverDrawingPlugin, { override: [[IImageIoService, null]] }],
    UniverDrawingUIPlugin,
    UniverDocsDrawingPlugin,
    UniverDocsDrawingUIPlugin,
    UniverDocsHyperLinkPlugin,
    UniverDocsHyperLinkUIPlugin,
  ];
}

function createSlidePresets({
  container,
  editable,
}: Pick<ViewerPresetOptions, "container" | "editable">): IPreset[] {
  return [
    preset([
      ...createCommonDocumentPlugins(container, editable),
      UniverSlidesPlugin,
      [UniverSlidesUIPlugin, { editor: { enabled: editable } }],
      UniverSlidesChartPlugin,
      UniverSlidesChartUIPlugin,
      UniverSlidesTablePlugin,
      UniverSlidesTableUIPlugin,
    ]),
  ];
}

function createBasePresets({
  container,
  editable,
}: Pick<ViewerPresetOptions, "container" | "editable">): IPreset[] {
  return [
    preset([
      UniverRenderEnginePlugin,
      [UniverProFormulaEnginePlugin, { notExecuteFormula: true }],
      [
        UniverUIPlugin,
        {
          container,
          ribbonType: "grid",
          toolbar: false,
          footer: false,
        },
      ],
      [UniverDrawingPlugin, { override: [[IImageIoService, null]] }],
      UniverDrawingUIPlugin,
      UniverBasesPlugin,
      [
        UniverBasesUIPlugin,
        {
          disableEdit: !editable,
          override: [[IAttachmentIoService, null]],
          workbench: {
            collaborationStatus: false,
            footer: false,
          },
        },
      ],
    ]),
  ];
}

function createBoardPresets({
  container,
  editable,
}: Pick<ViewerPresetOptions, "container" | "editable">): IPreset[] {
  return [
    preset([
      UniverRenderEnginePlugin,
      [
        UniverUIPlugin,
        {
          container,
          ribbonType: "grid",
          header: false,
          toolbar: false,
          footer: false,
        },
      ],
      ...createCommonDocumentPlugins(container, editable).filter((plugin) => {
        const constructor = Array.isArray(plugin) ? plugin[0] : plugin;
        return constructor !== UniverRenderEnginePlugin && constructor !== UniverUIPlugin;
      }),
      UniverDocsLatexPlugin,
      UniverDocsLatexUIPlugin,
      UniverBoardsPlugin,
      UniverInkPlugin,
      UniverInkUIPlugin,
      [
        UniverBoardsUIPlugin,
        {
          showToolbar: editable,
          toolbar: { tools: { [BoardToolType.Import]: editable } },
          workbench: { toolbar: editable },
        },
      ],
      UniverBoardsChartPlugin,
      UniverBoardsChartUIPlugin,
      UniverBoardsMindPlugin,
      UniverBoardsMindUIPlugin,
      UniverBoardsTablePlugin,
      UniverBoardsTableUIPlugin,
    ]),
  ];
}

/** Replace the generic exchange config already owned by the Sheet advanced preset. */
function withViewerExchangeUrls(preset: IPreset, urls: ViewerUrls | undefined): IPreset {
  if (urls === undefined) return preset;
  return {
    ...preset,
    plugins: preset.plugins.map((plugin): IPresetPlugin => {
      if (!Array.isArray(plugin)) return plugin;
      const [PluginConstructor, pluginConfig] = plugin;
      if (PluginConstructor !== UniverExchangeClientPlugin) return plugin;
      return [PluginConstructor, { ...(pluginConfig as object), ...urls }] as IPresetPlugin;
    }),
  };
}

/**
 * Output plugins are kept separate from content presets so the same
 * composition can be used for trunk and worktree views.  The board SDK does
 * not expose a browser exchange client, matching the official editor.
 */
export function createViewerOutputPlugins(
  unitType: ViewerUnitType,
  urls: ViewerUrls,
  enabled: boolean,
): IPresetPlugin[] {
  // SheetsAdvancedPreset owns the generic and Sheet-specific exchange
  // plugins.  Registering the generic client here creates the exact duplicate
  // `UNIVER_EXCHANGE_CLIENT_PLUGIN` failure seen during Viewer bootstrap.
  if (!enabled || unitType === "board" || unitType === "sheet") return [];
  const output: IPresetPlugin[] = [[UniverExchangeClientPlugin, urls]];
  if (unitType === "doc") output.push(UniverDocsExchangeClientPlugin);
  if (unitType === "slide") output.push(UniverSlidesExchangeClientPlugin);
  if (unitType === "base") output.push(UniverBasesExchangeClientPlugin);
  return output;
}
