import type {
  WorktreeListQuery,
  WorktreeSummaryPage,
  WorktreeSummaryView,
} from "../../shared/state.ts";

/** Refresh the visible window with fresh cursors; never replay obsolete cursors. */
export async function refreshWorktreeWindow(
  query: WorktreeListQuery,
  visibleCount: number,
  fetchPage: (query: WorktreeListQuery) => Promise<WorktreeSummaryPage>,
): Promise<WorktreeSummaryPage> {
  const { cursor: _cursor, ...base } = query;
  const items = new Map<string, WorktreeSummaryView>();
  let cursor: string | undefined;
  let nextCursor: string | null = null;
  const pages = Math.max(1, Math.ceil(visibleCount / (query.limit ?? 50)));
  for (let page = 0; page < pages; page++) {
    const result = await fetchPage({ ...base, ...(cursor === undefined ? {} : { cursor }) });
    for (const item of result.items) items.set(item.worktreeId, item);
    nextCursor = result.nextCursor;
    if (nextCursor === null) break;
    if (nextCursor === cursor) throw new Error("Worktree pagination did not advance");
    cursor = nextCursor;
  }
  return { items: [...items.values()], nextCursor };
}
