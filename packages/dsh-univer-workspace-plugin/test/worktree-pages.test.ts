import { expect, it, vi } from "vitest";
import { refreshWorktreeWindow } from "../src/client/api/worktree-pages.ts";
import type { WorktreeSummaryView } from "../src/shared/state.ts";

it("refreshes all visible pages with new cursors and removes entries absent from the new window", async () => {
  const item = (worktreeId: string) => ({ worktreeId }) as WorktreeSummaryView;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ items: [item("new"), item("a")], nextCursor: "fresh" })
    .mockResolvedValueOnce({ items: [item("b"), item("c")], nextCursor: "next" });
  const result = await refreshWorktreeWindow(
    { scope: "active", limit: 2, cursor: "obsolete" },
    4,
    fetch,
  );
  expect(fetch.mock.calls.map(([query]) => query.cursor)).toEqual([undefined, "fresh"]);
  expect(result.items.map((item) => item.worktreeId)).toEqual(["new", "a", "b", "c"]);
  expect(result.nextCursor).toBe("next");
});
