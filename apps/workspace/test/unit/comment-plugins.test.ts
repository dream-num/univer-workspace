import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Workspace standard Thread Comment plugins", () => {
  it("keeps the standard UI integration in every Unit-specific lazy editor", async () => {
    for (const [pluginFilename, pluginName] of [
      ["units/sheet/sheet-presets.ts", "UniverSheetsThreadCommentPreset"],
      ["units/doc/doc-editor.tsx", "UniverDocsThreadCommentPreset"],
      ["units/slide/slide-editor.tsx", "UniverSlidesThreadCommentUIPlugin"],
      ["units/base/base-editor.tsx", "UniverBasesThreadCommentUIPlugin"],
      ["units/board/board-editor.tsx", "UniverBoardsThreadCommentUIPlugin"],
    ] as const) {
      const pluginSource = await readFile(
        new URL(
          `../../web/src/features/editor/${pluginFilename}`,
          import.meta.url
        ),
        "utf8"
      );
      expect(pluginSource).toContain(pluginName);
    }
  });

  it("registers comments in every collaboration scope", async () => {
    // Comments are Unit-level conversation, not versioned content: Worktree
    // and Merge Preview editors use the same plugins as Trunk.
    for (const filename of [
      "units/sheet/sheet-editor.tsx",
      "units/sheet/sheet-editor.mobile.tsx",
      "units/doc/doc-editor.tsx",
      "units/slide/slide-editor.tsx",
      "units/base/base-editor.tsx",
      "units/board/board-editor.tsx",
    ]) {
      const source = await readFile(
        new URL(`../../web/src/features/editor/${filename}`, import.meta.url),
        "utf8"
      );
      expect(source, filename).toMatch(/collaborationFeaturePlugins: \(\) =>/);
      expect(source, filename).not.toContain("threadCommentsEnabled");
    }
  });

  it("assembles a Unit UI plugin before the remote datasource", async () => {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      value: class Path2D {},
    });
    const [
      { UniverBasesThreadCommentUIPlugin },
      { UniverThreadCommentDataSourcePlugin },
      { getThreadCommentCollaborationPlugins },
    ] = await Promise.all([
      import("@univerjs-pro/bases-thread-comment-ui"),
      import("@univerjs-pro/thread-comment-datasource"),
      import("../../web/src/features/editor/features/thread-comment-features.js"),
    ]);

    expect(
      getThreadCommentCollaborationPlugins(UniverBasesThreadCommentUIPlugin)
    ).toEqual([
      UniverBasesThreadCommentUIPlugin,
      UniverThreadCommentDataSourcePlugin,
    ]);
  }, 20_000);

  it("keeps the Docs compatibility hook under workarounds", async () => {
    const normalSource = await readFile(
      new URL(
        "../../web/src/features/editor/features/thread-comment-features.ts",
        import.meta.url
      ),
      "utf8"
    );
    const workaroundSource = await readFile(
      new URL(
        "../../web/src/features/editor/workarounds/doc-thread-comment-delete.ts",
        import.meta.url
      ),
      "utf8"
    );

    expect(normalSource).not.toContain("DeleteDocCommentComment");
    expect(workaroundSource).toContain("SDK workaround");
    expect(workaroundSource).toContain("DeleteDocCommentComment");
  });
});
