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
const { UnitSnapshotMaterializer } =
  require("@univerjs-pro/collaboration-service") as typeof import("@univerjs-pro/collaboration-service");
const {
  transformSnapshotToWorkbookData,
  transformSnapshotToDocumentData,
  transformSnapshotToSlideData,
  transformSnapshotToBaseData,
  transformSnapshotToBoardData,
} = require("@univerjs-pro/collaboration") as typeof import("@univerjs-pro/collaboration");
const { UniverType } = require("@univerjs/protocol") as typeof import("@univerjs/protocol");
it.each(["sheet", "doc", "slide", "base", "board"] as const)(
  "preserves %s comments across draft replay and merge",
  async (kind) => {
    const directory = mkdtempSync(join(tmpdir(), "unit-comment-merge-"));
    const runtime = createCollaborationRuntime(join(directory, "collaboration.sqlite"));
    const context = collaborationCallOptions("author");
    const unitID = `${kind}-comments`,
      worktreeID = `draft-${kind}`;
    const type = {
      sheet: UniverType.UNIVER_SHEET,
      doc: UniverType.UNIVER_DOC,
      slide: UniverType.UNIVER_SLIDE,
      base: UniverType.UNIVER_BASE,
      board: UniverType.UNIVER_BOARD,
    }[kind];
    const subUnitId = kind === "doc" ? "default_doc" : "subunit-1";
    const load = async (draft = false) => {
      const loaded = draft
        ? await runtime.worktreeService.getUnitLoadData(
            { worktreeID, unitID, type, revision: 0 },
            context,
          )
        : await runtime.service.getUnitLoadData({ unitID, type, revision: 0 }, context);
      const materializer = new UnitSnapshotMaterializer();
      try {
        const saved = await materializer.materializeSnapshot({ ...loaded, sheetBlocks: [] });
        switch (kind) {
          case "sheet":
            return await transformSnapshotToWorkbookData(saved.snapshot, []);
          case "doc":
            return transformSnapshotToDocumentData(saved.snapshot);
          case "slide":
            return transformSnapshotToSlideData(saved.snapshot);
          case "base":
            return await transformSnapshotToBaseData(saved.snapshot, []);
          case "board":
            return transformSnapshotToBoardData(saved.snapshot);
        }
      } finally {
        await materializer.dispose();
      }
    };
    const changeset = (baseRev: number, id: string, params: object) => ({
      unitID,
      type,
      baseRev,
      revision: baseRev + 1,
      sid: "comments",
      reqId: baseRev,
      userID: "author",
      memberID: context.memberID,
      createTime: 1,
      mutations: [{ id, data: JSON.stringify(params) }],
    });
    try {
      await runtime.unitStore.createUnit({
        unitId: unitID,
        unitType: kind,
        name: "Original",
        userId: "author",
      });
      const body = await runtime.commentService.addComment(
        { unitID, content: "Original body", mentions: [] },
        context,
      );
      const comment = {
        id: body.threadId,
        threadId: body.threadId,
        unitId: unitID,
        subUnitId,
        ref: "A1",
        text: { dataStream: "Original body\r\n" },
        personId: "author",
        dT: "2026-10-14",
      };
      expect(
        (
          await runtime.service.submitChangeset(
            {
              changeset: changeset(1, "thread-comment.mutation.add-comment", {
                unitId: unitID,
                subUnitId,
                comment,
              }),
            },
            context,
          )
        ).status,
      ).toBe("committed");
      expect(JSON.stringify(await load())).toContain(body.threadId);
      await runtime.worktreeService.createWorktree({ worktreeID }, context);
      await runtime.worktreeService.addUnit({ worktreeID, unitID }, context);
      // Anchor-only changes exercise branch replay without writing comment bodies.
      expect(
        (
          await runtime.worktreeService.submitChangeset(
            {
              worktreeID,
              changeset: changeset(2, "thread-comment.mutation.update-comment-ref", {
                unitId: unitID,
                subUnitId,
                payload: { commentId: body.threadId, ref: "B2" },
              }),
            },
            context,
          )
        ).status,
      ).toBe("committed");
      expect(JSON.stringify(await load(true))).toContain(body.threadId);
      await runtime.worktreeService.markReady({ worktreeID }, context);
      expect(
        (await runtime.worktreeService.mergeWorktree({ worktreeID }, context)).worktree.status,
      ).toBe("merged");
      const after = JSON.stringify(await load());
      expect(after).toContain(body.threadId);
      expect(after).toContain("B2");
      expect(
        JSON.stringify(
          await runtime.commentService.listComments(
            { unitID, threadIDs: [body.threadId] },
            context,
          ),
        ),
      ).toContain("Original body");
    } finally {
      await runtime.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
