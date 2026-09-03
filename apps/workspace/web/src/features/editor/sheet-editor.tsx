import { UniverSheetsHistoryUIPlugin } from "@univerjs-pro/sheets-history-ui";
import SheetsHistoryUIEnUS from "@univerjs-pro/sheets-history-ui/locale/en-US";
import SheetsHistoryUIZhCN from "@univerjs-pro/sheets-history-ui/locale/zh-CN";

import "@univerjs-pro/sheets-history-ui/lib/index.css";
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
import "@univerjs/preset-sheets-thread-comment/lib/index.css";
import "@univerjs/preset-sheets-advanced/lib/index.css";
import "@univerjs/preset-sheets-collaboration/lib/index.css";

import { greenTheme } from "@univerjs/themes";
import { UniverInstanceType } from "@univerjs/core";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "./collaboration-editor";
import {
  createSheetEditorPresets,
  sheetEditorLocales,
} from "./sheet-presets";
import { getThreadCommentCollaborationPlugins } from "./thread-comment-features";

export type SheetEditorProps = CollaborationEditorProps;

export default createCollaborationEditor({
  label: "spreadsheet",
  unitType: UniverInstanceType.UNIVER_SHEET,
  history: {
    providedByPreset: true,
    createPlugin: (containerId) => [
      UniverSheetsHistoryUIPlugin,
      {
        historyServerUrl: "/universer-api/history",
        univerContainerId: containerId,
      },
    ],
    locales: {
      "zh-CN": SheetsHistoryUIZhCN,
      "en-US": SheetsHistoryUIEnUS,
    },
  },
  theme: greenTheme,
  collaborationProvidedByPreset: true,
  exchangeProvidedByPreset: true,
  licenseProvidedByPreset: true,
  locales: sheetEditorLocales,
  createPresets: (container, license, collaborationScope, runtime) =>
    createSheetEditorPresets({
      container,
      license,
      universerEndpoint: window.location.origin,
      threadCommentsEnabled: collaborationScope.kind === "trunk",
      collaborationEnabled: runtime === "collaboration",
    }),
  collaborationFeaturePlugins: (collaborationScope) =>
    getThreadCommentCollaborationPlugins(
      collaborationScope.kind === "trunk"
    ),
  load: (univerAPI, unitId) =>
    univerAPI.getCollaboration().loadSheetAsync(unitId),
});
