import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("keeps HTML View Sheet plugins aligned with editor source plugins in order", async () => {
  vi.stubGlobal("Path2D", class {});
  const { getHtmlViewSheetPlugins } = await import("@univerjs/univer-workspace-html-viewer/engine");
  const { getReferencedSheetPlugins } = await import(
    "../../web/src/features/editor/features/referenced-sheet-plugins"
  );

  expect(getHtmlViewSheetPlugins().map((plugin) => plugin.pluginName)).toEqual(
    getReferencedSheetPlugins().map((plugin) =>
      (Array.isArray(plugin) ? plugin[0] : plugin).pluginName,
    ),
  );
}, 30_000);
