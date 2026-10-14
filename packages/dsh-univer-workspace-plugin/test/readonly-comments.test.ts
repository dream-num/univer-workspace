import { describe, expect, it } from "vitest";
import { CommentSolvedStatus, type IListCommentsResponse } from "@univerjs/protocol";
import {
  createReadonlyCommentDataSource,
  COMMENT_WRITE_COMMANDS,
} from "../src/client/viewer/readonly-comments.ts";

const response = (kind: string): IListCommentsResponse => ({
  error: undefined,
  users: {},
  comments: {
    thread: {
      threadId: "thread",
      solved: CommentSolvedStatus.OpenOrReOpen,
      replies: [
        {
          threadId: "thread",
          replyId: "thread",
          content: JSON.stringify({ dataStream: `${kind} body\r\n` }),
          userId: "author",
          createTimestamp: 1,
        },
        {
          threadId: "thread",
          replyId: "reply",
          content: "Legacy reply",
          userId: "reviewer",
          createTimestamp: 2,
        },
      ],
    },
  },
});

describe("Worktree comment body boundary", () => {
  it.each(["sheet", "doc", "slide", "base", "board"])(
    "reads %s body/replies without embedding them in anchors or permitting writes",
    async (kind) => {
      const remote = response(kind);
      const before = structuredClone(remote);
      const source = createReadonlyCommentDataSource(async () => remote);
      const [comment] = await source.listComments(kind, "subunit", ["thread"]);
      if (!comment) throw new Error("Comment read returned no root.");
      expect(comment).toMatchObject({
        id: "thread",
        threadId: "thread",
        unitId: kind,
        text: { dataStream: `${kind} body\r\n` },
        children: [{ id: "reply", parentId: "thread", text: { dataStream: "Legacy reply\r\n" } }],
      });
      expect(source.saveCommentToSnapshot({ ...comment, ref: "draft-anchor" })).toEqual({
        id: "thread",
        threadId: "thread",
        ref: "draft-anchor",
      });
      await expect(source.addComment({ ...comment, ref: "draft-anchor" })).rejects.toThrow(
        "read-only",
      );
      await expect(source.updateComment({ ...comment, ref: "draft-anchor" })).rejects.toThrow(
        "read-only",
      );
      await expect(source.resolveComment({ ...comment, ref: "draft-anchor" })).rejects.toThrow(
        "read-only",
      );
      await expect(source.deleteComment(kind, "subunit", "thread", "reply")).rejects.toThrow(
        "read-only",
      );
      await expect(source.deleteThread!(kind, "subunit", "thread")).rejects.toThrow("read-only");
      expect(remote).toEqual(before);
    },
  );
  it("gates the Doc text-range authoring command without gating reference mutations", () => {
    expect(COMMENT_WRITE_COMMANDS.has("docs.command.create-text-range-comment")).toBe(true);
    expect(COMMENT_WRITE_COMMANDS.has("thread-comment.mutation.update-comment-ref")).toBe(false);
    expect(COMMENT_WRITE_COMMANDS.has("docs-thread-comment.mutation.add-decoration")).toBe(false);
  });
});

import { isCommentWritePath } from "../src/collab-proxy/plugin.ts";
it("the DSH proxy refuses body writes but permits comment reads", () => {
  for (const action of ["add", "reply", "edit", "solved", "delete"])
    expect(isCommentWritePath(`/universer-api/comment/unit/unit-1/${action}`)).toBe(true);
  expect(isCommentWritePath("/universer-api/comment/unit/unit-1/list")).toBe(false);
});

import { ICanvasPopupService } from "@univerjs/ui";
import { ICommandService, type Injector } from "@univerjs/core";
import { IThreadCommentDataSourceService } from "@univerjs/thread-comment";
import { ReadonlyCommentPlugin } from "../src/client/viewer/readonly-comments.ts";

it("scopes floating comment controls to this runtime and restores the public popup service on disposal", () => {
  const received: unknown[] = [];
  const original = (popup: unknown) => { received.push(popup); return "popup"; };
  const popups = { addPopup: original };
  const sources = { dataSource: undefined, syncUpdateMutationToColla: true };
  const injector = {
    has: (id: unknown) => id === ICanvasPopupService,
    get: (id: unknown) => id === ICanvasPopupService ? popups : id === IThreadCommentDataSourceService ? sources : id === ICommandService ? { beforeCommandExecuted: () => ({ dispose() {} }) } : undefined,
  } as unknown as Injector;
  const container = { setAttribute() {}, removeAttribute() {} } as unknown as HTMLElement;
  const plugin = new ReadonlyCommentPlugin({ endpoint: "/comment", container }, injector);
  plugin.onStarting();
  popups.addPopup({ unitId: "unit", portal: true });
  expect(received).toEqual([{ unitId: "unit", portal: false }]);
  plugin.dispose();
  expect(popups.addPopup).toBe(original);
  popups.addPopup({ unitId: "trunk", portal: true });
  expect(received[1]).toEqual({ unitId: "trunk", portal: true });
});
