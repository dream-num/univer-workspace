import { IImageIoService } from "@univerjs/core";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsDrawingPlugin } from "@univerjs/docs-drawing";
import { UniverDocsDrawingMobileUIPlugin } from "@univerjs/docs-drawing-ui";
import { UniverDocsHyperLinkPlugin } from "@univerjs/docs-hyper-link";
import { UniverDocsHyperLinkMobileUIPlugin } from "@univerjs/docs-hyper-link-ui";
import { UniverDocsMobileUIPlugin } from "@univerjs/docs-ui";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverDrawingMobileUIPlugin } from "@univerjs/drawing-ui";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverNetworkPlugin } from "@univerjs/network";
import type { IPreset } from "@univerjs/presets";
import { UniverMobileUIPlugin } from "@univerjs/ui";

import { getReferencedSheetPlugins } from "../../features/referenced-sheet-plugins";
import {
  getDocMobileAuthoringUIPlugins,
  getDocReplayCompatibilityPlugins,
} from "./doc-features";

interface CreateDocMobilePresetsOptions {
  readonly container: HTMLElement;
  readonly compact: boolean;
}

/**
 * Plugin-mode mobile counterpart of the Doc editor presets. The Docs presets
 * have no platform switch, so this expands UniverDocsCorePreset, Drawing,
 * and HyperLink into their plugins with Mobile UI variants, modeled on
 * univer-pro dev examples/src/docs/mobile-collaboration. Thread Comments are
 * composed separately in features/thread-comments.ts.
 */
export function createDocMobilePresets({
  container,
  compact,
}: CreateDocMobilePresetsOptions): IPreset[] {
  return [
    { plugins: getReferencedSheetPlugins() },
    {
      plugins: [
        UniverNetworkPlugin,
        UniverDocsPlugin,
        UniverRenderEnginePlugin,
        [
          UniverMobileUIPlugin,
          {
            container,
            ...(compact ? { header: false, toolbar: false } : {}),
          },
        ],
        UniverDocsMobileUIPlugin,
        UniverFormulaEnginePlugin,
      ],
    },
    {
      plugins: [
        // The collaboration plugin owns the remote image service.
        [UniverDrawingPlugin, { override: [[IImageIoService, null]] }],
        UniverDrawingMobileUIPlugin,
        UniverDocsDrawingPlugin,
        UniverDocsDrawingMobileUIPlugin,
        UniverDocsHyperLinkPlugin,
        UniverDocsHyperLinkMobileUIPlugin,
      ],
    },
    {
      plugins: [
        ...getDocReplayCompatibilityPlugins(),
        ...getDocMobileAuthoringUIPlugins(),
      ],
    },
  ];
}
