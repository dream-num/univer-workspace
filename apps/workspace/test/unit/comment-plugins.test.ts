import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Workspace standard Thread Comment plugins", () => {
  it("keeps the standard UI integration in every Unit-specific lazy editor", async () => {
    for (const [pluginFilename, scopeFilename, pluginName] of [
      [
        "sheet-presets.ts",
        "sheet-editor.tsx",
        "UniverSheetsThreadCommentPreset",
      ],
      ["doc-editor.tsx", "doc-editor.tsx", "UniverDocsThreadCommentPreset"],
      [
        "slide-editor.tsx",
        "slide-editor.tsx",
        "UniverSlidesThreadCommentUIPlugin",
      ],
      [
        "base-editor.tsx",
        "base-editor.tsx",
        "UniverBasesThreadCommentUIPlugin",
      ],
      [
        "board-editor.tsx",
        "board-editor.tsx",
        "UniverBoardsThreadCommentUIPlugin",
      ],
    ] as const) {
      const pluginSource = await readFile(
        new URL(
          `../../web/src/features/editor/${pluginFilename}`,
          import.meta.url
        ),
        "utf8"
      );
      const scopeSource = await readFile(
        new URL(
          `../../web/src/features/editor/${scopeFilename}`,
          import.meta.url
        ),
        "utf8"
      );
      expect(pluginSource).toContain(pluginName);
      expect(scopeSource).toContain('collaborationScope.kind === "trunk"');
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
      import("../../web/src/features/editor/thread-comment-features.js"),
    ]);

    expect(
      getThreadCommentCollaborationPlugins(
        true,
        UniverBasesThreadCommentUIPlugin
      )
    ).toEqual([
      UniverBasesThreadCommentUIPlugin,
      UniverThreadCommentDataSourcePlugin,
    ]);
    expect(
      getThreadCommentCollaborationPlugins(
        false,
        UniverBasesThreadCommentUIPlugin
      )
    ).toEqual([]);
  }, 20_000);

  it("keeps the Docs compatibility hook under workarounds", async () => {
    const normalSource = await readFile(
      new URL(
        "../../web/src/features/editor/thread-comment-features.ts",
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
