import { UniverBasesPlugin } from "@univerjs-pro/bases";
import UniverBasesEnUS from "@univerjs-pro/bases/locale/en-US";
import UniverBasesZhCN from "@univerjs-pro/bases/locale/zh-CN";
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
import { yellowTheme } from "@univerjs/themes";

import "@univerjs-pro/bases/facade";
import "@univerjs-pro/bases-ui/lib/index.css";
import "@univerjs/ui/lib/index.css";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "./collaboration-editor";
import { MAX_UNIVER_IMAGE_BYTES } from "./univer-assets";

export type BaseEditorProps = CollaborationEditorProps;

export default createCollaborationEditor({
  label: "base",
  theme: yellowTheme,
  enableDocumentCollaborationUI: false,
  useCustomCollaborationStatus: true,
  locales: {
    "zh-CN": mergeLocales(
      UniverDesignZhCN,
      UniverUIZhCN,
      UniverEngineFormulaZhCN,
      UniverBasesZhCN,
      UniverBasesUIZhCN
    ),
    "en-US": mergeLocales(
      UniverDesignEnUS,
      UniverUIEnUS,
      UniverEngineFormulaEnUS,
      UniverBasesEnUS,
      UniverBasesUIEnUS
    ),
  },
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
          },
        ],
      ],
    },
  ],
  load: (univerAPI, unitId) =>
    univerAPI.getCollaboration().loadBaseAsync(unitId),
});
