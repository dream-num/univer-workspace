import { UniverBasesPlugin } from "@univerjs-pro/bases";
import UniverBasesEnUS from "@univerjs-pro/bases/locale/en-US";
import UniverBasesZhCN from "@univerjs-pro/bases/locale/zh-CN";
import { UniverBasesExchangeClientPlugin } from "@univerjs-pro/bases-exchange-client";
import UniverBasesExchangeClientEnUS from "@univerjs-pro/bases-exchange-client/locale/en-US";
import UniverBasesExchangeClientZhCN from "@univerjs-pro/bases-exchange-client/locale/zh-CN";
import { UniverBasesHistoryUIPlugin } from "@univerjs-pro/bases-history-ui";
import BasesHistoryUIEnUS from "@univerjs-pro/bases-history-ui/locale/en-US";
import BasesHistoryUIZhCN from "@univerjs-pro/bases-history-ui/locale/zh-CN";
import { UniverBasesThreadCommentUIPlugin } from "@univerjs-pro/bases-thread-comment-ui";
import BasesThreadCommentUIEnUS from "@univerjs-pro/bases-thread-comment-ui/locale/en-US";
import BasesThreadCommentUIZhCN from "@univerjs-pro/bases-thread-comment-ui/locale/zh-CN";
import { UniverBasesUIPlugin } from "@univerjs-pro/bases-ui";
import UniverBasesUIEnUS from "@univerjs-pro/bases-ui/locale/en-US";
import UniverBasesUIZhCN from "@univerjs-pro/bases-ui/locale/zh-CN";
import { IAttachmentIoService } from "@univerjs-pro/collaboration-client";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { IImageIoService } from "@univerjs/core";
import UniverDesignEnUS from "@univerjs/design/locale/en-US";
import UniverDesignZhCN from "@univerjs/design/locale/zh-CN";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import UniverEngineFormulaEnUS from "@univerjs/engine-formula/locale/en-US";
import UniverEngineFormulaZhCN from "@univerjs/engine-formula/locale/zh-CN";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { mergeLocales } from "@univerjs/presets";
import { UniverRPCMainThreadPlugin } from "@univerjs/rpc";
import { UniverUIPlugin } from "@univerjs/ui";
import UniverUIEnUS from "@univerjs/ui/locale/en-US";
import UniverUIZhCN from "@univerjs/ui/locale/zh-CN";
import ThreadCommentUIEnUS from "@univerjs/thread-comment-ui/locale/en-US";
import ThreadCommentUIZhCN from "@univerjs/thread-comment-ui/locale/zh-CN";
import { yellowTheme } from "@univerjs/themes";

import "@univerjs-pro/bases/facade";
import "@univerjs-pro/bases-exchange-client/facade";
import "@univerjs-pro/bases-ui/facade";
import "@univerjs-pro/bases-history-ui/lib/index.css";
import "@univerjs-pro/bases-thread-comment-ui/lib/index.css";
import "@univerjs/design/lib/index.css";
import "@univerjs/ui/lib/index.css";
import "@univerjs-pro/bases-ui/lib/index.css";
import "@univerjs-pro/bases-exchange-client/lib/index.css";
import "@univerjs/thread-comment-ui/lib/index.css";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "./collaboration-editor";
import { getThreadCommentCollaborationPlugins } from "./thread-comment-features";
import { MAX_UNIVER_IMAGE_BYTES } from "./univer-assets";

export type BaseEditorProps = CollaborationEditorProps;

export default createCollaborationEditor({
  label: "base",
  history: {
    createPlugin: (containerId) => [
      UniverBasesHistoryUIPlugin,
      {
        historyServerUrl: "/universer-api/history",
        univerContainerId: containerId,
      },
    ],
    locales: {
      "zh-CN": BasesHistoryUIZhCN,
      "en-US": BasesHistoryUIEnUS,
    },
  },
  theme: yellowTheme,
  enableDocumentCollaborationUI: false,
  hideCollaborationStatus: true,
  locales: {
    "zh-CN": mergeLocales(
      UniverDesignZhCN,
      UniverUIZhCN,
      UniverEngineFormulaZhCN,
      UniverBasesZhCN,
      UniverBasesExchangeClientZhCN,
      UniverBasesUIZhCN,
      ThreadCommentUIZhCN,
      BasesThreadCommentUIZhCN
    ),
    "en-US": mergeLocales(
      UniverDesignEnUS,
      UniverUIEnUS,
      UniverEngineFormulaEnUS,
      UniverBasesEnUS,
      UniverBasesExchangeClientEnUS,
      UniverBasesUIEnUS,
      ThreadCommentUIEnUS,
      BasesThreadCommentUIEnUS
    ),
  },
  collaborationFeaturePlugins: (collaborationScope) =>
    getThreadCommentCollaborationPlugins(
      collaborationScope.kind === "trunk",
      UniverBasesThreadCommentUIPlugin
    ),
  exchangeFeaturePlugins: () => [UniverBasesExchangeClientPlugin],
  createPresets: (container) => [
    {
      plugins: [
        UniverRenderEnginePlugin,
        [
          UniverProFormulaEnginePlugin,
          {
            notExecuteFormula: true,
          },
        ],
        [
          UniverUIPlugin,
          {
            container,
            ribbonType: "grid",
            toolbar: false,
            footer: false,
          },
        ],
        [
          UniverRPCMainThreadPlugin,
          {
            workerURL: new Worker(new URL("./base-worker.ts", import.meta.url), {
              type: "module",
            }),
          },
        ],
        [
          UniverDrawingPlugin,
          {
            allowImageSize: MAX_UNIVER_IMAGE_BYTES,
            // The collaboration plugin owns the remote image service. Remove
            // Drawing's local implementation to keep a single registration.
            override: [[IImageIoService, null]],
          },
        ],
        UniverBasesPlugin,
        [
          UniverBasesUIPlugin,
          {
            override: [[IAttachmentIoService, null]],
            workbench: {
              collaborationStatus: false,
              footer: false,
            },
          },
        ],
      ],
    },
  ],
  load: (univerAPI, unitId) =>
    univerAPI.getCollaboration().loadBaseAsync(unitId),
});
