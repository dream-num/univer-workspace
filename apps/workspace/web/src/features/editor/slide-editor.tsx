import { UniverSlidesPlugin } from "@univerjs-pro/slides";
import ChartUIEnUS from "@univerjs-pro/chart-ui/locale/en-US";
import ChartUIZhCN from "@univerjs-pro/chart-ui/locale/zh-CN";
import EngineChartEnUS from "@univerjs-pro/engine-chart/locale/en-US";
import EngineChartZhCN from "@univerjs-pro/engine-chart/locale/zh-CN";
import UniverSlidesEnUS from "@univerjs-pro/slides/locale/en-US";
import UniverSlidesZhCN from "@univerjs-pro/slides/locale/zh-CN";
import { UniverSlidesChartPlugin } from "@univerjs-pro/slides-chart";
import { UniverSlidesChartUIPlugin } from "@univerjs-pro/slides-chart-ui";
import UniverSlidesChartUIEnUS from "@univerjs-pro/slides-chart-ui/locale/en-US";
import UniverSlidesChartUIZhCN from "@univerjs-pro/slides-chart-ui/locale/zh-CN";
import { UniverSlidesExchangeClientPlugin } from "@univerjs-pro/slides-exchange-client";
import UniverSlidesExchangeClientEnUS from "@univerjs-pro/slides-exchange-client/locale/en-US";
import UniverSlidesExchangeClientZhCN from "@univerjs-pro/slides-exchange-client/locale/zh-CN";
import { UniverSlidesHistoryUIPlugin } from "@univerjs-pro/slides-history-ui";
import SlidesHistoryUIEnUS from "@univerjs-pro/slides-history-ui/locale/en-US";
import SlidesHistoryUIZhCN from "@univerjs-pro/slides-history-ui/locale/zh-CN";
import { UniverSlidesPrintPlugin } from "@univerjs-pro/slides-print";
import UniverSlidesPrintEnUS from "@univerjs-pro/slides-print/locale/en-US";
import UniverSlidesPrintZhCN from "@univerjs-pro/slides-print/locale/zh-CN";
import UniverShapeEditorUIEnUS from "@univerjs-pro/shape-editor-ui/locale/en-US";
import UniverShapeEditorUIZhCN from "@univerjs-pro/shape-editor-ui/locale/zh-CN";
import { UniverSlidesTablePlugin } from "@univerjs-pro/slides-table";
import { UniverSlidesTableUIPlugin } from "@univerjs-pro/slides-table-ui";
import UniverSlidesTableUIEnUS from "@univerjs-pro/slides-table-ui/locale/en-US";
import UniverSlidesTableUIZhCN from "@univerjs-pro/slides-table-ui/locale/zh-CN";
import { UniverSlidesThreadCommentUIPlugin } from "@univerjs-pro/slides-thread-comment-ui";
import SlidesThreadCommentUIEnUS from "@univerjs-pro/slides-thread-comment-ui/locale/en-US";
import SlidesThreadCommentUIZhCN from "@univerjs-pro/slides-thread-comment-ui/locale/zh-CN";
import { UniverSlidesUIPlugin } from "@univerjs-pro/slides-ui";
import UniverSlidesUIEnUS from "@univerjs-pro/slides-ui/locale/en-US";
import UniverSlidesUIZhCN from "@univerjs-pro/slides-ui/locale/zh-CN";
import { IImageIoService } from "@univerjs/core";
import UniverDesignEnUS from "@univerjs/design/locale/en-US";
import UniverDesignZhCN from "@univerjs/design/locale/zh-CN";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import UniverDocsUIEnUS from "@univerjs/docs-ui/locale/en-US";
import UniverDocsUIZhCN from "@univerjs/docs-ui/locale/zh-CN";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import UniverDrawingUIEnUS from "@univerjs/drawing-ui/locale/en-US";
import UniverDrawingUIZhCN from "@univerjs/drawing-ui/locale/zh-CN";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { mergeLocales } from "@univerjs/presets";
import { UniverUIPlugin } from "@univerjs/ui";
import UniverUIEnUS from "@univerjs/ui/locale/en-US";
import UniverUIZhCN from "@univerjs/ui/locale/zh-CN";
import ThreadCommentUIEnUS from "@univerjs/thread-comment-ui/locale/en-US";
import ThreadCommentUIZhCN from "@univerjs/thread-comment-ui/locale/zh-CN";
import { purpleTheme } from "@univerjs/themes";

