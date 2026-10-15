import type { IPreset, IPresetPlugin } from "@univerjs/presets";
import { beforeAll, describe, expect, it } from "vitest";

const container = { id: "test-editor" } as HTMLElement;

beforeAll(() => {
  Object.defineProperty(globalThis, "Path2D", {
    configurable: true,
    value: class Path2D {},
  });
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: class Worker {},
  });
});

describe("Workspace mobile unit presets", () => {
  it("builds the Doc editor from Mobile UI variants", async () => {
    const [
      ui,
      docsUI,
      drawingUI,
      docsDrawingUI,
      docsHyperLinkUI,
      threadCommentUI,
      docsThreadCommentUI,
      calloutUI,
      chartUI,
      codeUI,
      latexUI,
      shapeUI,
      tableUI,
      { getDocReplayCompatibilityPlugins },
      { createDocMobilePresets },
    ] = await Promise.all([
      import("@univerjs/ui"),
      import("@univerjs/docs-ui"),
      import("@univerjs/drawing-ui"),
      import("@univerjs/docs-drawing-ui"),
      import("@univerjs/docs-hyper-link-ui"),
      import("@univerjs/thread-comment-ui"),
      import("@univerjs/docs-thread-comment-ui"),
      import("@univerjs-pro/docs-callout-ui"),
      import("@univerjs-pro/docs-chart-ui"),
      import("@univerjs-pro/docs-code-ui"),
      import("@univerjs-pro/docs-latex-ui"),
      import("@univerjs-pro/docs-shape-ui"),
      import("@univerjs-pro/docs-table-ui"),
      import("../../web/src/features/editor/units/doc/doc-features.js"),
      import("../../web/src/features/editor/units/doc/doc-mobile-presets.js"),
    ]);

    const presets = createDocMobilePresets({ container, compact: false });
    const constructors = presetPluginConstructors(presets);

    expect(constructors).toEqual(
      expect.arrayContaining([
        ui.UniverMobileUIPlugin,
        docsUI.UniverDocsMobileUIPlugin,
        drawingUI.UniverDrawingMobileUIPlugin,
        docsDrawingUI.UniverDocsDrawingMobileUIPlugin,
        docsHyperLinkUI.UniverDocsHyperLinkMobileUIPlugin,
        threadCommentUI.UniverThreadCommentMobileUIPlugin,
        docsThreadCommentUI.UniverDocsThreadCommentMobileUIPlugin,
        calloutUI.UniverDocsCalloutMobileUIPlugin,
        chartUI.UniverDocsChartMobileUIPlugin,
        codeUI.UniverDocsCodeMobileUIPlugin,
        latexUI.UniverDocsLatexMobileUIPlugin,
        shapeUI.UniverDocsShapeMobileUIPlugin,
        tableUI.UniverDocsTableMobileUIPlugin,
        ...getDocReplayCompatibilityPlugins(),
      ])
    );
    expectNone(constructors, [
      ui.UniverUIPlugin,
      docsUI.UniverDocsUIPlugin,
      drawingUI.UniverDrawingUIPlugin,
      docsDrawingUI.UniverDocsDrawingUIPlugin,
      docsHyperLinkUI.UniverDocsHyperLinkUIPlugin,
      threadCommentUI.UniverThreadCommentUIPlugin,
      docsThreadCommentUI.UniverDocsThreadCommentUIPlugin,
      calloutUI.UniverDocsCalloutUIPlugin,
      chartUI.UniverDocsChartUIPlugin,
      codeUI.UniverDocsCodeUIPlugin,
      latexUI.UniverDocsLatexUIPlugin,
      shapeUI.UniverDocsShapeUIPlugin,
      tableUI.UniverDocsTableUIPlugin,
    ]);
    expectExchangeLeftToFactory(presets);
    expect(pluginOptions(presets, "UNIVER_DRAWING_PLUGIN")).toMatchObject({
      override: [[expect.anything(), null]],
    });
    expect(
      pluginOptions(createDocMobilePresets({ container, compact: true }), "UNIVER_MOBILE_UI_PLUGIN")
    ).toMatchObject({ header: false, toolbar: false });
  }, 30_000);

  it("builds the Slide editor from Mobile UI variants", async () => {
    const [ui, docsUI, slidesUI, chartUI, tableUI, { createSlideMobilePresets }] =
      await Promise.all([
        import("@univerjs/ui"),
        import("@univerjs/docs-ui"),
        import("@univerjs-pro/slides-ui"),
        import("@univerjs-pro/slides-chart-ui"),
        import("@univerjs-pro/slides-table-ui"),
        import("../../web/src/features/editor/units/slide/slide-mobile-presets.js"),
      ]);

    const presets = createSlideMobilePresets({ container, compact: false });
    const constructors = presetPluginConstructors(presets);

    expect(constructors).toEqual(
      expect.arrayContaining([
        ui.UniverMobileUIPlugin,
        docsUI.UniverDocsMobileUIPlugin,
        slidesUI.UniverSlidesMobileUIPlugin,
        chartUI.UniverSlidesChartMobileUIPlugin,
        tableUI.UniverSlidesTableMobileUIPlugin,
      ])
    );
    expectNone(constructors, [
      ui.UniverUIPlugin,
      docsUI.UniverDocsUIPlugin,
      slidesUI.UniverSlidesUIPlugin,
      chartUI.UniverSlidesChartUIPlugin,
      tableUI.UniverSlidesTableUIPlugin,
    ]);
    expectExchangeLeftToFactory(presets);
  }, 30_000);

  it("builds the Board editor from Mobile UI variants", async () => {
    const [ui, docsUI, boardsUI, chartUI, mindUI, tableUI, { createBoardMobilePresets }] =
      await Promise.all([
        import("@univerjs/ui"),
        import("@univerjs/docs-ui"),
        import("@univerjs-pro/boards-ui"),
        import("@univerjs-pro/boards-chart-ui"),
        import("@univerjs-pro/boards-mind-ui"),
        import("@univerjs-pro/boards-table-ui"),
        import("../../web/src/features/editor/units/board/board-mobile-presets.js"),
      ]);

    const presets = createBoardMobilePresets(container);
    const constructors = presetPluginConstructors(presets);

    expect(constructors).toEqual(
      expect.arrayContaining([
        ui.UniverMobileUIPlugin,
        docsUI.UniverDocsMobileUIPlugin,
        boardsUI.UniverBoardsMobileUIPlugin,
        chartUI.UniverBoardsChartMobileUIPlugin,
        mindUI.UniverBoardsMindMobileUIPlugin,
        tableUI.UniverBoardsTableMobileUIPlugin,
      ])
    );
    expectNone(constructors, [
      ui.UniverUIPlugin,
      docsUI.UniverDocsUIPlugin,
      boardsUI.UniverBoardsUIPlugin,
      chartUI.UniverBoardsChartUIPlugin,
      mindUI.UniverBoardsMindUIPlugin,
      tableUI.UniverBoardsTableUIPlugin,
    ]);
    expect(pluginOptions(presets, "UNIVER_MOBILE_UI_PLUGIN")).toMatchObject({
      header: false,
      toolbar: false,
      footer: false,
    });
  }, 30_000);

  it("builds the Base editor from Mobile UI variants", async () => {
    const [ui, docsUI, basesUI, threadCommentUI, { createBaseMobilePresets }] =
      await Promise.all([
        import("@univerjs/ui"),
        import("@univerjs/docs-ui"),
        import("@univerjs-pro/bases-ui"),
        import("@univerjs/thread-comment-ui"),
        import("../../web/src/features/editor/units/base/base-mobile-presets.js"),
      ]);

    const presets = createBaseMobilePresets(container);
    const constructors = presetPluginConstructors(presets);

    expect(constructors).toEqual(
      expect.arrayContaining([
        ui.UniverMobileUIPlugin,
        docsUI.UniverDocsMobileUIPlugin,
        basesUI.UniverBasesMobileUIPlugin,
        // Satisfies bases-thread-comment-ui's dependency with the touch UI.
        threadCommentUI.UniverThreadCommentMobileUIPlugin,
      ])
    );
    expectNone(constructors, [
      ui.UniverUIPlugin,
      docsUI.UniverDocsUIPlugin,
      basesUI.UniverBasesUIPlugin,
      threadCommentUI.UniverThreadCommentUIPlugin,
    ]);
    expect(pluginOptions(presets, "BASES_UI_PLUGIN")).toMatchObject({
      override: [[expect.anything(), null]],
      workbench: { collaborationStatus: false, footer: false },
    });
    expectExchangeLeftToFactory(presets);
  }, 30_000);

  it("pairs the Mobile exchange client with each unit exchange plugin", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "https://workspace.test" } },
    });
    const [{ UniverExchangeClientMobileUIPlugin }, { createMobileExchangeFeaturePlugins }] =
      await Promise.all([
        import("@univerjs-pro/exchange-client"),
        import("../../web/src/features/editor/features/exchange-plugins.js"),
      ]);
    class UnitExchangePlugin {}

    const plugins = createMobileExchangeFeaturePlugins([
      UnitExchangePlugin as unknown as IPresetPlugin,
    ]);

    expect(plugins).toEqual([
      [
        UniverExchangeClientMobileUIPlugin,
        expect.objectContaining({
          importServerUrl:
            "https://workspace.test/universer-api/exchange/{type}/import",
        }),
      ],
      UnitExchangePlugin,
    ]);
  }, 30_000);
});

function expectNone(constructors: unknown[], forbidden: unknown[]): void {
  for (const constructor of forbidden) {
    expect(constructors).not.toContain(constructor);
  }
}

// The factory registers exchange through exchangeFeaturePlugins so it can
// gate them; a preset copy would collide on the shared pluginName.
function expectExchangeLeftToFactory(presets: IPreset[]): void {
  expect(presetPluginKeys(presets)).not.toContain(
    "UNIVER_EXCHANGE_CLIENT_PLUGIN"
  );
}

function presetPluginConstructors(presets: IPreset[]): unknown[] {
  return presets.flatMap((preset) =>
    (preset.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin
    )
  );
}

function presetPluginKeys(presets: IPreset[]): string[] {
  return presets.flatMap((preset) => (preset.plugins ?? []).map(pluginKey));
}

function pluginOptions(presets: IPreset[], expectedPluginKey: string): unknown {
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
