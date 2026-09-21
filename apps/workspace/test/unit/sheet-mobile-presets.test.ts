import type { IPreset, IPresetPlugin } from "@univerjs/presets";
import { describe, expect, it } from "vitest";

const container = { id: "test-editor" } as HTMLElement;

describe("Workspace Sheet mobile presets", () => {
  it("uses Mobile UI variants and no desktop UI plugins", async () => {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      value: class Path2D {},
    });
    const [
      { UniverMobileUIPlugin, UniverUIPlugin },
      { UniverSheetsMobileUIPlugin, UniverSheetsUIPlugin },
      { UniverSheetsNumfmtMobileUIPlugin },
      { UniverSheetsFormulaMobileUIPlugin },
      { UniverSheetsConditionalFormattingMobileUIPlugin },
      { UniverSheetsDataValidationMobileUIPlugin },
      { UniverSheetsFilterMobileUIPlugin },
      { UniverFindReplaceMobileUIPlugin },
      { UniverSheetsFindReplaceMobileUIPlugin },
      { UniverSheetsHyperLinkMobileUIPlugin },
      { UniverSheetsSortMobileUIPlugin },
      { UniverSheetsTableMobileUIPlugin },
      { UniverSheetsNoteUIPlugin },
      { UniverDrawingMobileUIPlugin },
      { UniverSheetsDrawingMobileUIPlugin },
      { UniverRPCMainThreadPlugin },
      { UniverChartMobileUIPlugin },
      { UniverProFormulaEnginePlugin },
      { UniverSheetsChartMobileUIPlugin },
      { UniverSheetsOutlineMobileUIPlugin },
      { UniverSheetsPivotTableMobileUIPlugin },
      { UniverSheetsPrintMobileUIPlugin },
      { UniverSheetsShapeMobileUIPlugin },
      { UniverSheetSparklineMobileUIPlugin },
      { UniverFormulaEnginePlugin },
      { createSheetMobilePresets },
    ] = await Promise.all([
      import("@univerjs/ui"),
      import("@univerjs/sheets-ui"),
      import("@univerjs/sheets-numfmt-ui"),
      import("@univerjs/sheets-formula-ui"),
      import("@univerjs/sheets-conditional-formatting-ui"),
      import("@univerjs/sheets-data-validation-ui"),
      import("@univerjs/sheets-filter-ui"),
      import("@univerjs/find-replace"),
      import("@univerjs/sheets-find-replace"),
      import("@univerjs/sheets-hyper-link-ui"),
      import("@univerjs/sheets-sort-ui"),
      import("@univerjs/sheets-table-ui"),
      import("@univerjs/sheets-note-ui"),
      import("@univerjs/drawing-ui"),
      import("@univerjs/sheets-drawing-ui"),
      import("@univerjs/rpc"),
      import("@univerjs-pro/chart-ui"),
      import("@univerjs-pro/engine-formula"),
      import("@univerjs-pro/sheets-chart-ui"),
      import("@univerjs-pro/sheets-outline-ui"),
      import("@univerjs-pro/sheets-pivot-ui"),
      import("@univerjs-pro/sheets-print"),
      import("@univerjs-pro/sheets-shape-ui"),
      import("@univerjs-pro/sheets-sparkline-ui"),
      import("@univerjs/engine-formula"),
      import("../../web/src/features/editor/units/sheet/sheet-mobile-presets.js"),
    ]);

    const presets = createSheetMobilePresets({ container });
    const constructors = presetPluginConstructors(presets);

    expect(constructors).toEqual(
      expect.arrayContaining([
        UniverMobileUIPlugin,
        UniverSheetsMobileUIPlugin,
        UniverSheetsNumfmtMobileUIPlugin,
        UniverSheetsFormulaMobileUIPlugin,
        UniverSheetsConditionalFormattingMobileUIPlugin,
        UniverSheetsDataValidationMobileUIPlugin,
        UniverSheetsFilterMobileUIPlugin,
        UniverFindReplaceMobileUIPlugin,
        UniverSheetsFindReplaceMobileUIPlugin,
        UniverSheetsHyperLinkMobileUIPlugin,
        UniverSheetsSortMobileUIPlugin,
        UniverSheetsTableMobileUIPlugin,
        UniverDrawingMobileUIPlugin,
        UniverSheetsDrawingMobileUIPlugin,
        UniverChartMobileUIPlugin,
        UniverSheetsChartMobileUIPlugin,
        UniverSheetsOutlineMobileUIPlugin,
        UniverSheetsPivotTableMobileUIPlugin,
        UniverSheetsPrintMobileUIPlugin,
        UniverSheetsShapeMobileUIPlugin,
        UniverSheetSparklineMobileUIPlugin,
      ])
    );
    expect(constructors).not.toEqual(
      expect.arrayContaining([
        UniverUIPlugin,
        UniverSheetsUIPlugin,
        UniverRPCMainThreadPlugin,
      ])
    );
    // sheets-note-ui has no Mobile variant on this SDK release.
    expect(constructors).toContain(UniverSheetsNoteUIPlugin);
    // Main-thread formulas: the Pro engine supersedes the OSS one through
    // createUniver's preset replacement, so both constructors are present.
    expect(constructors).toEqual(
      expect.arrayContaining([
        UniverFormulaEnginePlugin,
        UniverProFormulaEnginePlugin,
      ])
    );
    expect(pluginOptions(presets, "SHEET_FILTER_PLUGIN")).toMatchObject({
      enableSyncSwitch: true,
    });
    expect(pluginOptions(presets, "SHEET_PRINT_PLUGIN")).toMatchObject({
      enforceWatermark: true,
    });
    expect(pluginOptions(presets, "UNIVER_DRAWING_PLUGIN")).toMatchObject({
      allowImageSize: 20 * 1024 * 1024,
    });
    // Exchange plugins are registered through exchangeFeaturePlugins so the
    // factory can gate them; a preset copy would collide with the desktop
    // plugin the factory registers on the same pluginName.
    expect(presetPluginKeys(presets)).not.toEqual(
      expect.arrayContaining([
        "UNIVER_EXCHANGE_CLIENT_PLUGIN",
        "SHEET_EXCHANGE_CLIENT_PLUGIN",
      ])
    );
  }, 20_000);

  it("omits Thread Comment from non-trunk preset stacks", async () => {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      value: class Path2D {},
    });
    const [{ createSheetMobilePresets }] = await Promise.all([
      import("../../web/src/features/editor/units/sheet/sheet-mobile-presets.js"),
    ]);
    const presets = createSheetMobilePresets({
      container,
      threadCommentsEnabled: false,
    });

    expect(presetPluginKeys(presets)).not.toContain(
      "UNIVER_SHEETS_THREAD_COMMENT_PLUGIN"
    );
  }, 20_000);

  it("localizes Drawing when collaboration is disabled", async () => {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      value: class Path2D {},
    });
    const [{ createSheetMobilePresets }] = await Promise.all([
      import("../../web/src/features/editor/units/sheet/sheet-mobile-presets.js"),
    ]);
    const presets = createSheetMobilePresets({
      container,
      collaborationEnabled: false,
    });

    expect(pluginOptions(presets, "UNIVER_DRAWING_PLUGIN")).toMatchObject({
      override: [],
    });
    expect(presetPluginKeys(presets)).not.toContain(
      "UNIVER_SHEETS_THREAD_COMMENT_PLUGIN"
    );
  }, 20_000);
});

function presetPluginConstructors(presets: IPreset[]): unknown[] {
  return presets.flatMap((preset) =>
    (preset.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin
    )
  );
}

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
