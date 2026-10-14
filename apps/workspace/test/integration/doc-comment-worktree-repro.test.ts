import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  createCollaborationRuntime,
  collaborationCallOptions,
} from "../../server/src/integrations/univer/unit-store.js";

const require = createRequire(import.meta.url);
const { BuildTextUtils, CustomDecorationType, JSONX, TextXActionType, getDocsEmptySnapshot } =
  require("@univerjs/core") as typeof import("@univerjs/core");
const { UnitSnapshotMaterializer } =
  require("@univerjs-pro/collaboration-service") as typeof import("@univerjs-pro/collaboration-service");
const { transformSnapshotToDocumentData } =
  require("@univerjs-pro/collaboration") as typeof import("@univerjs-pro/collaboration");

it.each(["insert", "replace"] as const)(
  "replays Doc comments and checks merge after %s",
  async (edit) => {
    const directory = mkdtempSync(join(tmpdir(), "doc-comment-worktree-repro-"));
    const runtime = createCollaborationRuntime(join(directory, "collaboration.sqlite"));
    const ctx = collaborationCallOptions("author");
    const unitID = "commented-doc";
    const worktreeID = "commented-doc-draft";
    const type = (require("@univerjs/protocol") as typeof import("@univerjs/protocol")).UniverType
      .UNIVER_DOC;
    let reqId = 0;
    const changeset = (baseRev: number, mutations: Array<{ id: string; params: object }>) => ({
      unitID,
      type,
      baseRev,
      revision: baseRev + 1,
      sid: "repro",
      reqId: ++reqId,
      userID: "author",
      memberID: ctx.memberID,
      createTime: 1,
      mutations: mutations.map(({ id, params }) => ({ id, data: JSON.stringify(params) })),
    });
    const materialize = async (
      load: import("@univerjs-pro/collaboration-service").UnitLoadData,
    ) => {
      const materializer = new UnitSnapshotMaterializer();
      try {
        const saved = await materializer.materializeSnapshot({ ...load, sheetBlocks: [] });
        return transformSnapshotToDocumentData(saved.snapshot);
      } finally {
        await materializer.dispose();
      }
    };
    try {
      const initial = getDocsEmptySnapshot(unitID);
      initial.body = {
        dataStream: "Hello world\r\n",
        paragraphs: [{ startIndex: 11, paragraphId: "para_p1" }],
        sectionBreaks: [{ startIndex: 12, sectionId: "section_p1" }],
      };
      await runtime.unitStore.createUnit({
        unitId: unitID,
        unitType: "doc",
        name: "Comment reproduction",
        userId: "author",
        initialData: initial as unknown as Readonly<Record<string, unknown>>,
      });
      const saved = await runtime.commentService.addComment(
        { unitID, content: "Original comment", mentions: [] },
        ctx,
      );
      const comment = {
        id: saved.threadId,
        threadId: saved.threadId,
        unitId: unitID,
        subUnitId: "default_doc",
        ref: "world",
        text: { dataStream: "Original comment\r\n" },
        dT: "2026-10-14",
        personId: "author",
        startOffset: 6,
        endOffset: 11,
        collapsed: false,
      };
      const textX = BuildTextUtils.customDecoration.add({
        ranges: [{ startOffset: 6, endOffset: 11, collapsed: false }],
        id: saved.threadId,
        type: CustomDecorationType.COMMENT,
      });
      const result = await runtime.service.submitChangeset(
        {
          changeset: changeset(1, [
            {
              id: "thread-comment.mutation.add-comment",
              params: { unitId: unitID, subUnitId: "default_doc", comment },
            },
            {
              id: "docs-thread-comment.mutation.add-decoration",
              params: { unitId: unitID, actions: JSONX.getInstance().editOp(textX.serialize()) },
            },
          ]),
        },
        ctx,
      );
      expect(result.status).toBe("committed");
      const originalLoad = await runtime.service.getUnitLoadData(
        { unitID, type, revision: 0 },
        ctx,
      );
      const original = await materialize(originalLoad);
      expect(original.body!.customDecorations).toHaveLength(1);
      // Worktree and comparison panes need the model plugins without trunk comment UI.
      Object.defineProperty(globalThis, "Path2D", { configurable: true, value: class Path2D {} });
      const { Univer, ICommandService, UniverInstanceType } = await import("@univerjs/core");
      const { UniverDocsPlugin } = await import("@univerjs/docs");
      const { getDocReplayCompatibilityPlugins } =
        await import("../../web/src/features/editor/units/doc/doc-features.js");
      const browser = new Univer();
      try {
        browser.registerPlugin(UniverDocsPlugin);
        for (const plugin of getDocReplayCompatibilityPlugins()) {
          if (Array.isArray(plugin)) browser.registerPlugin(plugin[0], plugin[1]);
          else browser.registerPlugin(plugin);
        }
        browser.createUnit(UniverInstanceType.UNIVER_DOC, initial);
        const commands = browser.__getInjector().get(ICommandService);
        for (const mutation of originalLoad.changesets[0]!.mutations) {
          expect(
            commands.syncExecuteCommand(mutation.id, JSON.parse(mutation.data), {
              fromCollab: true,
            }),
          ).toBeTruthy();
        }
        const { ThreadCommentModel } = await import("@univerjs/thread-comment");
        expect(
          browser
            .__getInjector()
            .get(ThreadCommentModel)
            .getComment(unitID, "default_doc", saved.threadId),
        ).toMatchObject({ threadId: saved.threadId });
      } finally {
        browser.dispose();
      }
      await runtime.worktreeService.createWorktree({ worktreeID }, ctx);
      await runtime.worktreeService.addUnit({ worktreeID, unitID }, ctx);
      const draftResult = await runtime.worktreeService.submitChangeset(
        {
          worktreeID,
          changeset: changeset(2, [
            {
              id: "doc.mutation.rich-text-editing",
              params: {
                unitId: unitID,
                actions: JSONX.getInstance().editOp(
                  edit === "insert"
                    ? [{ t: TextXActionType.INSERT, len: 6, body: { dataStream: "Draft " } }]
                    : [
                        { t: TextXActionType.DELETE, len: 11 },
                        { t: TextXActionType.INSERT, len: 11, body: { dataStream: "New content" } },
                      ],
                ),
              },
            },
          ]),
        },
        ctx,
      );
      expect(draftResult.status).toBe("committed");
      const draft = await materialize(
        await runtime.worktreeService.getUnitLoadData(
          { worktreeID, unitID, type, revision: 0 },
          ctx,
        ),
      );
      expect(draft.body!.customDecorations).toHaveLength(edit === "insert" ? 1 : 0);
      await runtime.worktreeService.markReady({ worktreeID }, ctx);
      const merged = await runtime.worktreeService.mergeWorktree({ worktreeID }, ctx);
      const trunk = await materialize(
        await runtime.service.getUnitLoadData({ unitID, type, revision: 0 }, ctx),
      );
      const comments = await runtime.commentService.listComments(
        { unitID, threadIDs: [saved.threadId] },
        ctx,
      );
      expect(merged.worktree.status).toBe("merged");
      expect(trunk.body!.dataStream).toBe(
        edit === "insert" ? "Draft Hello world\r\n" : "New content\r\n",
      );
      expect(trunk.body!.customDecorations).toHaveLength(edit === "insert" ? 1 : 0);
      if (edit === "insert") {
        expect(trunk.body!.customDecorations[0]).toMatchObject({
          id: saved.threadId,
          startIndex: 12,
          endIndex: 16,
        });
        expect(
          trunk.resources!.find(
            (resource: { name: string }) => resource.name === "DOC_UNIVER_THREAD_COMMENT_PLUGIN",
          )?.data,
        ).toContain(saved.threadId);
      }
      expect(trunk.body!.customDecorations).toEqual(draft.body!.customDecorations);
      expect(JSON.stringify(comments)).toContain("Original comment");
    } finally {
      await runtime.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
