import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../shared/api/client";
import {
  worktreePagesQueryOptions,
  worktreeQueryOptions,
} from "../../features/worktrees/worktrees.queries";
import { htmlViewPagesQueryOptions } from "../../features/views/html-views.queries";
import {
  recentResourcePagesQueryOptions,
} from "../../features/views/recent.queries";
import {
  DEFAULT_ISSUE_FILTERS,
  issueListQueryOptions,
} from "../../features/issues/issues.queries";
import { parseWorktreeDashboardSearch } from "../../features/worktrees/worktree-review-search";
import { homeQueries } from "./data/queries";
import { repositoryWorktreeSearch } from "./repository-worktree-link";
import type { components } from "../../../../generated/http/schema.js";

vi.mock("../../shared/api/client", () => ({ api: { GET: vi.fn() } }));
afterEach(() => vi.resetAllMocks());

describe("repository data boundaries", () => {
  it("keeps Home to three bounded metadata requests after twenty full-list pages were cached", async () => {
    const client = new QueryClient();
    const warm = {
      pages: Array.from({ length: 20 }, () => ({
        items: [],
        nextCursor: "more",
        hasCreatedWorktree: true,
        counts: { open: 0, closed: 0 },
      })),
      pageParams: Array.from({ length: 20 }, (_, i) => String(i)),
    };
    client.setQueryData(worktreePagesQueryOptions().queryKey, warm);
    client.setQueryData(recentResourcePagesQueryOptions.queryKey, warm);
    client.setQueryData(
      issueListQueryOptions(undefined, { ...DEFAULT_ISSUE_FILTERS, sort: "updated" }).queryKey,
      warm,
    );
    vi.mocked(api.GET).mockResolvedValue({
      data: { items: [], nextCursor: null },
      response: new Response(),
    });
    await Promise.all([
      client.fetchQuery(homeQueries[1]),
      client.fetchQuery(homeQueries[0]),
      client.fetchQuery(homeQueries[2]),
    ]);
    expect(api.GET).toHaveBeenCalledTimes(3);
    expect(api.GET).toHaveBeenCalledWith("/api/worktrees", {
      signal: expect.any(AbortSignal),
      params: { query: { scope: "active", limit: 100, order: "updatedAtDesc" } },
    });
    expect(api.GET).toHaveBeenCalledWith("/api/recent-resources", {
      params: { query: { limit: 12 } },
    });
    expect(api.GET).toHaveBeenCalledWith("/api/issues", {
      signal: expect.any(AbortSignal),
      params: { query: { state: "open", sort: "updated", order: "desc", limit: 100 } },
    });
    client.clear();
  });

  it("resolves a direct Worktree outside the cached list and retains its return filters", async () => {
    const client = new QueryClient();
    client.setQueryData(worktreePagesQueryOptions().queryKey, {
      pages: [{ items: [], nextCursor: "next", hasCreatedWorktree: true }],
      pageParams: [undefined],
    });
    const task: components["schemas"]["WorktreeDetail"] = {
      createdVia: "unknown",
      id: "older",
      number: null,
      name: "Budget review",
      summary: null,
      kind: "team",
      state: "merged",
      visibility: "space",
      teamSpace: { id: "finance", name: "Finance", type: "team", publicRead: false },
      creator: { id: "author", username: "author", displayName: "Author", avatarUrl: null },
      unitCount: 0,
      units: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      processedAt: "2026-01-02T00:00:00Z",
      capabilities: {
        review: true,
        editDraft: false,
        addUnit: false,
        changeVisibility: false,
        markReady: false,
        reopen: false,
        merge: false,
        discard: false,
      },
    };
    vi.mocked(api.GET).mockResolvedValue({ data: { worktree: task }, response: new Response() });
    const result = await client.fetchQuery(worktreeQueryOptions("older"));
    const search = parseWorktreeDashboardSearch({
      worktree: "older",
      q: "budget",
      scope: "processed",
      kind: "team",
    });
    expect({ ...search, ...repositoryWorktreeSearch(result.worktree) }).toEqual({
      worktree: "older",
      spaceId: "finance",
      q: "budget",
      scope: "processed",
      kind: "team",
    });
    expect(api.GET).toHaveBeenCalledTimes(1);
    expect(api.GET).toHaveBeenCalledWith("/api/worktrees/{worktreeId}", {
      params: { path: { worktreeId: "older" } },
    });
    client.clear();
  });
  it("keeps Worktree filters on subsequent cursors and never loads task details", async () => {
    vi.mocked(api.GET).mockResolvedValueOnce({
      data: { items: [], nextCursor: "page-2", hasCreatedWorktree: true },
      response: new Response(),
    });
    vi.mocked(api.GET).mockResolvedValueOnce({
      data: { items: [], nextCursor: null, hasCreatedWorktree: true },
      response: new Response(),
    });
    const client = new QueryClient();
    const filters = {
      scope: "processed" as const,
      kind: "team" as const,
      teamSpaceId: "finance",
      q: "budget",
    };
    const result = await client.fetchInfiniteQuery({
      ...worktreePagesQueryOptions(filters),
      pages: 2,
    });
    expect(result.pages).toHaveLength(2);
    expect(api.GET).toHaveBeenLastCalledWith("/api/worktrees", {
      params: {
        query: {
          scope: "processed",
          kind: "team",
          teamSpaceId: "finance",
          search: "budget",
          limit: 20,
          order: "updatedAtDesc",
          cursor: "page-2",
        },
      },
    });
    expect(worktreePagesQueryOptions({ ...filters, q: "another" }).queryKey).not.toEqual(
      worktreePagesQueryOptions(filters).queryKey,
    );
    client.clear();
  });

  it("loads only one metadata page until the user requests more", async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: { items: [], nextCursor: "more" },
      response: new Response(),
    });
    const client = new QueryClient();
    await client.fetchInfiniteQuery(htmlViewPagesQueryOptions("crm"));
    await client.fetchInfiniteQuery(recentResourcePagesQueryOptions);
    expect(api.GET).toHaveBeenCalledTimes(2);
    expect(api.GET).toHaveBeenNthCalledWith(1, "/api/html-views", {
      params: { query: { limit: 20, spaceId: "crm" } },
    });
    expect(api.GET).toHaveBeenNthCalledWith(2, "/api/recent-resources", {
      params: { query: { limit: 20 } },
    });
    client.clear();
  });

  it("does not turn summary-only access into a review link", () => {
    const task = {
      id: "task",
      kind: "team",
      teamSpace: { id: "finance" },
      capabilities: { review: false },
    } as components["schemas"]["WorktreeSummary"];
    expect(repositoryWorktreeSearch(task, "personal")).toBeUndefined();
    expect(
      repositoryWorktreeSearch(
        { ...task, capabilities: { ...task.capabilities, review: true } },
        "personal",
      ),
    ).toEqual({ worktree: "task", spaceId: "finance" });
    expect(
      repositoryWorktreeSearch(
        {
          ...task,
          kind: "user",
          teamSpace: null,
          capabilities: { ...task.capabilities, review: true },
        },
        "personal",
      ),
    ).toEqual({ worktree: "task", spaceId: "personal" });
  });

  it("validates global list filters without dropping existing deep-link context", () => {
    expect(
      parseWorktreeDashboardSearch({
        worktree: "task",
        spaceId: "finance",
        scope: "processed",
        kind: "team",
        teamSpaceId: "finance",
        q: "budget",
      }),
    ).toEqual({
      worktree: "task",
      spaceId: "finance",
      scope: "processed",
      kind: "team",
      teamSpaceId: "finance",
      q: "budget",
    });
    expect(
      parseWorktreeDashboardSearch({ scope: "secret", kind: "admin", q: {}, teamSpaceId: 1 }),
    ).toEqual({});
  });
});
