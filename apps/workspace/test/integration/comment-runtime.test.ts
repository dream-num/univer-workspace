import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createCollaborationRuntime } from "../../server/src/integrations/univer/unit-store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("comment collaboration runtime", () => {
  it("initializes and reopens the additive Comment schema in the Collaboration SQLite file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "univer-comment-runtime-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "collaboration.sqlite");
    const unitId = "comment-runtime-sheet";
    let runtime = createCollaborationRuntime(filename);
    await runtime.unitStore.createUnit({
      unitId,
      unitType: "sheet",
      name: "Comment Runtime Sheet",
      userId: "comment-author",
    });
    const comment = await runtime.commentService.addComment(
      { unitID: unitId, content: "Persisted comment", mentions: [] },
      {
        userID: "comment-author",
        memberID: "comment-member",
        customData: {},
      }
    );
    await runtime.dispose();

    const database = new DatabaseSync(filename);
    try {
      expect(
        database
          .prepare(
            `SELECT version
             FROM collaboration_schema_versions
             WHERE component = 'comment'`
          )
          .get()
      ).toMatchObject({ version: 1 });
      expect(
        database
          .prepare(
            `SELECT content
             FROM collaboration_comments
             WHERE unit_id = ? AND thread_id = ?`
          )
          .get(unitId, comment.threadId)
      ).toMatchObject({ content: "Persisted comment" });
    } finally {
      database.close();
    }

    runtime = createCollaborationRuntime(filename);
    const listed = await runtime.commentService.listComments(
      { unitID: unitId, threadIDs: [comment.threadId] },
      { userID: "comment-author", customData: {} }
    );
    expect(listed.comments[comment.threadId]).toMatchObject({
      threadId: comment.threadId,
      replies: [{ content: "Persisted comment", userId: "comment-author" }],
    });
    await runtime.dispose();
  });
});
