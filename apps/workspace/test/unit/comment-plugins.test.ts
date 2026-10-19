import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { IPreset, IPresetPlugin } from "@univerjs/presets";

const EDITOR_ROOT = new URL("../../web/src/features/editor/", import.meta.url);

describe("Workspace Thread Comment composition", () => {
  it("registers the anchor model explicitly for every Unit type and variant", async () => {
    installBrowserShapeStubs();
    const [
      { threadCommentComposition },
      { UniverThreadCommentDataSourcePlugin },
      { UniverWorkspaceDocsThreadCommentDataSourcePlugin },
    ] = await Promise.all([
      import("../../web/src/features/editor/features/thread-comments.js"),
      import("@univerjs-pro/thread-comment-datasource"),
      import("../../web/src/features/editor/workarounds/doc-thread-comment-delete.js"),
    ]);
    const plugins = {
      sheet: { model: "SHEET_THREAD_COMMENT_BASE_PLUGIN", ui: "SHEET_THREAD_COMMENT_UI_PLUGIN" },
      doc: { model: "DOC_THREAD_COMMENT_PLUGIN", ui: "DOC_THREAD_COMMENT_UI_PLUGIN" },
      slide: {
        model: "UNIVER_SLIDES_THREAD_COMMENT_PLUGIN",
        ui: "UNIVER_SLIDES_THREAD_COMMENT_UI_PLUGIN",
      },
      base: {
        model: "UNIVER_BASES_THREAD_COMMENT_PLUGIN",
        ui: "UNIVER_BASES_THREAD_COMMENT_UI_PLUGIN",
      },
      board: {
        model: "UNIVER_BOARDS_THREAD_COMMENT_PLUGIN",
        ui: "UNIVER_BOARDS_THREAD_COMMENT_UI_PLUGIN",
      },
    } as const;

    for (const unit of ["sheet", "doc", "slide", "base", "board"] as const) {
      for (const variant of ["desktop", "mobile", "comparison"] as const) {
        const composition = threadCommentComposition(unit, variant);
        const names = presetPluginNames(composition.presets);
        const label = `${unit}/${variant}`;
        const { model, ui } = plugins[unit];
        // The model is explicit and registers before the Unit UI that depends on it.
        expect(names, label).toContain(model);
        if (variant === "comparison") {
          expect(names, label).toEqual([model]);
          expect(composition.collaborationPlugins, label).toEqual([]);
        } else {
          expect(names.indexOf(ui), label).toBeGreaterThan(names.indexOf(model));
          expect(composition.collaborationPlugins, label).toEqual([
            unit === "doc"
              ? UniverWorkspaceDocsThreadCommentDataSourcePlugin
              : UniverThreadCommentDataSourcePlugin,
          ]);
        }
        if (variant === "mobile") {
          expect(names, label).toContain("UNIVER_THREAD_COMMENT_UI_PLUGIN");
        }
      }
    }
  }, 30_000);

  it("composes comments through the shared module in every editor", async () => {
    for (const filename of [
      "units/sheet/sheet-editor.tsx",
      "units/sheet/sheet-editor.mobile.tsx",
      "units/doc/doc-editor.tsx",
      "units/doc/doc-editor.mobile.tsx",
      "units/slide/slide-editor.tsx",
      "units/slide/slide-editor.mobile.tsx",
      "units/base/base-editor.tsx",
      "units/base/base-editor.mobile.tsx",
      "units/board/board-editor.tsx",
      "units/board/board-editor.mobile.tsx",
      "units/sheet/sheet-comparison-presets.ts",
    ]) {
      const source = await readFile(new URL(filename, EDITOR_ROOT), "utf8");
      expect(source, filename).toContain("threadCommentComposition(");
      expect(source, filename).not.toMatch(/ThreadComment(?:Mobile)?UIPlugin|ThreadCommentPreset/);
    }
  });

  it("keeps the Docs deletion workaround under workarounds", async () => {
    const compositionSource = await readFile(
      new URL("features/thread-comments.ts", EDITOR_ROOT),
      "utf8",
    );
    const workaroundSource = await readFile(
      new URL("workarounds/doc-thread-comment-delete.ts", EDITOR_ROOT),
      "utf8",
    );
    expect(compositionSource).not.toContain("DeleteDocCommentComment");
    expect(workaroundSource).toContain("SDK workaround");
    expect(workaroundSource).toContain("DeleteDocCommentComment");
  });
});

function presetPluginNames(presets: readonly IPreset[]): string[] {
  return presets.flatMap((preset) =>
    preset.plugins.map(
      (plugin: IPresetPlugin) => (Array.isArray(plugin) ? plugin[0] : plugin).pluginName,
    ),
  );
}

function installBrowserShapeStubs(): void {
  Object.defineProperty(globalThis, "Path2D", {
    configurable: true,
    value: class Path2D {},
  });
}
