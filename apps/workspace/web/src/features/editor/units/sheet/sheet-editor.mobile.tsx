import { UniverExchangeClientMobileUIPlugin } from "@univerjs-pro/exchange-client";
import { UniverSheetsExchangeClientMobileUIPlugin } from "@univerjs-pro/sheets-exchange-client";
import { UniverSheetsHistoryMobileUIPlugin } from "@univerjs-pro/sheets-history-ui";
import SheetsHistoryUIEnUS from "@univerjs-pro/sheets-history-ui/locale/en-US";
import SheetsHistoryUIZhCN from "@univerjs-pro/sheets-history-ui/locale/zh-CN";
import { UniverSheetsThreadCommentMobileUIPlugin } from "@univerjs/sheets-thread-comment-ui";

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

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "../../collaboration-editor";
import { createWorkspaceExchangeClientConfig } from "../../features/exchange-plugins";
import { getThreadCommentCollaborationPlugins } from "../../features/thread-comment-features";
import { createSheetMobilePresets } from "./sheet-mobile-presets";
import { sheetEditorLocales } from "./sheet-presets";

export type SheetEditorProps = CollaborationEditorProps;

export default createCollaborationEditor({
  label: "spreadsheet",
  history: {
    providedByPreset: false,
    createPlugin: (containerId) => [
      UniverSheetsHistoryMobileUIPlugin,
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
  // The Mobile exchange variants share pluginName with the desktop
  // UniverExchangeClientPlugin the factory would register when this flag is
  // false; duplicate names throw at startup. Keep the factory's gating
  // (trunk scope, signed-in user) via exchangeFeaturePlugins instead.
  exchangeProvidedByPreset: true,
  locales: sheetEditorLocales,
  createPresets: (container, _license, collaborationScope) =>
    createSheetMobilePresets({
      container,
      threadCommentsEnabled: collaborationScope.kind === "trunk",
      collaborationEnabled: true,
    }),
  collaborationFeaturePlugins: (collaborationScope) =>
    getThreadCommentCollaborationPlugins(
      collaborationScope.kind === "trunk",
      UniverSheetsThreadCommentMobileUIPlugin
    ),
  exchangeFeaturePlugins: () => [
    [
      UniverExchangeClientMobileUIPlugin,
      createWorkspaceExchangeClientConfig(window.location.origin),
    ],
    [
      UniverSheetsExchangeClientMobileUIPlugin,
      { minSheetRowCount: 100, minSheetColumnCount: 20 },
    ],
  ],
  load: (univerAPI, unitId) =>
    univerAPI.getCollaboration().loadSheetAsync(unitId),
});
