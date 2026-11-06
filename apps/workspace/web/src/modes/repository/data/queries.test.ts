import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../shared/api/client";
import { worktreePagesQueryOptions, worktreeQueryOptions } from "../../../features/worktrees/worktrees.queries";
import { DEFAULT_ISSUE_FILTERS, issueListQueryOptions } from "../../../features/issues/issues.queries";
import { recentResourcePagesQueryOptions } from "../../../features/views/recent.queries";
import { buildHomeWork } from "./home-work";
import { pendingAncestryPlan, pendingDetailPlan } from "./pending";
import {
  ancestryQueryOptions, homeIssuesQueryOptions, homeQueries, homeWorktreesQueryOptions,
  repositoryActivityQueryOptions, openIssueFacetsQueryOptions, openWorktreesQueryOptions,
} from "./queries";
import { detail, pull, space, unit } from "./fixtures.test-support";

vi.mock("../../../shared/api/client", () => ({ api: { GET: vi.fn() } }));
const clients: QueryClient[] = [];
function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(value);
  return value;
}
afterEach(() => {
  for (const value of clients.splice(0)) value.clear();
  vi.resetAllMocks();
});
const ok = (data: unknown) => ({ data, response: new Response() });

describe("Repository derived-data request boundaries", () => {
  it("keeps Home at three bounded list requests despite twenty cached infinite-list pages", async () => {
    const queryClient = client();
    const warm = {
      pages: Array.from({ length: 20 }, () => ({ items: [], nextCursor: "more", hasCreatedWorktree: true, counts: { open: 0, closed: 0 } })),
      pageParams: Array.from({ length: 20 }, (_, i) => String(i)),
    };
    queryClient.setQueryData(worktreePagesQueryOptions().queryKey, warm);
    queryClient.setQueryData(recentResourcePagesQueryOptions.queryKey, warm);
    queryClient.setQueryData(issueListQueryOptions(undefined, { ...DEFAULT_ISSUE_FILTERS, sort: "updated" }).queryKey, warm);
    vi.mocked(api.GET).mockResolvedValue(ok({ items: [], nextCursor: "more" }));
    const [recent, pulls, issues] = await Promise.all([
      queryClient.fetchQuery(homeQueries[0]), queryClient.fetchQuery(homeQueries[1]), queryClient.fetchQuery(homeQueries[2]),
    ]);
    expect(buildHomeWork(pulls, issues, recent.items).complete).toBe(false);
    expect(api.GET).toHaveBeenCalledTimes(3);
    expect(api.GET).toHaveBeenCalledWith("/api/recent-resources", { params: { query: { limit: 12 } } });
    expect(api.GET).toHaveBeenCalledWith("/api/worktrees", { signal: expect.any(AbortSignal), params: { query: { scope: "active", limit: 100, order: "updatedAtDesc" } } });
    expect(api.GET).toHaveBeenCalledWith("/api/issues", { signal: expect.any(AbortSignal), params: { query: { state: "open", sort: "updated", order: "desc", limit: 100 } } });
  });

  it.each([space.id, "personal"])("loads %s activity with a zone-specific cache key and one request", async (spaceId) => {
    vi.mocked(api.GET).mockResolvedValueOnce(ok({ timeZone: "Asia/Shanghai", days: [{ day: "2026-11-06", opened: { browser: 1, agent: 2, unknown: 0 }, merged: 3 }], events: [], complete: true }));
    const options = repositoryActivityQueryOptions(spaceId, "Asia/Shanghai");
    expect(options.queryKey).toEqual(["activity", spaceId, "Asia/Shanghai"]);
    expect(options.queryKey).not.toEqual(repositoryActivityQueryOptions(spaceId, "UTC").queryKey);
    const result = await client().fetchQuery(options);
    expect(api.GET).toHaveBeenCalledTimes(1);
    expect(api.GET).toHaveBeenCalledWith("/api/spaces/{spaceId}/activity", {
      signal: expect.any(AbortSignal), params: { path: { spaceId }, query: { timeZone: "Asia/Shanghai" } },
    });
    expect(result.series.days[0]).toEqual({ day: "2026-11-06", segments: [{ key: "people", value: 1 }, { key: "agents", value: 2 }], total: 3, merged: 3 });
  });

  it("requests at most twenty reviewable details and forty unique ancestry contexts", async () => {
    const queryClient = client();
    vi.mocked(api.GET).mockResolvedValueOnce(ok({ items: Array.from({ length: 21 }, (_, i) => pull({ id: String(i) })), nextCursor: null }));
    const list = await queryClient.fetchQuery(openWorktreesQueryOptions(space));
    const plan = pendingDetailPlan(space, list);
    expect(plan.complete).toBe(false);
    vi.mocked(api.GET).mockResolvedValue(ok({ worktree: detail({ units: Array.from({ length: 41 }, (_, i) => unit({ nodeId: `node-${i}` })) }) }));
    const details = await Promise.all(plan.items.map((item) => queryClient.fetchQuery(worktreeQueryOptions(item.id))));
    expect(api.GET).toHaveBeenCalledTimes(21);
    const ancestry = pendingAncestryPlan(space.id, details.map((item) => item.worktree));
    expect(ancestry.complete).toBe(false);
    vi.mocked(api.GET).mockResolvedValue(ok({ node: { id: "unused" }, space, breadcrumbs: [{ id: "outer" }, { id: "inner" }], navigationRootNodeId: null }));
    await Promise.all(ancestry.ids.map((id) => queryClient.fetchQuery(ancestryQueryOptions(id))));
    expect(api.GET).toHaveBeenCalledTimes(61);
    expect(api.GET).toHaveBeenNthCalledWith(1, "/api/worktrees", {
      signal: expect.any(AbortSignal), params: { query: { teamSpaceId: space.id, scope: "active", state: ["draft", "ready", "merging"], order: "updatedAtDesc", limit: 100 } },
    });
  });

  it("reads node breadcrumbs, excludes self, and retains missing or restricted ancestry as partial", async () => {
    const queryClient = client();
    vi.mocked(api.GET).mockResolvedValueOnce(ok({ space, breadcrumbs: [{ id: "outer" }, { id: "file" }], navigationRootNodeId: "outer" }));
    expect(await queryClient.fetchQuery(ancestryQueryOptions("file"))).toEqual({ nodeId: "file", ancestry: { spaceId: space.id, ancestors: ["outer"], complete: false } });
    vi.mocked(api.GET).mockResolvedValueOnce({ error: { error: { code: "NOT_FOUND", message: "Unavailable" } }, response: new Response(null, { status: 404 }) });
    expect(await queryClient.fetchQuery(ancestryQueryOptions("deleted"))).toEqual({ nodeId: "deleted", ancestry: null });
  });

  it("keeps facet fetches bounded, errors visible and all new query keys under feed roots", async () => {
    const options = [repositoryActivityQueryOptions(space.id, "UTC"), openWorktreesQueryOptions(space), ancestryQueryOptions("file"), openIssueFacetsQueryOptions(space.id), homeWorktreesQueryOptions, homeIssuesQueryOptions];
    expect(options.every((option) => option.queryKey[0] === "worktrees" || option.queryKey[0] === "issues" || option.queryKey[0] === "activity")).toBe(true);
    vi.mocked(api.GET).mockResolvedValueOnce(ok({ items: [], nextCursor: "more", counts: { open: 201, closed: 0 } }));
    const result = await client().fetchQuery(openIssueFacetsQueryOptions(space.id));
    expect(result.nextCursor).toBe("more");
    expect(api.GET).toHaveBeenCalledWith("/api/spaces/{spaceId}/issues", {
      signal: expect.any(AbortSignal), params: { path: { spaceId: space.id }, query: { state: "open", sort: "updated", order: "desc", limit: 200 } },
    });
    vi.mocked(api.GET).mockResolvedValueOnce({ error: { error: { code: "FORBIDDEN", message: "Denied" } }, response: new Response(null, { status: 403 }) });
    await expect(client().fetchQuery(repositoryActivityQueryOptions(space.id, "UTC"))).rejects.toThrow("Denied");
  });
});
