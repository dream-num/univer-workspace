import type { IPresetPlugin } from "@univerjs/presets";
import { UniverDocsCalloutPlugin } from "@univerjs-pro/docs-callout";
import { UniverDocsCalloutUIPlugin } from "@univerjs-pro/docs-callout-ui";
import { UniverDocsChartPlugin } from "@univerjs-pro/docs-chart";
import { UniverDocsChartUIPlugin } from "@univerjs-pro/docs-chart-ui";
import { UniverDocsCodePlugin } from "@univerjs-pro/docs-code";
import { UniverDocsCodeUIPlugin } from "@univerjs-pro/docs-code-ui";
import { UniverDocsLatexPlugin } from "@univerjs-pro/docs-latex";
import { UniverDocsLatexUIPlugin } from "@univerjs-pro/docs-latex-ui";
import { UniverDocsShapePlugin } from "@univerjs-pro/docs-shape";
import { UniverDocsShapeUIPlugin } from "@univerjs-pro/docs-shape-ui";
import { UniverDocsTablePlugin } from "@univerjs-pro/docs-table";
import { UniverDocsTableUIPlugin } from "@univerjs-pro/docs-table-ui";
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
    UniverDocsLatexPlugin,
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
    UniverDocsLatexUIPlugin,
    UniverDocsShapeUIPlugin,
    UniverDocsTableUIPlugin,
  ];
}
