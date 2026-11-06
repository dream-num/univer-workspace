import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../shared/api/client";
import { worktreePagesQueryOptions, worktreeQueryOptions } from "../../../features/worktrees/worktrees.queries";
import { DEFAULT_ISSUE_FILTERS, issueListQueryOptions } from "../../../features/issues/issues.queries";
import { recentResourcePagesQueryOptions } from "../../../features/views/recent.queries";
import { dayWindow } from "./days";
import { buildHomeWork } from "./home-work";
import { pendingAncestryPlan, pendingDetailPlan } from "./pending";
import {
  ancestryQueryOptions, homeIssuesQueryOptions, homeQueries, homeWorktreesQueryOptions,
  issueWindowQueryOptions, openIssueFacetsQueryOptions, openWorktreesQueryOptions, worktreeWindowQueryOptions,
} from "./queries";
import { at, detail, issue, now, pull, space, unit } from "./fixtures.test-support";

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
const start = dayWindow(now).startIso;

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

  it("pages a space-scoped worktree window until the tail passes local midnight", async () => {
    vi.mocked(api.GET)
      .mockResolvedValueOnce(ok({ items: [pull()], nextCursor: "next" }))
      .mockResolvedValueOnce(ok({ items: [pull({ id: "boundary", updatedAt: start })], nextCursor: "boundary" }))
      .mockResolvedValueOnce(ok({ items: [pull({ id: "old", updatedAt: new Date(Date.parse(start) - 1).toISOString() })], nextCursor: "older" }));
    const result = await client().fetchQuery(worktreeWindowQueryOptions(space, start));
    expect(result.items).toHaveLength(3);
    expect(result.complete).toBe(true);
    expect(api.GET).toHaveBeenCalledTimes(3);
    expect(api.GET).toHaveBeenNthCalledWith(2, "/api/worktrees", {
      signal: expect.any(AbortSignal),
      params: { query: { teamSpaceId: space.id, scope: "all", order: "updatedAtDesc", limit: 100, cursor: "next" } },
    });
  });

  it("caps both activity scans at five pages and uses state=all, updated order and limit 200 for issues", async () => {
    vi.mocked(api.GET).mockResolvedValue(ok({ items: [issue()], nextCursor: "more" }));
    const result = await client().fetchQuery(issueWindowQueryOptions(space, start));
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(5);
    expect(api.GET).toHaveBeenCalledTimes(5);
    expect(api.GET).toHaveBeenLastCalledWith("/api/spaces/{spaceId}/issues", {
      signal: expect.any(AbortSignal),
      params: { path: { spaceId: space.id }, query: { state: "all", sort: "updated", order: "desc", limit: 200, cursor: "more" } },
    });
    vi.mocked(api.GET).mockClear().mockResolvedValue(ok({ items: [pull()], nextCursor: "more" }));
    expect((await client().fetchQuery(worktreeWindowQueryOptions(space, start))).complete).toBe(false);
    expect(api.GET).toHaveBeenCalledTimes(5);
  });

  it("stops on exhausted issues and skips the team-only issues endpoint for Personal Spaces", async () => {
    vi.mocked(api.GET).mockResolvedValue(ok({ items: [], nextCursor: null }));
    expect(await client().fetchQuery(issueWindowQueryOptions(space, start))).toEqual({ items: [], complete: true });
    const personal = { id: "personal", type: "personal" } as const;
    expect(await client().fetchQuery(issueWindowQueryOptions(personal, start))).toEqual({ items: [], complete: true });
    expect(api.GET).toHaveBeenCalledTimes(1);
    await client().fetchQuery(worktreeWindowQueryOptions(personal, start));
    expect(api.GET).toHaveBeenLastCalledWith("/api/worktrees", {
      signal: expect.any(AbortSignal), params: { query: { kind: "user", scope: "all", order: "updatedAtDesc", limit: 100 } },
    });
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
    const options = [worktreeWindowQueryOptions(space, start), issueWindowQueryOptions(space, start), openWorktreesQueryOptions(space), ancestryQueryOptions("file"), openIssueFacetsQueryOptions(space.id), homeWorktreesQueryOptions, homeIssuesQueryOptions];
    expect(options.every((option) => option.queryKey[0] === "worktrees" || option.queryKey[0] === "issues")).toBe(true);
    vi.mocked(api.GET).mockResolvedValueOnce(ok({ items: [], nextCursor: "more", counts: { open: 201, closed: 0 } }));
    const result = await client().fetchQuery(openIssueFacetsQueryOptions(space.id));
    expect(result.nextCursor).toBe("more");
    expect(api.GET).toHaveBeenCalledWith("/api/spaces/{spaceId}/issues", {
      signal: expect.any(AbortSignal), params: { path: { spaceId: space.id }, query: { state: "open", sort: "updated", order: "desc", limit: 200 } },
    });
    vi.mocked(api.GET).mockResolvedValueOnce({ error: { error: { code: "FORBIDDEN", message: "Denied" } }, response: new Response(null, { status: 403 }) });
    await expect(client().fetchQuery(worktreeWindowQueryOptions(space, at(1)))).rejects.toThrow("Denied");
  });
});
