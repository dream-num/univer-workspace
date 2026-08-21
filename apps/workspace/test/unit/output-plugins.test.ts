import type { IPresetPlugin } from "@univerjs/presets";
import { describe, expect, it } from "vitest";

describe("Workspace output plugins", () => {
  it("registers shared exchange before the host plugin and keeps print available", async () => {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      value: class Path2D {},
    });
    const [
      { UniverDocsExchangeClientPlugin },
      { UniverDocsPrintPlugin },
      { UniverExchangeClientPlugin },
      { createWorkspaceOutputPlugins },
    ] = await Promise.all([
      import("@univerjs-pro/docs-exchange-client"),
      import("@univerjs-pro/docs-print"),
      import("@univerjs-pro/exchange-client"),
      import("../../web/src/features/editor/exchange-plugins.js"),
    ]);

    const enabled = createWorkspaceOutputPlugins({
      origin: "https://workspace.example",
      exchangeEnabled: true,
      exchangeProvidedByPreset: false,
      exchangeFeaturePlugins: [UniverDocsExchangeClientPlugin],
      printFeaturePlugins: [UniverDocsPrintPlugin],
    });
    expect(enabled.map(pluginConstructor)).toEqual([
      UniverExchangeClientPlugin,
      UniverDocsExchangeClientPlugin,
      UniverDocsPrintPlugin,
    ]);
    expect(Array.isArray(enabled[0]) ? enabled[0][1] : undefined).toMatchObject(
      {
        exportServerUrl:
          "https://workspace.example/universer-api/exchange/{type}/export",
      }
    );

    const disabled = createWorkspaceOutputPlugins({
      origin: "https://workspace.example",
      exchangeEnabled: false,
      exchangeProvidedByPreset: false,
      exchangeFeaturePlugins: [UniverDocsExchangeClientPlugin],
      printFeaturePlugins: [UniverDocsPrintPlugin],
    });
    expect(disabled.map(pluginConstructor)).toEqual([
      UniverDocsPrintPlugin,
    ]);

    const presetExchange = createWorkspaceOutputPlugins({
      origin: "https://workspace.example",
      exchangeEnabled: true,
      exchangeProvidedByPreset: true,
      exchangeFeaturePlugins: [],
      printFeaturePlugins: [UniverDocsPrintPlugin],
    });
    expect(presetExchange.map(pluginConstructor)).toEqual([
      UniverDocsPrintPlugin,
    ]);
  }, 15_000);
});

function pluginConstructor(plugin: IPresetPlugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}
