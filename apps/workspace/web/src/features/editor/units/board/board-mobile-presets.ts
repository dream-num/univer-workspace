import { UniverBoardsPlugin } from "@univerjs-pro/boards";
import { UniverBoardsChartPlugin } from "@univerjs-pro/boards-chart";
import { UniverBoardsChartMobileUIPlugin } from "@univerjs-pro/boards-chart-ui";
import { UniverBoardsMindPlugin } from "@univerjs-pro/boards-mind";
import { UniverBoardsMindMobileUIPlugin } from "@univerjs-pro/boards-mind-ui";
import { UniverBoardsTablePlugin } from "@univerjs-pro/boards-table";
import { UniverBoardsTableMobileUIPlugin } from "@univerjs-pro/boards-table-ui";
import { UniverBoardsMobileUIPlugin } from "@univerjs-pro/boards-ui";
import { UniverDocsLatexPlugin } from "@univerjs-pro/docs-latex";
import { UniverDocsLatexUIPlugin } from "@univerjs-pro/docs-latex-ui";
import { UniverInkPlugin } from "@univerjs-pro/ink";
import { UniverInkUIPlugin } from "@univerjs-pro/ink-ui";
import { IImageIoService } from "@univerjs/core";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsMobileUIPlugin } from "@univerjs/docs-ui";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import type { IPreset } from "@univerjs/presets";
import { UniverMobileUIPlugin } from "@univerjs/ui";

import { MAX_UNIVER_IMAGE_BYTES } from "../../features/univer-assets";

/**
 * Mobile counterpart of the Board editor presets, modeled on univer-pro dev
 * examples/src/boards/mobile-collaboration. Latex and Ink keep their desktop
 * UI plugins there as well; Ink has no Mobile variant.
 */
export function createBoardMobilePresets(container: HTMLElement): IPreset[] {
  return [
    {
      plugins: [
        UniverRenderEnginePlugin,
        [
          UniverMobileUIPlugin,
          {
            container,
            header: false,
            toolbar: false,
            footer: false,
          },
        ],
        UniverDocsPlugin,
        UniverDocsMobileUIPlugin,
        [
          UniverDrawingPlugin,
          {
            allowImageSize: MAX_UNIVER_IMAGE_BYTES,
            // The collaboration plugin owns the remote image service.
            override: [[IImageIoService, null]],
          },
        ],
        UniverDocsLatexPlugin,
        UniverDocsLatexUIPlugin,
        UniverBoardsPlugin,
        UniverInkPlugin,
        UniverInkUIPlugin,
        UniverBoardsMobileUIPlugin,
        UniverBoardsChartPlugin,
        UniverBoardsChartMobileUIPlugin,
        UniverBoardsMindPlugin,
        UniverBoardsMindMobileUIPlugin,
        UniverBoardsTablePlugin,
        UniverBoardsTableMobileUIPlugin,
      ],
    },
  ];
}
