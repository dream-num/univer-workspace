import { dayWindow } from "./days";
import type { Issue, IssueFacets, Page } from "./types";

export function buildIssueFacets(page: Page<Issue>, meUserId: string, now: Date): IssueFacets {
  const open = page.items.filter((item) => item.state === "open");
  const byLabel = new Map<string, number>();
  for (const item of open) {
    for (const id of new Set(item.labels.map((label) => label.id))) byLabel.set(id, (byLabel.get(id) ?? 0) + 1);
  }
  const start = Date.parse(dayWindow(now).startIso);
  return {
    open: open.length,
    assignedToMe: open.filter((item) => item.assignees.some((user) => user.id === meUserId)).length,
    createdByMe: open.filter((item) => item.author.id === meUserId).length,
    recentlyActive: open.filter((item) => Date.parse(item.updatedAt) >= start && Date.parse(item.updatedAt) <= now.getTime()).length,
    byLabel,
    exact: !page.nextCursor,
  };
}
