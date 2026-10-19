import { UniverBasesPlugin } from "@univerjs-pro/bases";
import { UniverBasesMobileUIPlugin } from "@univerjs-pro/bases-ui";
import { IAttachmentIoService } from "@univerjs-pro/collaboration-client";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { IImageIoService } from "@univerjs/core";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsMobileUIPlugin } from "@univerjs/docs-ui";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import type { IPreset } from "@univerjs/presets";
import { UniverRPCMainThreadPlugin } from "@univerjs/rpc";
import { UniverMobileUIPlugin } from "@univerjs/ui";

import { MAX_UNIVER_IMAGE_BYTES } from "../../features/univer-assets";

/**
 * Mobile counterpart of the Base editor presets. The SDK has no official
 * mobile Base composition, so this mirrors the desktop stack with
 * UniverBasesMobileUIPlugin. Thread Comments are composed separately in
 * features/thread-comments.ts.
 */
export function createBaseMobilePresets(container: HTMLElement): IPreset[] {
  return [
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
          UniverMobileUIPlugin,
          {
            container,
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
            // The collaboration plugin owns the remote image service.
            override: [[IImageIoService, null]],
          },
        ],
        UniverDocsPlugin,
        UniverDocsMobileUIPlugin,
        UniverBasesPlugin,
        [
          UniverBasesMobileUIPlugin,
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
  ];
}
