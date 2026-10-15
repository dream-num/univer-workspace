import { UniverSlidesPlugin } from "@univerjs-pro/slides";
import { UniverSlidesChartPlugin } from "@univerjs-pro/slides-chart";
import { UniverSlidesChartMobileUIPlugin } from "@univerjs-pro/slides-chart-ui";
import { UniverSlidesTablePlugin } from "@univerjs-pro/slides-table";
import { UniverSlidesTableMobileUIPlugin } from "@univerjs-pro/slides-table-ui";
import { UniverSlidesMobileUIPlugin } from "@univerjs-pro/slides-ui";
import { IImageIoService } from "@univerjs/core";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsMobileUIPlugin } from "@univerjs/docs-ui";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import type { IPreset } from "@univerjs/presets";
import { UniverMobileUIPlugin } from "@univerjs/ui";

import { getReferencedSheetPlugins } from "../../features/referenced-sheet-plugins";
import { MAX_UNIVER_IMAGE_BYTES } from "../../features/univer-assets";

interface CreateSlideMobilePresetsOptions {
  readonly container: HTMLElement;
  readonly compact: boolean;
}

/**
 * Mobile counterpart of the Slide editor presets, modeled on univer-pro dev
 * examples/src/slides/mobile-collaboration.
 */
export function createSlideMobilePresets({
  container,
  compact,
}: CreateSlideMobilePresetsOptions): IPreset[] {
  return [
    { plugins: getReferencedSheetPlugins() },
    {
      plugins: [
        UniverRenderEnginePlugin,
        [
          UniverMobileUIPlugin,
          {
            container,
            ...(compact ? { header: false, toolbar: false } : {}),
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
        UniverSlidesPlugin,
        UniverSlidesMobileUIPlugin,
        UniverSlidesChartPlugin,
        UniverSlidesChartMobileUIPlugin,
        UniverSlidesTablePlugin,
        UniverSlidesTableMobileUIPlugin,
      ],
    },
  ];
}
