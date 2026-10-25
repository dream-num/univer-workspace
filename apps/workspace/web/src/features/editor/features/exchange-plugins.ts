import type { IPreset, IPresetPlugin } from "@univerjs/presets";
import { UniverExchangeClientPlugin } from "@univerjs-pro/exchange-client";

export function createWorkspaceExchangeClientConfig(origin: string) {
  const endpoint = origin.replace(/\/+$/u, "");
  return {
    uploadFileServerUrl: `${endpoint}/universer-api/stream/file/upload`,
    getTaskServerUrl: `${endpoint}/universer-api/exchange/task/{taskID}`,
    signUrlServerUrl: `${endpoint}/universer-api/file/{fileID}/sign-url`,
    importServerUrl: `${endpoint}/universer-api/exchange/{type}/import`,
    exportServerUrl: `${endpoint}/universer-api/exchange/{type}/export`,
    downloadEndpointUrl: `${endpoint}/`,
  } as const;
}

/**
 * Mobile editors register the shared exchange client through their feature
 * list. SDK 1.2 provides one exchange client for both layouts, so these
 * editors set exchangeProvidedByPreset to avoid duplicate registration and
 * keep the factory's trunk/sign-in gating through exchangeFeaturePlugins.
 */
export function createMobileExchangeFeaturePlugins(
  unitPlugins: readonly IPresetPlugin[]
): IPresetPlugin[] {
  return [
    [
      UniverExchangeClientPlugin,
      createWorkspaceExchangeClientConfig(window.location.origin),
    ],
    ...unitPlugins,
  ];
}

interface IWorkspaceOutputPluginOptions {
  readonly origin: string;
  readonly exchangeEnabled: boolean;
  readonly exchangeProvidedByPreset: boolean;
  readonly exchangeFeaturePlugins: readonly IPresetPlugin[];
  readonly printFeaturePlugins: readonly IPresetPlugin[];
}

export function createWorkspaceOutputPlugins({
  origin,
  exchangeEnabled,
  exchangeProvidedByPreset,
  exchangeFeaturePlugins,
  printFeaturePlugins,
}: IWorkspaceOutputPluginOptions): IPresetPlugin[] {
  const sharedExchangePlugins: IPresetPlugin[] =
    exchangeEnabled && !exchangeProvidedByPreset
      ? [
          [
            UniverExchangeClientPlugin,
            createWorkspaceExchangeClientConfig(origin),
          ],
        ]
      : [];

  return [
    ...sharedExchangePlugins,
    ...(exchangeEnabled ? exchangeFeaturePlugins : []),
    ...printFeaturePlugins,
  ];
}

export function configureExchangePresetPlugins(
  presets: IPreset[],
  enabled: boolean
): IPreset[] {
  if (enabled) return presets;
  return presets.map((preset) => ({
    ...preset,
    plugins: preset.plugins.filter((plugin) => !isExchangePlugin(plugin)),
  }));
}

function isExchangePlugin(plugin: IPresetPlugin): boolean {
  const PluginConstructor = Array.isArray(plugin) ? plugin[0] : plugin;
  return (
    PluginConstructor.pluginName === "UNIVER_EXCHANGE_CLIENT_PLUGIN" ||
    PluginConstructor.pluginName === "SHEET_EXCHANGE_CLIENT_PLUGIN"
  );
}
