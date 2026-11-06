import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueLabelsQueryOptions, issueListQueryOptions, DEFAULT_ISSUE_FILTERS } from "../../../features/issues/issues.queries";
import { useIssueListModel } from "../../../features/issues/use-issue-list-model";
import { openIssueFacetsQueryOptions } from "../data/queries";
import { issue } from "../data/fixtures.test-support";
import { RepositoryIssueList } from "./repository-issue-list";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params = {}, search, children, ...props }: {
    to: string;
    params?: Record<string, string>;
    search?: unknown;
    children: ReactNode;
  }) => createElement("a", {
    ...props,
    href: to.replace(/\$(\w+)/g, (_, name: string) => params[name] ?? ""),
    "data-search": JSON.stringify(search),
  }, children),
}));
vi.mock("../../../shared/i18n", async (importOriginal) => {
  const { messages } = await importOriginal<typeof import("../../../shared/i18n")>();
  return {
    useI18n: () => ({
      language: "en-US",
      t: (key: keyof (typeof messages)["en-US"], values: Record<string, string | number> = {}) =>
        Object.entries(values).reduce<string>((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), messages["en-US"][key]),
    }),
  };
});

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.clear()));
const label = { id: "data", name: "Data", color: "orange", description: "", openIssueCount: 1 };
const item = issue({ labels: [label], assignees: [issue().author], commentCount: 4, referenceCount: 2 });

function renderList({ global = false, partial = false, canCreate = true, empty = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const spaceId = global ? undefined : "alpha";
  const items = empty ? [] : [item];
  client.setQueryData(issueListQueryOptions(spaceId, DEFAULT_ISSUE_FILTERS).queryKey, {
    pages: [{ items, counts: { open: 8, closed: 3 }, nextCursor: "next" }], pageParams: [undefined],
  });
  client.setQueryData(issueLabelsQueryOptions("alpha").queryKey, [label]);
  client.setQueryData(openIssueFacetsQueryOptions("alpha").queryKey, { items: [item], counts: { open: 1, closed: 0 }, nextCursor: partial ? "next" : null });
  const props: ComponentProps<typeof RepositoryIssueList> = { filters: DEFAULT_ISSUE_FILTERS, onFiltersChange: () => {}, canCreate, ...(spaceId ? { spaceId } : {}) };
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(RepositoryIssueList, props)));
}

describe("Repository issue list", () => {
  it("renders repository flows, four filters, state counts, row metadata and pagination", () => {
    const html = renderList();
    expect(html).toContain('href="/spaces/alpha/issues/new"');
    expect(html).toContain('href="/spaces/alpha/issues/2"');
    expect(html).toContain('href="/spaces/alpha/issues/labels"');
    expect(html.match(/class="rd-issue-select"/g)).toHaveLength(4);
    expect(html).toContain('class="rd-issue-count">8</span>');
    expect(html).toContain('class="rd-issue-count">3</span>');
    expect(html).toContain("Review plan");
    expect(html).toContain('data-color="orange"');
    expect(html).toContain('title="4 comments"');
    expect(html).toContain('title="2 linked files"');
    expect(html).toContain("Load more");
  });

  it("hides inexact facet counts while retaining list counts and navigation", () => {
    const exact = renderList().split('<section class="rd-issue-main"')[0] ?? "";
    const partial = renderList({ partial: true });
    const subnav = partial.split('<section class="rd-issue-main"')[0] ?? "";
    expect(exact).toContain('class="rd-issue-count"');
    expect(subnav).not.toContain('class="rd-issue-count"');
    expect(subnav).toContain("View counts are hidden");
    expect(subnav).toContain("Assigned to me");
    expect(partial).toContain('class="rd-issue-count">8</span>');
  });

  it("keeps the global list without repository navigation or creation and offers empty-state clearing", () => {
    const html = renderList({ global: true, empty: true });
    expect(html).not.toContain("rd-issue-subnav");
    expect(html).not.toContain("/issues/new");
    expect(html).toContain("Clear filters");
    expect(renderList({ canCreate: false })).not.toContain("/issues/new");
  });
});

describe("shared Issue list model", () => {
  it("submits trimmed URL search and retains the two existing clear-filter behaviors", () => {
    const client = new QueryClient();
    clients.push(client);
    const onFiltersChange = vi.fn();
    const filters = { ...DEFAULT_ISSUE_FILTERS, q: "  budget  ", assignee: "me", sort: "updated" as const };
    let model: ReturnType<typeof useIssueListModel> | undefined;
    function Inspect() {
      model = useIssueListModel({ filters, onFiltersChange });
      return null;
    }
    renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Inspect)));
    const event = { preventDefault: vi.fn() };
    model?.submitSearch(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, q: "budget" });
    model?.clearNarrowing();
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, q: undefined, assignee: undefined, author: undefined, labels: [] });
    model?.resetFilters();
    expect(onFiltersChange).toHaveBeenLastCalledWith(DEFAULT_ISSUE_FILTERS);
  });
});
