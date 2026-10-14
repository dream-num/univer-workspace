import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPreset, IPresetPlugin } from "@univerjs/presets";
vi.mock("../../web/src/features/editor/collaboration-editor", () => ({
  createCollaborationEditor: (definition: unknown) => definition,
}));

afterEach(() => vi.unstubAllGlobals());
const constructorOf = (plugin: IPresetPlugin) => (Array.isArray(plugin) ? plugin[0] : plugin);
describe("persisted comment models in Workspace review", () => {
  it.each(["sheet", "doc", "slide", "base", "board"] as const)(
    "replays and serializes existing %s comments without comment UI",
    async (kind) => {
      vi.stubGlobal("Path2D", class {});
      vi.stubGlobal(
        "Worker",
        class {
          terminate() {}
        },
      );
      const core = await import("@univerjs/core");
      const models = await Promise.all([
        import("@univerjs/sheets"),
        import("@univerjs/docs"),
        import("@univerjs-pro/slides"),
        import("@univerjs-pro/bases"),
        import("@univerjs-pro/boards"),
      ]);
      const comment = await Promise.all([
        import("@univerjs/sheets-thread-comment"),
        import("@univerjs/docs-thread-comment"),
        import("@univerjs-pro/slides-thread-comment"),
        import("@univerjs-pro/bases-thread-comment"),
        import("@univerjs-pro/boards-thread-comment"),
      ]);
      const entry = {
        sheet: [
          core.UniverInstanceType.UNIVER_SHEET,
          models[0].UniverSheetsPlugin,
          comment[0].UniverSheetsThreadCommentPlugin,
        ],
        doc: [
          core.UniverInstanceType.UNIVER_DOC,
          models[1].UniverDocsPlugin,
          comment[1].UniverDocsThreadCommentPlugin,
        ],
        slide: [
          core.UniverInstanceType.UNIVER_SLIDE,
          models[2].UniverSlidesPlugin,
          comment[2].UniverSlidesThreadCommentPlugin,
        ],
        base: [
          core.UniverInstanceType.UNIVER_BASE,
          models[3].UniverBasesPlugin,
          comment[3].UniverBasesThreadCommentPlugin,
        ],
        board: [
          core.UniverInstanceType.UNIVER_BOARD,
          models[4].UniverBoardsPlugin,
          comment[4].UniverBoardsThreadCommentPlugin,
        ],
      }[kind];
      const [type, model, commentModel] = entry as [
        import("@univerjs/core").UniverInstanceType,
        import("@univerjs/core").PluginCtor<import("@univerjs/core").Plugin>,
        import("@univerjs/core").PluginCtor<import("@univerjs/core").Plugin>,
      ];
      let presets: IPreset[], draftPresets: IPreset[];
      const container = { id: "test" } as HTMLElement;
      if (kind === "sheet") {
        const sheet = await import("../../web/src/features/editor/units/sheet/sheet-presets");
        vi.stubGlobal("window", { location: { origin: "https://workspace.test" } });
        presets = sheet.createSheetEditorPresets({
          container,
          license: "",
          universerEndpoint: "",
          threadCommentsEnabled: false,
          collaborationEnabled: false,
          workbenchChrome: "hidden",
        });
        draftPresets = sheet.createSheetEditorPresets({
          container,
          license: "",
          universerEndpoint: "",
          threadCommentsEnabled: false,
        });
      } else {
        const editor =
          kind === "doc"
            ? await import("../../web/src/features/editor/units/doc/doc-editor")
            : kind === "slide"
              ? await import("../../web/src/features/editor/units/slide/slide-editor")
              : kind === "base"
                ? await import("../../web/src/features/editor/units/base/base-editor")
                : await import("../../web/src/features/editor/units/board/board-editor");
        const comparison =
          "createDocComparisonPresets" in editor
            ? editor.createDocComparisonPresets
            : "createSlideComparisonPresets" in editor
              ? editor.createSlideComparisonPresets
              : "createBaseComparisonPresets" in editor
                ? editor.createBaseComparisonPresets
                : editor.createBoardComparisonPresets;
        presets = comparison(container);
        draftPresets = (
          editor.default as unknown as {
            createPresets(
              container: HTMLElement,
              license: string,
              scope: { kind: "worktree" },
            ): IPreset[];
          }
        ).createPresets(container, "", { kind: "worktree" });
      }
      for (const composition of [presets, draftPresets]) {
        expect(composition.flatMap((preset) => preset.plugins.map(constructorOf))).toContain(
          commentModel,
        );
      }
      const baseline = new core.Univer();
      try {
        baseline.registerPlugin(model);
        expect(() =>
          baseline
            .__getInjector()
            .get(core.ICommandService)
            .syncExecuteCommand("thread-comment.mutation.add-comment", {}),
        ).toThrow("is not registered");
      } finally {
        baseline.dispose();
      }
      const univer = new core.Univer();
      try {
        univer.registerPlugin(model);
        univer.registerPlugin(commentModel);
        const id = `${kind}-comment`;
        const data =
          kind === "sheet"
            ? core.getSheetsEmptySnapshot(id)
            : kind === "doc"
              ? core.getDocsEmptySnapshot(id)
              : kind === "slide"
                ? models[2].getSlidesEmptySnapshot(id)
                : kind === "base"
                  ? core.getBasesEmptySnapshot(id)
                  : models[4].getBoardsEmptySnapshot(id);
        univer.createUnit<{ id: string }, import("@univerjs/core").UnitModel>(type, data);
        expect(
          univer
            .__getInjector()
            .get(core.ICommandService)
            .syncExecuteCommand(
              "thread-comment.mutation.add-comment",
              {
                unitId: id,
                subUnitId: "sub",
                comment: {
                  id: "anchor",
                  threadId: "thread",
                  ref: "A1",
                  unitId: id,
                  subUnitId: "sub",
                  text: { dataStream: "Comment\r\n" },
                  personId: "author",
                  dT: "2026-10-14",
                },
              },
              { fromCollab: true },
            ),
        ).toBeTruthy();
        expect(
          JSON.stringify(
            univer.__getInjector().get(core.IResourceManagerService).getResources(id, type),
          ),
        ).toContain("anchor");
      } finally {
        univer.dispose();
      }
    },
    30_000,
  );
});
