import { UniverDocsFindReplacePlugin } from "@univerjs/docs-find-replace";
import {
  UniverFindReplaceMobileUIPlugin,
  UniverFindReplacePlugin,
} from "@univerjs/find-replace";
import type { IPresetPlugin } from "@univerjs/presets";
import { UniverDocsCalloutPlugin } from "@univerjs-pro/docs-callout";
import {
  UniverDocsCalloutMobileUIPlugin,
  UniverDocsCalloutUIPlugin,
} from "@univerjs-pro/docs-callout-ui";
import { UniverDocsChartPlugin } from "@univerjs-pro/docs-chart";
import {
  UniverDocsChartMobileUIPlugin,
  UniverDocsChartUIPlugin,
} from "@univerjs-pro/docs-chart-ui";
import { UniverDocsCodePlugin } from "@univerjs-pro/docs-code";
import {
  UniverDocsCodeMobileUIPlugin,
  UniverDocsCodeUIPlugin,
} from "@univerjs-pro/docs-code-ui";
import { UniverDocsColumnPlugin } from "@univerjs-pro/docs-column";
import {
  UniverDocsColumnMobileUIPlugin,
  UniverDocsColumnUIPlugin,
} from "@univerjs-pro/docs-column-ui";
import { UniverDocsLatexPlugin } from "@univerjs-pro/docs-latex";
import {
  UniverDocsLatexMobileUIPlugin,
  UniverDocsLatexUIPlugin,
} from "@univerjs-pro/docs-latex-ui";
import { UniverDocsListPlugin } from "@univerjs-pro/docs-list";
import {
  UniverDocsListMobileUIPlugin,
  UniverDocsListUIPlugin,
} from "@univerjs-pro/docs-list-ui";
import { UniverDocsQuotePlugin } from "@univerjs-pro/docs-quote";
import {
  UniverDocsQuoteMobileUIPlugin,
  UniverDocsQuoteUIPlugin,
} from "@univerjs-pro/docs-quote-ui";
import { UniverDocsShapePlugin } from "@univerjs-pro/docs-shape";
import {
  UniverDocsShapeMobileUIPlugin,
  UniverDocsShapeUIPlugin,
} from "@univerjs-pro/docs-shape-ui";
import { UniverDocsTablePlugin } from "@univerjs-pro/docs-table";
import {
  UniverDocsTableMobileUIPlugin,
  UniverDocsTableUIPlugin,
} from "@univerjs-pro/docs-table-ui";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";

/**
 * Keep the browser Doc Apply surface aligned with the server runtime. These
 * plugins own persisted Doc commands or resources, so they must be present
 * even when the Workspace UI does not expose every authoring control.
 */
export function getDocReplayCompatibilityPlugins(): IPresetPlugin[] {
  return [
    UniverDocsCalloutPlugin,
    UniverDocsChartPlugin,
    UniverDocsCodePlugin,
    UniverDocsColumnPlugin,
    UniverDocsLatexPlugin,
    UniverDocsListPlugin,
    UniverDocsQuotePlugin,
    UniverDocsShapePlugin,
    UniverDocsTablePlugin,
  ];
}

/**
 * Pair each persisted Doc feature with its authoring UI. Keeping this list
 * separate from replay compatibility makes the server-safe feature surface
 * explicit while allowing the browser editor to expose insertion controls.
 */
export function getDocAuthoringUIPlugins(): IPresetPlugin[] {
  return [
    UniverProFormulaEnginePlugin,
    UniverDocsCalloutUIPlugin,
    UniverDocsChartUIPlugin,
    UniverDocsCodeUIPlugin,
    UniverDocsColumnUIPlugin,
    UniverDocsLatexUIPlugin,
    UniverDocsListUIPlugin,
    UniverDocsQuoteUIPlugin,
    UniverDocsShapeUIPlugin,
    UniverDocsTableUIPlugin,
  ];
}

/** Touch counterpart of getDocAuthoringUIPlugins for the mobile Doc editor. */
export function getDocMobileAuthoringUIPlugins(): IPresetPlugin[] {
  return [
    UniverProFormulaEnginePlugin,
    UniverDocsCalloutMobileUIPlugin,
    UniverDocsChartMobileUIPlugin,
    UniverDocsCodeMobileUIPlugin,
    UniverDocsColumnMobileUIPlugin,
    UniverDocsLatexMobileUIPlugin,
    UniverDocsListMobileUIPlugin,
    UniverDocsQuoteMobileUIPlugin,
    UniverDocsShapeMobileUIPlugin,
    UniverDocsTableMobileUIPlugin,
  ];
}

/**
 * Find and replace for the Doc editors only; the comparison viewer stays
 * read-only. Both find-replace UI plugins share one pluginName, which
 * UniverDocsFindReplacePlugin declares as its dependency.
 */
export function getDocFindReplacePlugins(): IPresetPlugin[] {
  return [UniverFindReplacePlugin, UniverDocsFindReplacePlugin];
}

/** Touch counterpart of getDocFindReplacePlugins for the mobile Doc editor. */
export function getDocMobileFindReplacePlugins(): IPresetPlugin[] {
  return [UniverFindReplaceMobileUIPlugin, UniverDocsFindReplacePlugin];
}
