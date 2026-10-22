import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-note/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-table/lib/index.css";
import "@univerjs/preset-sheets-advanced/lib/index.css";

import type { IPreset } from "@univerjs/presets";
import { threadCommentComposition } from "../../features/thread-comments";
import { createSheetEditorPresets } from "./sheet-presets";

export { sheetEditorLocales } from "./sheet-presets";

/** Local, hidden-chrome Sheet stack for comparison panes and embedded products. */
export function createSheetComparisonPresets(options: {
  readonly container: HTMLElement;
  readonly license: string;
}): IPreset[] {
  return [
    ...createSheetEditorPresets({
      ...options,
      universerEndpoint: window.location.origin,
      collaborationEnabled: false,
      workbenchChrome: "hidden",
    }),
    ...threadCommentComposition("sheet", "comparison").presets,
  ];
}
