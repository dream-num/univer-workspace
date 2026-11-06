import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import { actorOf, segmentsOf, tally } from "./actor";
import { issueRef, pullRef } from "./activity";
import type { HomeWork, Issue, Page, RecentResource, RepositoryLoad, RepositorySpace, WireWriteSource, Worktree } from "./types";

export function buildHomeWork(
  worktrees: Page<Worktree>,
  issues: Page<Issue>,
  recent: readonly RecentResource[],
  personalSpace?: RepositorySpace,
): HomeWork {
  const openPulls = worktrees.items.filter((item) => item.state === "draft" || item.state === "ready" || item.state === "merging");
  const openIssues = issues.items.filter((item) => item.state === "open");
  const loads = new Map<string, { space: RepositorySpace; pulls: number; issues: number; sources: WireWriteSource[] }>();
  const loadOf = (space: RepositorySpace) => {
    const load = loads.get(space.id) ?? { space, pulls: 0, issues: 0, sources: [] };
    loads.set(space.id, load);
    return load;
  };
  for (const item of openPulls) {
    const space = item.teamSpace ?? (item.kind === "user" ? personalSpace : undefined);
    if (space) {
      const load = loadOf(space);
      load.pulls += 1;
      load.sources.push(item.createdVia);
    }
  }
  for (const item of openIssues) {
    const load = loadOf(item.space);
    load.issues += 1;
    load.sources.push(item.createdVia);
  }
  const ranking: RepositoryLoad[] = [...loads.values()].map((load) => ({
    space: load.space,
    segments: segmentsOf(tally(load.sources)),
    total: load.pulls + load.issues,
  }));
  ranking.sort((a, b) => b.total - a.total || a.space.name.localeCompare(b.space.name) || a.space.id.localeCompare(b.space.id));
  const byUpdated = (a: { updatedAt: string }, b: { updatedAt: string }) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  // User Worktrees have no Space identity on the wire; the shell can supply its already-loaded Personal Space.
  const unmappedPersonal = !personalSpace && openPulls.some((item) => item.kind === "user");
  const updatedBySpace = new Map<string, string>();
  for (const item of recent) {
    const id = item.location.space.id;
    const previous = updatedBySpace.get(id);
    if (!previous || Date.parse(item.node.updatedAt) > Date.parse(previous)) {
      updatedBySpace.set(id, item.node.updatedAt);
    }
  }
  const agents = tally(openPulls.map((item) => item.createdVia)).agents;
  return {
    updatedBySpace,
    headline: agents > 0
      ? { kind: "agents-drafted", agents, pulls: openPulls.length }
      : openPulls.length || openIssues.length
      ? { kind: "open-work", pulls: openPulls.length, repositories: loads.size + (unmappedPersonal ? 1 : 0) }
      : { kind: "quiet" },
    ranking: ranking.slice(0, 5),
    openBySpace: new Map([...loads].map(([id, { pulls, issues }]) => [id, { pulls, issues }])),
    pulls: [...openPulls].sort(byUpdated).slice(0, 4).map((item) => ({
      pull: { ...pullRef(item, personalSpace?.id), state: item.state },
      space: item.teamSpace ?? (item.kind === "user" ? personalSpace ?? null : null),
      actor: actorOf(item.creator, item.createdVia),
      canReview: item.capabilities.review,
      files: item.unitCount,
      summary: item.summary,
      updatedAt: item.updatedAt,
    })),
    issues: [...openIssues].sort(byUpdated).slice(0, 4).map((item) => ({ issue: issueRef(item), summary: item, author: actorOf(item.author, item.createdVia) })),
    continueWorking: recent.filter((item) => !(item.resource.kind === "blob" && isHtmlViewFilename(item.node.name))).slice(0, 3),
    complete: !worktrees.nextCursor && !issues.nextCursor && !unmappedPersonal,
  };
}
