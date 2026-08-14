import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import UniverPresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import UniverPresetDocsCoreZhCN from "@univerjs/preset-docs-core/locales/zh-CN";
import { UniverDocsDrawingPreset } from "@univerjs/preset-docs-drawing";
import UniverPresetDocsDrawingEnUS from "@univerjs/preset-docs-drawing/locales/en-US";
import UniverPresetDocsDrawingZhCN from "@univerjs/preset-docs-drawing/locales/zh-CN";
import { UniverDocsHyperLinkPreset } from "@univerjs/preset-docs-hyper-link";
import UniverPresetDocsHyperLinkEnUS from "@univerjs/preset-docs-hyper-link/locales/en-US";
import UniverPresetDocsHyperLinkZhCN from "@univerjs/preset-docs-hyper-link/locales/zh-CN";
import { UniverDocsThreadCommentPreset } from "@univerjs/preset-docs-thread-comment";
import UniverPresetDocsThreadCommentEnUS from "@univerjs/preset-docs-thread-comment/locales/en-US";
import UniverPresetDocsThreadCommentZhCN from "@univerjs/preset-docs-thread-comment/locales/zh-CN";
import ChartUIEnUS from "@univerjs-pro/chart-ui/locale/en-US";
import ChartUIZhCN from "@univerjs-pro/chart-ui/locale/zh-CN";
import UniverDocsCalloutUIEnUS from "@univerjs-pro/docs-callout-ui/locale/en-US";
import UniverDocsCalloutUIZhCN from "@univerjs-pro/docs-callout-ui/locale/zh-CN";
import UniverDocsChartUIEnUS from "@univerjs-pro/docs-chart-ui/locale/en-US";
import UniverDocsChartUIZhCN from "@univerjs-pro/docs-chart-ui/locale/zh-CN";
import UniverDocsCodeUIEnUS from "@univerjs-pro/docs-code-ui/locale/en-US";
import UniverDocsCodeUIZhCN from "@univerjs-pro/docs-code-ui/locale/zh-CN";
import UniverDocsLatexUIEnUS from "@univerjs-pro/docs-latex-ui/locale/en-US";
import UniverDocsLatexUIZhCN from "@univerjs-pro/docs-latex-ui/locale/zh-CN";
import UniverDocsShapeUIEnUS from "@univerjs-pro/docs-shape-ui/locale/en-US";
import UniverDocsShapeUIZhCN from "@univerjs-pro/docs-shape-ui/locale/zh-CN";
import UniverDocsTableUIEnUS from "@univerjs-pro/docs-table-ui/locale/en-US";
import UniverDocsTableUIZhCN from "@univerjs-pro/docs-table-ui/locale/zh-CN";
import EngineChartEnUS from "@univerjs-pro/engine-chart/locale/en-US";
import EngineChartZhCN from "@univerjs-pro/engine-chart/locale/zh-CN";
import UniverShapeEditorUIEnUS from "@univerjs-pro/shape-editor-ui/locale/en-US";
import UniverShapeEditorUIZhCN from "@univerjs-pro/shape-editor-ui/locale/zh-CN";
import { mergeLocales } from "@univerjs/presets";
import { defaultTheme } from "@univerjs/themes";

import "@univerjs-pro/docs-callout-ui/lib/index.css";
import "@univerjs-pro/docs-chart-ui/lib/index.css";
import "@univerjs-pro/docs-code-ui/lib/index.css";
import "@univerjs-pro/docs-latex-ui/lib/index.css";
import "@univerjs-pro/docs-shape-ui/lib/index.css";
import "@univerjs-pro/docs-table-ui/lib/index.css";
import "@univerjs/preset-docs-core/lib/index.css";
import "@univerjs/preset-docs-drawing/lib/index.css";
import "@univerjs/preset-docs-hyper-link/lib/index.css";
import "@univerjs/preset-docs-thread-comment/lib/index.css";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "./collaboration-editor";
import {
  getDocAuthoringUIPlugins,
  getDocReplayCompatibilityPlugins,
} from "./doc-features";
import { getThreadCommentCollaborationPlugins } from "./thread-comment-features";

export type DocEditorProps = CollaborationEditorProps;

export default createCollaborationEditor({
  label: "document",
  theme: defaultTheme,
  locales: {
    "zh-CN": mergeLocales(
      ChartUIZhCN,
      EngineChartZhCN,
      UniverPresetDocsCoreZhCN,
      UniverPresetDocsDrawingZhCN,
      UniverPresetDocsHyperLinkZhCN,
      UniverPresetDocsThreadCommentZhCN,
      UniverDocsCalloutUIZhCN,
      UniverDocsChartUIZhCN,
      UniverDocsCodeUIZhCN,
      UniverDocsLatexUIZhCN,
      UniverDocsShapeUIZhCN,
      UniverDocsTableUIZhCN,
      UniverShapeEditorUIZhCN
    ),
    "en-US": mergeLocales(
      ChartUIEnUS,
      EngineChartEnUS,
      UniverPresetDocsCoreEnUS,
      UniverPresetDocsDrawingEnUS,
      UniverPresetDocsHyperLinkEnUS,
      UniverPresetDocsThreadCommentEnUS,
      UniverDocsCalloutUIEnUS,
      UniverDocsChartUIEnUS,
      UniverDocsCodeUIEnUS,
      UniverDocsLatexUIEnUS,
      UniverDocsShapeUIEnUS,
      UniverDocsTableUIEnUS,
      UniverShapeEditorUIEnUS
    ),
  },
  collaborationFeaturePlugins: getThreadCommentCollaborationPlugins,
  createPresets: (container) => [
    UniverDocsCorePreset({
      container,
    }),
    UniverDocsDrawingPreset({
      collaboration: true,
    }),
    UniverDocsHyperLinkPreset(),
    UniverDocsThreadCommentPreset(),
    {
      plugins: [
        ...getDocReplayCompatibilityPlugins(),
        ...getDocAuthoringUIPlugins(),
      ],
    },
  ],
  load: (univerAPI, unitId) =>
    univerAPI.getCollaboration().loadDocAsync(unitId),
});
