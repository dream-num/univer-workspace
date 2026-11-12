import { expect, it, vi } from "vitest";

vi.hoisted(() => {
  globalThis.Path2D ??= class {} as typeof Path2D;
});

import { getHtmlViewSheetPlugins } from "@univerjs/univer-workspace-html-viewer/engine";
import { getReferencedSheetPlugins } from "../../web/src/features/editor/features/referenced-sheet-plugins";

it("keeps HTML View Sheet plugins aligned with editor source plugins in order", () => {
  expect(getHtmlViewSheetPlugins().map((plugin) => plugin.pluginName)).toEqual(
    getReferencedSheetPlugins().map((plugin) =>
      (Array.isArray(plugin) ? plugin[0] : plugin).pluginName,
    ),
  );
});
