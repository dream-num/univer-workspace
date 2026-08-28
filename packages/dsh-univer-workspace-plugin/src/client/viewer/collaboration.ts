/** Collaboration preset wiring for an embedded Viewer scope. */

import { UniverCollaborationClientPlugin } from "@univerjs-pro/collaboration-client";
import { UniverCollaborationClientUIPlugin } from "@univerjs-pro/collaboration-client-ui";
import { UniverEditHistoryLoaderPlugin } from "@univerjs-pro/edit-history-loader";
import { UniverSheetsCollaborationPreset } from "@univerjs/preset-sheets-collaboration";
import { type IPreset, type IPresetPlugin } from "@univerjs/presets";
import { PROXY_PREFIX, type ViewerMergePreviewConfig, type ViewerUrls } from "./proxy.ts";
import type { ViewerUnitType } from "../viewer-types.ts";

/**
 * Keep the official collaboration preset as the composition boundary. Only
 * transport endpoints are rewritten to the harness same-origin proxy.
 */
export function configuredCollaborationPreset(
  container: string,
  urls: ViewerUrls,
  unitType: ViewerUnitType = "sheet",
  mergePreviewConfig?: ViewerMergePreviewConfig,
): IPreset {
  const preset = UniverSheetsCollaborationPreset({
    // Defaults are replaced below. This endpoint still keeps any optional
    // preset URLs same-origin if a future SDK adds one.
    universerEndpoint: `${window.location.origin}${PROXY_PREFIX}`,
    univerContainerId: container,
    enableOfflineEditing: false,
    enableSingleActiveInstanceLock: false,
  });
  return {
    ...preset,
    // Edit history is currently a Sheet-only browser surface in beta.2.  The
    // collaboration client itself supports all five Unit loaders; retaining
    // the history plugin for Docs/Slides/Base/Board makes bootstrap fail before
    // the Unit can render, so omit it for those types.
    plugins: preset.plugins.flatMap((plugin): IPresetPlugin[] => {
      if (!Array.isArray(plugin)) return [plugin];
      const [PluginConstructor, pluginConfig] = plugin;
      if (PluginConstructor === UniverCollaborationClientPlugin) {
        const existingConfig = (pluginConfig ?? {}) as { readonly override?: readonly unknown[] };
        const previewConfig = mergePreviewConfig === undefined
          ? {}
          : {
              ...mergePreviewConfig,
              // Keep the endpoint on the DSH origin even though the preview's
              // in-memory snapshot override handles the initial read.
              snapshotServerUrl: urls.snapshotServerUrl,
              override: [
                ...(existingConfig.override ?? []),
                ...(mergePreviewConfig.override ?? []),
              ],
            };
        return [[
          PluginConstructor,
          {
            ...(pluginConfig as object),
            ...urls,
            ...previewConfig,
            enableOfflineEditing: false,
            enableSingleActiveInstanceLock: false,
            enableAuthServer: true,
            loginUrlKey: "/login",
            sendChangesetTimeout: 200,
          },
        ] as IPresetPlugin];
      }
      if (PluginConstructor === UniverCollaborationClientUIPlugin) {
        return [[
          PluginConstructor,
          {
            ...(pluginConfig as object),
            enableDocumentCollaborationUI: false,
          },
        ] as IPresetPlugin];
      }
      if (PluginConstructor === UniverEditHistoryLoaderPlugin) {
        if (unitType !== "sheet") return [];
        return [[
          PluginConstructor,
          {
            ...(pluginConfig as object),
            univerContainerId: container,
            historyListServerUrl: urls.snapshotServerUrl.replace(/\/snapshot$/u, "/history"),
          },
        ] as IPresetPlugin];
      }
      return [plugin];
    }),
  };
}
