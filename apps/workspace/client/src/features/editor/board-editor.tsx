import { UniverBoardsPlugin } from "@univerjs-pro/boards";
import ChartUIEnUS from "@univerjs-pro/chart-ui/locale/en-US";
import ChartUIZhCN from "@univerjs-pro/chart-ui/locale/zh-CN";
import EngineChartEnUS from "@univerjs-pro/engine-chart/locale/en-US";
import EngineChartZhCN from "@univerjs-pro/engine-chart/locale/zh-CN";
import { UniverBoardsChartPlugin } from "@univerjs-pro/boards-chart";
import { UniverBoardsChartUIPlugin } from "@univerjs-pro/boards-chart-ui";
import UniverBoardsChartUIEnUS from "@univerjs-pro/boards-chart-ui/locale/en-US";
import UniverBoardsChartUIZhCN from "@univerjs-pro/boards-chart-ui/locale/zh-CN";
import { UniverBoardsMindPlugin } from "@univerjs-pro/boards-mind";
import { UniverBoardsMindUIPlugin } from "@univerjs-pro/boards-mind-ui";
import UniverBoardsMindUIEnUS from "@univerjs-pro/boards-mind-ui/locale/en-US";
import UniverBoardsMindUIZhCN from "@univerjs-pro/boards-mind-ui/locale/zh-CN";
import { UniverBoardsTablePlugin } from "@univerjs-pro/boards-table";
import { UniverBoardsTableUIPlugin } from "@univerjs-pro/boards-table-ui";
import UniverBoardsTableUIEnUS from "@univerjs-pro/boards-table-ui/locale/en-US";
import UniverBoardsTableUIZhCN from "@univerjs-pro/boards-table-ui/locale/zh-CN";
import { UniverBoardsUIPlugin } from "@univerjs-pro/boards-ui";
import UniverBoardsUIEnUS from "@univerjs-pro/boards-ui/locale/en-US";
import UniverBoardsUIZhCN from "@univerjs-pro/boards-ui/locale/zh-CN";
import { UniverDocsLatexPlugin } from "@univerjs-pro/docs-latex";
import { UniverDocsLatexUIPlugin } from "@univerjs-pro/docs-latex-ui";
import UniverDocsLatexUIEnUS from "@univerjs-pro/docs-latex-ui/locale/en-US";
import UniverDocsLatexUIZhCN from "@univerjs-pro/docs-latex-ui/locale/zh-CN";
import { UniverInkPlugin } from "@univerjs-pro/ink";
import { UniverInkUIPlugin } from "@univerjs-pro/ink-ui";
import UniverInkUIEnUS from "@univerjs-pro/ink-ui/locale/en-US";
import UniverInkUIZhCN from "@univerjs-pro/ink-ui/locale/zh-CN";
import UniverShapeEditorUIEnUS from "@univerjs-pro/shape-editor-ui/locale/en-US";
import UniverShapeEditorUIZhCN from "@univerjs-pro/shape-editor-ui/locale/zh-CN";
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
import { redTheme } from "@univerjs/themes";

import "@univerjs-pro/boards/facade";
import "@univerjs-pro/boards-chart/facade";
import "@univerjs-pro/boards-mind/facade";
import "@univerjs-pro/boards-table/facade";
import "@univerjs-pro/docs-latex/facade";
import "@univerjs-pro/ink/facade";
import "@univerjs-pro/boards-chart-ui/lib/index.css";
import "@univerjs-pro/boards-mind-ui/lib/index.css";
import "@univerjs-pro/boards-table-ui/lib/index.css";
import "@univerjs-pro/boards-ui/lib/index.css";
import "@univerjs-pro/docs-latex-ui/lib/index.css";
import "@univerjs-pro/ink-ui/lib/index.css";
import "@univerjs/docs-ui/lib/index.css";
import "@univerjs/ui/lib/index.css";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "./collaboration-editor";
import { MAX_UNIVER_IMAGE_BYTES } from "./univer-assets";

export type BoardEditorProps = CollaborationEditorProps;

export default createCollaborationEditor({
  label: "board",
  theme: redTheme,
  useCustomCollaborationStatus: true,
  locales: {
    "zh-CN": mergeLocales(
      ChartUIZhCN,
      EngineChartZhCN,
      UniverDesignZhCN,
      UniverUIZhCN,
      UniverDocsUIZhCN,
      UniverDocsLatexUIZhCN,
      UniverDrawingUIZhCN,
      UniverInkUIZhCN,
      UniverShapeEditorUIZhCN,
      UniverBoardsUIZhCN,
      UniverBoardsChartUIZhCN,
      UniverBoardsMindUIZhCN,
      UniverBoardsTableUIZhCN
    ),
    "en-US": mergeLocales(
      ChartUIEnUS,
      EngineChartEnUS,
      UniverDesignEnUS,
      UniverUIEnUS,
      UniverDocsUIEnUS,
      UniverDocsLatexUIEnUS,
      UniverDrawingUIEnUS,
      UniverInkUIEnUS,
      UniverShapeEditorUIEnUS,
      UniverBoardsUIEnUS,
      UniverBoardsChartUIEnUS,
      UniverBoardsMindUIEnUS,
      UniverBoardsTableUIEnUS
    ),
  },
  createPresets: (container) => [
    {
      plugins: [
        UniverRenderEnginePlugin,
        [
          UniverUIPlugin,
          {
            container,
            ribbonType: "grid",
            header: false,
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
        UniverDocsLatexPlugin,
        UniverDocsLatexUIPlugin,
        UniverBoardsPlugin,
        UniverInkPlugin,
        UniverInkUIPlugin,
        UniverBoardsUIPlugin,
        UniverBoardsChartPlugin,
        UniverBoardsChartUIPlugin,
        UniverBoardsMindPlugin,
        UniverBoardsMindUIPlugin,
        UniverBoardsTablePlugin,
        UniverBoardsTableUIPlugin,
      ],
    },
  ],
  load: (univerAPI, unitId) =>
    univerAPI.getCollaboration().loadBoardAsync(unitId),
});
