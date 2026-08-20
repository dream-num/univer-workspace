import type { IPreset, IPresetPlugin } from "@univerjs/presets";

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
