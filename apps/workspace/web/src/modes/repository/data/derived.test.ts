import { describe, expect, it } from "vitest";
import { parseRepositoryActivity } from "./activity";
import { actorOf, segmentsOf } from "./actor";
import { ACTIVITY_DAYS, asDayKey, browserTimeZone, dayKeyOf, dayWindow, sliceSeries } from "./days";
import { buildHomeWork } from "./home-work";
import { buildIssueFacets } from "./issue-facets";
import { buildPendingIndex, pendingAncestryPlan, pendingDetailPlan, type NodeAncestry } from "./pending";
import { at, detail, issue, now, pull, recent, space, unit, user } from "./fixtures.test-support";

const page = <T>(items: T[], nextCursor: string | null = null) => ({ items, nextCursor });
const ancestry = new Map<string, NodeAncestry>([
  ["file", { spaceId: space.id, ancestors: ["outer", "inner"], complete: true }],
  ["inner", { spaceId: space.id, ancestors: ["outer"], complete: true }],
]);

describe("Repository calendar and activity", () => {
  it("builds fourteen dense local days across month and DST boundaries", () => {
    const window = dayWindow(now);
    expect(window.days).toHaveLength(ACTIVITY_DAYS);
    expect(window.days).toEqual([
      "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31",
      "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
    ]);
    expect(new Date(window.startIso)).toEqual(new Date(2026, 9, 24));
    expect(dayWindow(new Date(2028, 2, 1)).days).toContain("2028-02-29");
  });

  it("buckets instants on either side of local midnight and rejects invalid dates", () => {
    const midnight = new Date(2026, 10, 6);
    expect(dayKeyOf(new Date(midnight.getTime() - 1).toISOString())).toBe("2026-11-05");
    expect(dayKeyOf(midnight.toISOString())).toBe("2026-11-06");
    expect(() => dayKeyOf("invalid")).toThrow(RangeError);
  });

  it("parses server days and all event kinds without inferring source from the user", () => {
    const events = [
      { kind: "pull-merged", at: at(6), actor: null, writeSource: "unknown", pull: { id: "p", number: 1, title: "Plan", spaceId: space.id } },
      { kind: "issue-closed", at: at(5), actor: user, writeSource: "unknown", issue: { number: 2, title: "Review", spaceId: space.id } },
      { kind: "issue-opened", at: at(4), actor: user, writeSource: "agent", issue: { number: 2, title: "Review", spaceId: space.id } },
      { kind: "pull-opened", at: at(3), actor: user, writeSource: "browser", pull: { id: "p", number: 1, title: "Plan", spaceId: space.id } },
    ] satisfies import("./types").WireActivity["events"];
    const result = parseRepositoryActivity({
      timeZone: browserTimeZone(),
      days: dayWindow(now).days.map((day, i) => ({ day, opened: { browser: i === 0 ? 2 : 0, agent: i === 0 ? 3 : 0, unknown: i === 0 ? 1 : 0 }, merged: i === 0 ? 4 : 0 })),
      events,
      complete: false,
    });
    expect(result.series.days).toHaveLength(14);
    expect(result.series.days[0]).toEqual({ day: "2026-10-24", segments: [{ key: "people", value: 2 }, { key: "agents", value: 3 }, { key: "unknown", value: 1 }], total: 6, merged: 4 });
    expect(result.series.days[1]).toMatchObject({ segments: [{ key: "people", value: 0 }, { key: "agents", value: 0 }], total: 0, merged: 0 });
    expect(result.events).toEqual([
      { kind: "pull-merged", at: at(6), actor: { user: null, kind: "unknown" }, pull: events[0]?.pull },
      { kind: "issue-closed", at: at(5), actor: { user, kind: "unknown" }, issue: events[1]?.issue },
      { kind: "issue-opened", at: at(4), actor: { user, kind: "agents" }, issue: events[2]?.issue },
      { kind: "pull-opened", at: at(3), actor: { user, kind: "people" }, pull: events[3]?.pull },
    ]);
    expect(result.lastActivityAt).toBe(at(6));
    expect(result.complete).toBe(false);
    expect(sliceSeries(result.series, 7)).toEqual({ days: result.series.days.slice(-7), complete: false });
    expect(parseRepositoryActivity({ timeZone: "UTC", days: [], events: [], complete: true })).toMatchObject({ lastActivityAt: null, complete: true, series: { complete: true } });
    expect(() => asDayKey("invalid")).toThrow(RangeError);
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("always includes people and agents, and shows unknown only above zero", () => {
    expect(segmentsOf({ people: 0, agents: 0, unknown: 0 })).toEqual([{ key: "people", value: 0 }, { key: "agents", value: 0 }]);
    expect(segmentsOf({ people: 1, agents: 2, unknown: 3 })).toEqual([{ key: "people", value: 1 }, { key: "agents", value: 2 }, { key: "unknown", value: 3 }]);
  });

  it.each([
    ["browser", "people"], ["agent", "agents"], ["unknown", "unknown"],
  ] as const)("maps %s writes to %s without changing identity", (source, kind) => {
    expect(actorOf(user, source)).toEqual({ user, kind });
    expect(actorOf(null, source)).toEqual({ user: null, kind });
  });
});

describe("Repository pending changes", () => {
  it("indexes modified, deleted and added files, including additions without a Node and ancestor badges", () => {
    const result = buildPendingIndex(space.id, [detail({ units: [
      unit(), unit({ nodeId: "deleted", change: "deleted" }),
      unit({ nodeId: "created", change: "added", target: { spaceId: space.id, parentNodeId: "inner" } }),
      unit({ nodeId: null, change: "added", source: "worktree", target: { spaceId: space.id, parentNodeId: "inner" } }),
      unit({ nodeId: null, change: "added", source: "worktree", target: { spaceId: space.id, parentNodeId: null } }),
      unit({ nodeId: null, change: "added", source: "worktree", target: null }),
      unit({ nodeId: "unchanged", change: "unchanged" }),
      unit({ nodeId: null, change: "added", target: { spaceId: "elsewhere", parentNodeId: null } }),
    ] })], new Map([...ancestry,
      ["deleted", { spaceId: space.id, ancestors: ["outer", "inner"], complete: true }],
      ["created", { spaceId: space.id, ancestors: ["outer", "inner"], complete: true }],
    ]), true);
    expect(result.byNode.get("file")?.[0]).toMatchObject({ kind: "modified", scope: "self", actor: { user, kind: "unknown" } });
    expect(result.byNode.get("deleted")?.[0]?.kind).toBe("deleted");
    expect(result.byNode.get("created")?.[0]?.kind).toBe("added");
    expect(result.byNode.get("inner")).toHaveLength(4);
    expect(result.byNode.get("outer")).toHaveLength(4);
    expect(result.byNode.get("outer")?.every((item) => item.scope === "inside")).toBe(true);
    expect(result.additionsByParent.get("inner")).toHaveLength(2);
    expect(result.additionsByParent.get("root")).toHaveLength(2);
    expect(result.byNode.has("unchanged")).toBe(false);
    expect(result.complete).toBe(true);
  });

  it("keeps worktree-local additions at the root without fetching trunk ancestry", () => {
    const details = [
      detail({ id: "risk", number: 3, units: [unit({ name: "Risk Register", change: "added", source: "worktree", nodeId: "f8d11fd6-local", target: null })] }),
      detail({ id: "budget", number: 2, units: [unit({ name: "Channel Budget Detail", change: "added", source: "worktree", nodeId: "budget-local", target: null })] }),
    ];
    expect(pendingAncestryPlan(space.id, details)).toEqual({ ids: [], complete: true });
    const result = buildPendingIndex(space.id, details, new Map(), true);
    expect(result.complete).toBe(true);
    expect(result.additionsByParent.get("root")?.map((change) => [change.unitName, change.pull.number, change.kind])).toEqual([
      ["Channel Budget Detail", 2, "added"], ["Risk Register", 3, "added"],
    ]);
    expect(result.byNode.get("f8d11fd6-local")?.[0]).toBe(result.additionsByParent.get("root")?.[1]);
    const addedTrunk = detail({ units: [unit({ change: "added", nodeId: "not-found", target: null })] });
    expect(buildPendingIndex(space.id, [addedTrunk], new Map(), true).complete).toBe(true);
  });

  it("keeps newest badges first, skips processed pulls and foreign Nodes", () => {
    const result = buildPendingIndex(space.id, [detail({ id: "older", updatedAt: at(1) }), detail({ id: "newer" }), detail({ state: "merged" }), detail({ units: [unit({ nodeId: "foreign" })] })], new Map([...ancestry, ["foreign", { spaceId: "elsewhere", ancestors: [], complete: true }]]), true);
    expect(result.byNode.get("file")?.map((item) => item.pull.id)).toEqual(["newer", "older"]);
    expect(result.byNode.has("foreign")).toBe(false);
  });

  it("caps details at twenty and ancestry at forty and marks truncation or inaccessible ancestry partial", () => {
    const details = Array.from({ length: 21 }, (_, i) => detail({ id: String(i) }));
    const plan = pendingDetailPlan(space, page(details));
    expect(plan.items).toHaveLength(20);
    expect(plan.complete).toBe(false);
    expect(buildPendingIndex(space.id, details, ancestry, true).complete).toBe(false);
    expect(buildPendingIndex(space.id, details, ancestry, true).byNode.get("file")).toHaveLength(20);
    expect(pendingDetailPlan(space, page([pull()], "more")).complete).toBe(false);
    expect(pendingDetailPlan(space, page([pull({ capabilities: { ...pull().capabilities, review: false } })]))).toEqual({ items: [], complete: false });
    const ancestors = pendingAncestryPlan(space.id, [detail({ units: Array.from({ length: 41 }, (_, i) => unit({ nodeId: String(i) })) })]);
    expect(ancestors.ids).toHaveLength(40);
    expect(ancestors.complete).toBe(false);
    expect(buildPendingIndex(space.id, [detail()], new Map(), true).complete).toBe(false);
    const fallback = buildPendingIndex(space.id, [detail({ units: [unit({ target: { spaceId: space.id, parentNodeId: "parent" } })] })], new Map(), true);
    expect(fallback.byNode.get("parent")?.[0]?.scope).toBe("inside");
    expect(fallback.complete).toBe(false);
  });
});

describe("Repository Home and issue facets", () => {
  it("ranks open work by total with stable name/ID ties and keeps all repository counts", () => {
    const beta = { ...space, id: "beta", name: "Beta" };
    const result = buildHomeWork(page([pull(), pull({ id: "beta-pull", teamSpace: beta, updatedAt: at(5) }), pull({ id: "merged", state: "merged" })]), page([issue({ space: beta })]), []);
    expect(result.ranking.map((row) => [row.space.id, row.total])).toEqual([["beta", 2], [space.id, 1]]);
    expect(result.ranking[0]?.segments).toEqual([{ key: "people", value: 0 }, { key: "agents", value: 0 }, { key: "unknown", value: 2 }]);
    expect(result.totals).toEqual({ pulls: 2, agentPulls: 0, issues: 1 });
    expect(result.openBySpace.get("beta")).toEqual({ pulls: 1, issues: 1 });
    expect(result.pulls.map((item) => item.pull.id)).toEqual(["pull", "beta-pull"]);
    const ties = buildHomeWork(page([pull({ teamSpace: beta }), pull()]), page([]), []);
    expect(ties.ranking.map((row) => row.space.id)).toEqual([space.id, "beta"]);
    const sameName = buildHomeWork(page([pull({ teamSpace: { ...space, id: "b" } }), pull({ teamSpace: { ...space, id: "a" } })]), page([]), []);
    expect(sameName.ranking.map((row) => row.space.id)).toEqual(["a", "b"]);
    expect(buildHomeWork(page([pull({ capabilities: { ...pull().capabilities, review: false } })]), page([]), []).pulls[0]?.canReview).toBe(false);
    expect(result.complete).toBe(true);
  });

  it("counts Agent drafts with unknown pulls in the denominator and segments all open work by kind", () => {
    const result = buildHomeWork(page([
      pull({ createdVia: "agent" }), pull({ id: "legacy", createdVia: "unknown" }),
      pull({ id: "human", createdVia: "browser" }), pull({ id: "merged", createdVia: "agent", state: "merged" }),
    ]), page([issue({ createdVia: "agent" }), issue({ id: "closed", state: "closed", createdVia: "browser" })]), []);
    expect(result.totals).toEqual({ pulls: 3, agentPulls: 1, issues: 1 });
    expect(result.ranking[0]?.segments).toEqual([{ key: "people", value: 1 }, { key: "agents", value: 2 }, { key: "unknown", value: 1 }]);
    expect(result.ranking[0]?.total).toBe(4);
    expect(result.pulls.map((item) => item.actor.kind)).toEqual(["agents", "unknown", "people"]);
    expect(result.issues[0]?.author.kind).toBe("agents");
    expect(buildHomeWork(page([pull({ createdVia: "browser" })]), page([issue({ createdVia: "agent" })]), []).totals).toEqual({ pulls: 1, agentPulls: 0, issues: 1 });
    expect(buildHomeWork(page([pull({ createdVia: "agent" })]), page([]), []).totals).toEqual({ pulls: 1, agentPulls: 1, issues: 0 });
    expect(buildPendingIndex(space.id, [detail({ createdVia: "agent" })], ancestry, true).byNode.get("file")?.[0]?.actor.kind).toBe("agents");
  });

  it("uses the newest known file update per repository even when the last-opened order differs", () => {
    const old = recent("Old");
    const newest = recent("Latest.univer.html", "blob");
    const other = recent("Other");
    const result = buildHomeWork(page([]), page([]), [
      { ...old, node: { ...old.node, updatedAt: at(2) } },
      { ...newest, node: { ...newest.node, updatedAt: at(6) } },
      { ...other, location: { ...other.location, space: { ...space, id: "beta" } }, node: { ...other.node, updatedAt: at(4) } },
    ]);
    expect([...result.updatedBySpace]).toEqual([[space.id, at(6)], ["beta", at(4)]]);
    expect(result.openBySpace.size).toBe(0);
    expect(result.updatedBySpace.has("unknown")).toBe(false);
  });

  it("handles zero and issue-only totals, partial lists, personal identity and bounded cards", () => {
    expect(buildHomeWork(page([]), page([]), []).totals).toEqual({ pulls: 0, agentPulls: 0, issues: 0 });
    expect(buildHomeWork(page([]), page([issue()]), []).totals).toEqual({ pulls: 0, agentPulls: 0, issues: 1 });
    const personal = { id: "personal", name: "Personal" };
    const userPulls = page([pull({ kind: "user", teamSpace: null })]);
    expect(buildHomeWork(userPulls, page([]), []).complete).toBe(false);
    const mapped = buildHomeWork(userPulls, page([]), [], personal);
    expect(mapped.pulls[0]?.pull.spaceId).toBe("personal");
    expect(mapped.openBySpace.get("personal")).toEqual({ pulls: 1, issues: 0 });
    expect(mapped.complete).toBe(true);
    const result = buildHomeWork(page(Array.from({ length: 6 }, (_, i) => pull({ teamSpace: { ...space, id: String(i) } })), "more"), page(Array.from({ length: 6 }, () => issue())), [recent("view.univer.html", "blob"), recent("a"), recent("b"), recent("c"), recent("d")]);
    expect(result.pulls).toHaveLength(4);
    expect(result.issues).toHaveLength(4);
    expect(result.ranking).toHaveLength(5);
    expect(result.openBySpace.size).toBe(7);
    expect(result.continueWorking.map((item) => item.node.name)).toEqual(["a", "b", "c"]);
    expect(result.complete).toBe(false);
    expect(buildHomeWork(page([]), page([], "more"), []).complete).toBe(false);
  });

  it("counts only open issues, by current user and label ID, with a local fourteen-day activity cutoff", () => {
    const label = { id: "label", name: "Bug", color: "red", description: "" };
    const items = [
      issue({ assignees: [user, user], labels: [label, label] }),
      issue({ author: { ...user, id: "someone" }, updatedAt: at(-10), labels: [{ ...label, id: "other", name: "Bug" }] }),
      issue({ id: "boundary", updatedAt: dayWindow(now).startIso }),
      issue({ id: "before", updatedAt: new Date(Date.parse(dayWindow(now).startIso) - 1).toISOString() }),
      issue({ state: "closed", labels: [label], assignees: [user] }),
    ];
    const result = buildIssueFacets(page(items), user.id, now);
    expect(result).toMatchObject({ open: 4, assignedToMe: 1, createdByMe: 3, recentlyActive: 2, exact: true });
    expect([...result.byLabel]).toEqual([["label", 1], ["other", 1]]);
    expect(buildIssueFacets(page(items, "more"), user.id, now).exact).toBe(false);
    expect(buildIssueFacets(page([]), user.id, now).open).toBe(0);
  });
});
