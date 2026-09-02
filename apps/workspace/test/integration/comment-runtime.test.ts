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
    const comments: Array<{
      readonly unitId: string;
      readonly threadId: string;
      readonly content: string;
    }> = [];
    let runtime = createCollaborationRuntime(filename);
    for (const unitType of [
      "sheet",
      "doc",
      "slide",
      "base",
      "board",
    ] as const) {
      const unitId = `comment-runtime-${unitType}`;
      const content = `Persisted ${unitType} comment`;
      await runtime.unitStore.createUnit({
        unitId,
        unitType,
        name: `Comment Runtime ${unitType}`,
        userId: "comment-author",
      });
      const comment = await runtime.commentService.addComment(
        { unitID: unitId, content, mentions: [] },
        {
          userID: "comment-author",
          memberID: "comment-member",
          customData: {},
        }
      );
      comments.push({ unitId, threadId: comment.threadId, content });
    }
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
      for (const comment of comments) {
        expect(
          database
            .prepare(
              `SELECT content
               FROM collaboration_comments
               WHERE unit_id = ? AND thread_id = ?`
            )
            .get(comment.unitId, comment.threadId)
        ).toMatchObject({ content: comment.content });
      }
    } finally {
      database.close();
    }

    runtime = createCollaborationRuntime(filename);
    for (const comment of comments) {
      const listed = await runtime.commentService.listComments(
        { unitID: comment.unitId, threadIDs: [comment.threadId] },
        { userID: "comment-author", customData: {} }
      );
      expect(listed.comments[comment.threadId]).toMatchObject({
        threadId: comment.threadId,
        replies: [
          { content: comment.content, userId: "comment-author" },
        ],
      });
    }
    await runtime.dispose();
  });
});
