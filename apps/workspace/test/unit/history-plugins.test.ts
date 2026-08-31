import { readFile } from "node:fs/promises";
import { Plugin } from "@univerjs/core";
import { describe, expect, it } from "vitest";

describe("Workspace standard History plugins", () => {
  it("keeps each standard plugin in its Unit-specific lazy editor", async () => {
    for (const [filename, pluginName, configKey] of [
      ["sheet-editor.tsx", "UniverSheetsHistoryUIPlugin", "historyListServerUrl"],
      ["doc-editor.tsx", "UniverDocsHistoryUIPlugin", "historyServerUrl"],
      ["slide-editor.tsx", "UniverSlidesHistoryUIPlugin", "historyServerUrl"],
      ["base-editor.tsx", "UniverBasesHistoryUIPlugin", "historyServerUrl"],
      ["board-editor.tsx", "UniverBoardsHistoryUIPlugin", "historyServerUrl"],
    ] as const) {
      const source = await readFile(
        new URL(
          `../../web/src/features/editor/${filename}`,
          import.meta.url
        ),
        "utf8"
      );
      expect(source).toContain(pluginName);
      expect(source).toContain(`${configKey}: "/universer-api/history"`);
      expect(source).toContain("univerContainerId: containerId");
    }
  });

  it(
    "registers the supplied standard plugin only for Trunk",
    async () => {
      Object.defineProperty(globalThis, "Path2D", {
        configurable: true,
        value: class Path2D {},
      });
      const { createWorkspaceHistoryPlugins } = await import(
        "../../web/src/features/editor/collaboration-editor"
      );
      class TestHistoryPlugin extends Plugin {}
      const history = {
        createPlugin: (containerId: string) => [
          TestHistoryPlugin,
          { containerId },
        ] as const,
        locales: { "zh-CN": {}, "en-US": {} },
      };
      expect(
        createWorkspaceHistoryPlugins(
          { kind: "trunk" },
          history,
          "history-editor"
        )
      ).toEqual([[TestHistoryPlugin, { containerId: "history-editor" }]]);
      expect(
        createWorkspaceHistoryPlugins(
          { kind: "worktree", worktreeId: "worktree-1" },
          history,
          "history-editor"
        )
      ).toEqual([]);
      expect(
        createWorkspaceHistoryPlugins(
          { kind: "mergePreview", worktreeId: "worktree-1" },
          history,
          "history-editor"
        )
      ).toEqual([]);
      expect(
        createWorkspaceHistoryPlugins(
          { kind: "trunk" },
          { ...history, providedByPreset: true },
          "history-editor"
        )
      ).toEqual([]);
    },
    15_000
  );
});
