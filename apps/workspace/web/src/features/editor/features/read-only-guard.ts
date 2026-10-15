import { CommandType } from "@univerjs/core";

export interface ReadOnlyCommandEvent {
  readonly id: string;
  readonly type: CommandType;
  readonly params?: unknown;
  readonly options?: {
    readonly fromCollab?: boolean;
    readonly fromChangeset?: boolean;
    readonly onlyLocal?: boolean;
  };
}

/**
 * Comment mutations are View-level actions (docs/application-design.md,
 * "评论与 Worktree"): the server authorizes them independently of content
 * editing, so a read-only view lets them through. Doc anchors use a dedicated
 * decoration mutation rather than generic rich-text editing.
 */
const COMMENT_MUTATION_PREFIXES = ["thread-comment.mutation.", "docs-thread-comment.mutation."];

/**
 * Decide whether a read-only editor cancels a command. Only local content
 * mutations aimed at the guarded Units are blocked. Mutations for other Units
 * in the same Univer instance, such as the comment input's own document, stay
 * enabled; a mutation without a unitId is treated as aimed at the guarded Unit.
 */
export function isReadOnlyBlockedMutation(
  event: ReadOnlyCommandEvent,
  guardedUnitIds: ReadonlySet<string>,
): boolean {
  if (event.type !== CommandType.MUTATION) return false;
  const options = event.options;
  if (options?.fromCollab || options?.fromChangeset || options?.onlyLocal) return false;
  if (COMMENT_MUTATION_PREFIXES.some((prefix) => event.id.startsWith(prefix))) return false;
  const unitId = (event.params as { readonly unitId?: unknown } | undefined)?.unitId;
  if (typeof unitId === "string" && !guardedUnitIds.has(unitId)) return false;
  return true;
}