import "@univerjs-pro/chart-ui/facade";
import "@univerjs-pro/engine-chart/facade";
import "@univerjs-pro/slides/facade";
import "@univerjs-pro/slides-chart/facade";
import "@univerjs-pro/slides-exchange-client/facade";
import "@univerjs-pro/slides-print/facade";
import "@univerjs-pro/slides-table/facade";
import "@univerjs/design/lib/index.css";
import "@univerjs/ui/lib/index.css";
import "@univerjs/docs-ui/lib/index.css";
import "@univerjs/drawing-ui/lib/index.css";
import "@univerjs-pro/chart-ui/lib/index.css";
import "@univerjs-pro/shape-editor-ui/lib/index.css";
import "@univerjs-pro/slides-ui/lib/index.css";
import "@univerjs-pro/slides-chart-ui/lib/index.css";
import "@univerjs-pro/slides-print/lib/index.css";
import "@univerjs-pro/slides-table-ui/lib/index.css";
import "@univerjs-pro/slides-thread-comment-ui/lib/index.css";
import "@univerjs/thread-comment-ui/lib/index.css";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "./collaboration-editor";
import { getThreadCommentCollaborationPlugins } from "./thread-comment-features";
import { MAX_UNIVER_IMAGE_BYTES } from "./univer-assets";

export type SlideEditorProps = CollaborationEditorProps;

export default createCollaborationEditor({
  label: "presentation",
  history: {
    createPlugin: (containerId) => [
      UniverSlidesHistoryUIPlugin,
      {
        historyServerUrl: "/universer-api/history",
        univerContainerId: containerId,
      },
    ],
    locales: {
      "zh-CN": SlidesHistoryUIZhCN,
      "en-US": SlidesHistoryUIEnUS,
    },
  },
  theme: purpleTheme,
  useCustomCollaborationStatus: true,
  locales: {
    "zh-CN": mergeLocales(
      ChartUIZhCN,
      EngineChartZhCN,
      UniverDesignZhCN,
      UniverUIZhCN,
      UniverDocsUIZhCN,
      UniverDrawingUIZhCN,
      UniverSlidesZhCN,
      UniverShapeEditorUIZhCN,
      UniverSlidesUIZhCN,
      UniverSlidesExchangeClientZhCN,
      UniverSlidesPrintZhCN,
      UniverSlidesChartUIZhCN,
      UniverSlidesTableUIZhCN,
      ThreadCommentUIZhCN,
      SlidesThreadCommentUIZhCN
    ),
    "en-US": mergeLocales(
      ChartUIEnUS,
      EngineChartEnUS,
      UniverDesignEnUS,
      UniverUIEnUS,
      UniverDocsUIEnUS,
      UniverDrawingUIEnUS,
      UniverSlidesEnUS,
      UniverShapeEditorUIEnUS,
      UniverSlidesUIEnUS,
      UniverSlidesExchangeClientEnUS,
      UniverSlidesPrintEnUS,
      UniverSlidesChartUIEnUS,
      UniverSlidesTableUIEnUS,
      ThreadCommentUIEnUS,
      SlidesThreadCommentUIEnUS
    ),
  },
  collaborationFeaturePlugins: (collaborationScope) =>
    getThreadCommentCollaborationPlugins(
      collaborationScope.kind === "trunk",
      UniverSlidesThreadCommentUIPlugin
    ),
  exchangeFeaturePlugins: () => [UniverSlidesExchangeClientPlugin],
  printFeaturePlugins: () => [UniverSlidesPrintPlugin],
  createPresets: (container) => [
    {
      plugins: [
        UniverRenderEnginePlugin,
        [
          UniverUIPlugin,
          {
            container,
            ribbonType: "grid",
          },
        ],
        UniverDocsPlugin,
        UniverDocsUIPlugin,
        [
          UniverDrawingPlugin,
          {
            allowImageSize: MAX_UNIVER_IMAGE_BYTES,
            // The collaboration plugin owns the remote image service. Remove
            // Drawing's local implementation to keep a single registration.
            override: [[IImageIoService, null]],
          },
        ],
        UniverSlidesPlugin,
        UniverSlidesUIPlugin,
        UniverSlidesChartPlugin,
        UniverSlidesChartUIPlugin,
        UniverSlidesTablePlugin,
        UniverSlidesTableUIPlugin,
      ],
    },
  ],
  load: (univerAPI, unitId) =>
    univerAPI.getCollaboration().loadSlideAsync(unitId),
});
