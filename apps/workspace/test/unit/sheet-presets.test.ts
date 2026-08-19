import type { IPreset, IPresetPlugin } from "@univerjs/presets";
import { describe, expect, it } from "vitest";

const endpoint = "https://workspace.example";
const container = { id: "test-editor" } as HTMLElement;
const license = "workspace-license";

describe("Workspace Sheet presets", () => {
  it("matches the complete univer-pro preset-sheets-collaboration example", async () => {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      value: class Path2D {},
    });
    const [
      { UniverSheetsAdvancedPreset },
      { UniverSheetsConditionalFormattingPreset },
      { UniverSheetsCollaborationPreset },
      { UniverSheetsCorePreset },
      { UniverSheetsDataValidationPreset },
      { UniverSheetsDrawingPreset },
      { UniverSheetsFilterPreset },
      { UniverSheetsFindReplacePreset },
      { UniverSheetsHyperLinkPreset },
      { UniverSheetsNotePreset },
      { UniverSheetsSortPreset },
      { UniverSheetsTablePreset },
      { UniverSheetsThreadCommentPreset },
      { createSheetEditorPresets },
      {
        configureExchangePresetPlugins,
        createWorkspaceExchangeClientConfig,
      },
    ] = await Promise.all([
      import("@univerjs/preset-sheets-advanced"),
      import("@univerjs/preset-sheets-conditional-formatting"),
      import("@univerjs/preset-sheets-collaboration"),
      import("@univerjs/preset-sheets-core"),
      import("@univerjs/preset-sheets-data-validation"),
      import("@univerjs/preset-sheets-drawing"),
      import("@univerjs/preset-sheets-filter"),
      import("@univerjs/preset-sheets-find-replace"),
      import("@univerjs/preset-sheets-hyper-link"),
      import("@univerjs/preset-sheets-note"),
      import("@univerjs/preset-sheets-sort"),
      import("@univerjs/preset-sheets-table"),
      import("@univerjs/preset-sheets-thread-comment"),
      import("../../web/src/features/editor/sheet-presets.js"),
      import("../../web/src/features/editor/exchange-plugins.js"),
    ]);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          host: "workspace.example",
          origin: endpoint,
          protocol: "https:",
        },
      },
    });
    const expected = [
      UniverSheetsCorePreset({
        container,
        ribbonType: "grid",
      }),
      UniverSheetsDrawingPreset({
        collaboration: true,
      }),
      UniverSheetsConditionalFormattingPreset(),
      UniverSheetsFilterPreset({
        enableSyncSwitch: true,
      }),
      UniverSheetsHyperLinkPreset(),
      UniverSheetsDataValidationPreset(),
      UniverSheetsFindReplacePreset(),
      UniverSheetsNotePreset(),
      UniverSheetsSortPreset(),
      UniverSheetsTablePreset(),
      UniverSheetsThreadCommentPreset(),
      UniverSheetsAdvancedPreset({
        license,
        universerEndpoint: endpoint,
        print: {
          enforceWatermark: true,
        },
      }),
      UniverSheetsCollaborationPreset({
        univerContainerId: container.id,
        universerEndpoint: endpoint,
      }),
    ];

    const actual = createSheetEditorPresets({
      container,
      license,
      universerEndpoint: endpoint,
    });

    expect(presetPluginKeys(actual)).toEqual(presetPluginKeys(expected));
    expect(presetPluginKeys(actual)).toContain(
      "SHEET_CONDITIONAL_FORMATTING_PLUGIN"
    );
    expect(presetPluginKeys(actual)).toEqual(
      expect.arrayContaining([
        "UNIVER_EXCHANGE_CLIENT_PLUGIN",
        "SHEET_EXCHANGE_CLIENT_PLUGIN",
      ])
    );
    expect(
      presetPluginKeys(configureExchangePresetPlugins(actual, false))
    ).not.toEqual(
      expect.arrayContaining([
        "UNIVER_EXCHANGE_CLIENT_PLUGIN",
        "SHEET_EXCHANGE_CLIENT_PLUGIN",
      ])
    );
    expect(createWorkspaceExchangeClientConfig(`${endpoint}/`)).toEqual({
      uploadFileServerUrl: `${endpoint}/universer-api/stream/file/upload`,
      getTaskServerUrl: `${endpoint}/universer-api/exchange/task/{taskID}`,
      signUrlServerUrl: `${endpoint}/universer-api/file/{fileID}/sign-url`,
      importServerUrl: `${endpoint}/universer-api/exchange/{type}/import`,
      exportServerUrl: `${endpoint}/universer-api/exchange/{type}/export`,
      downloadEndpointUrl: `${endpoint}/`,
    });
    expect(pluginOptions(actual, "UNIVER_LICENSE_PLUGIN")).toMatchObject({
      license,
    });
  }, 20_000);
});

function presetPluginKeys(presets: IPreset[]): string[] {
  return presets.flatMap((preset) =>
    (preset.plugins ?? []).map(pluginKey)
  );
}

function pluginOptions(
  presets: IPreset[],
  expectedPluginKey: string
): unknown {
  for (const preset of presets) {
    for (const plugin of preset.plugins ?? []) {
      if (Array.isArray(plugin) && pluginKey(plugin) === expectedPluginKey) {
        return plugin[1];
      }
    }
  }
  return undefined;
}

function pluginKey(plugin: IPresetPlugin): string {
  const constructor = Array.isArray(plugin) ? plugin[0] : plugin;
  return constructor.pluginName ?? constructor.name;
}
