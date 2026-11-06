import { describe, expect, it } from "vitest";
import { isCommentOnlyChangeset } from "../../server/src/integrations/univer/comment-changesets.js";

const mutation = (id: string) => ({ id, data: "{}" });

describe("comment-only changesets", () => {
  it("recognizes each Thread Comment anchor mutation", () => {
    for (const id of [
      "thread-comment.mutation.add-comment",
      "thread-comment.mutation.delete-comment",
      "thread-comment.mutation.resolve-comment",
      "thread-comment.mutation.update-comment",
      "thread-comment.mutation.update-comment-ref",
    ]) {
      expect(isCommentOnlyChangeset({ mutations: [mutation(id)] }), id).toBe(true);
    }
  });

  it("requires every mutation to be a comment anchor mutation", () => {
    expect(
      isCommentOnlyChangeset({
        mutations: [
          mutation("thread-comment.mutation.add-comment"),
          mutation("sheet.mutation.set-range-values"),
        ],
      }),
    ).toBe(false);
  });

  it("keeps the Edit gate for empty, unknown and document-rewriting comment mutations", () => {
    expect(isCommentOnlyChangeset({ mutations: [] })).toBe(false);
    expect(
      isCommentOnlyChangeset({ mutations: [mutation("thread-comment.mutation.future")] }),
    ).toBe(false);
    expect(
      isCommentOnlyChangeset({
        mutations: [mutation("docs-thread-comment.mutation.add-decoration")],
      }),
    ).toBe(false);
  });
});
