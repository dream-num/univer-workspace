import {
  AddCommentMutation,
  DeleteCommentMutation,
  ResolveCommentMutation,
  UpdateCommentMutation,
  UpdateCommentRefMutation,
} from "@univerjs/thread-comment";

// Thread Comment anchor mutations only change the comment model, so they need Unit Comment
// rather than Unit Edit, matching univer-collaboration-sdk#172 and univer-pro#6073. The list
// is explicit: docs-thread-comment.mutation.add-decoration rewrites document content and
// stays out.
const COMMENT_MUTATION_IDS: ReadonlySet<string> = new Set([
  AddCommentMutation.id,
  DeleteCommentMutation.id,
  ResolveCommentMutation.id,
  UpdateCommentMutation.id,
  UpdateCommentRefMutation.id,
]);

/** A non-empty changeset made only of Thread Comment anchor mutations. */
export function isCommentOnlyChangeset(changeset: {
  readonly mutations: readonly { readonly id: string }[];
}): boolean {
  return (
    changeset.mutations.length > 0 &&
    changeset.mutations.every((mutation) => COMMENT_MUTATION_IDS.has(mutation.id))
  );
}
