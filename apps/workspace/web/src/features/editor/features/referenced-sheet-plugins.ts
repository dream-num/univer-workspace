import type { IPresetPlugin } from "@univerjs/presets";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsConditionalFormattingPlugin } from "@univerjs/sheets-conditional-formatting";
import { UniverSheetsDataValidationPlugin } from "@univerjs/sheets-data-validation";
import { UniverSheetsDrawingPlugin } from "@univerjs/sheets-drawing";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsHyperLinkPlugin } from "@univerjs/sheets-hyper-link";
import { UniverSheetsNotePlugin } from "@univerjs/sheets-note";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverSheetsSortPlugin } from "@univerjs/sheets-sort";
import { UniverSheetsTablePlugin } from "@univerjs/sheets-table";
import { UniverSheetsThreadCommentPlugin } from "@univerjs/sheets-thread-comment";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { UniverSheetsChartPlugin } from "@univerjs-pro/sheets-chart";
import { UniverSheetsOutlinePlugin } from "@univerjs-pro/sheets-outline";
import { UniverSheetsPivotTablePlugin } from "@univerjs-pro/sheets-pivot";
import { UniverSheetsShapePlugin } from "@univerjs-pro/sheets-shape";
import { UniverSheetSparklinePlugin } from "@univerjs-pro/sheets-sparkline";

/**
 * Doc and Slide references materialize Sheet sources in the host Univer instance.
 * Register the Sheet data features before loading either unit so SnapshotService
 * can replay source changesets and formulas can read their resources. These are
 * the model plugins used by our Sheet editor, without its UI, history or transport.
 * Full Sheets registration also provides RefRangeService for collaboration cursors.
 */
export function getReferencedSheetPlugins(): IPresetPlugin[] {
  return [
    UniverProFormulaEnginePlugin,
    UniverSheetsPlugin,
    UniverSheetsFormulaPlugin,
    UniverSheetsNumfmtPlugin,
    UniverSheetsDrawingPlugin,
    UniverSheetsConditionalFormattingPlugin,
    UniverSheetsDataValidationPlugin,
    UniverSheetsFilterPlugin,
    UniverSheetsHyperLinkPlugin,
    UniverSheetsNotePlugin,
    UniverSheetsSortPlugin,
    UniverSheetsTablePlugin,
    UniverSheetsThreadCommentPlugin,
    UniverSheetsChartPlugin,
    UniverSheetsOutlinePlugin,
    UniverSheetsPivotTablePlugin,
    UniverSheetsShapePlugin,
    UniverSheetSparklinePlugin,
  ];
}
