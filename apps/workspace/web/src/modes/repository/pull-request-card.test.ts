import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mySpacesQueryOptions } from "../../features/spaces";
import { LanguageProvider } from "../../shared/i18n";
import { pull, space } from "./data/fixtures.test-support";
import { repositoryMessages } from "./messages";
import { RepositoryWorktreeRows } from "./repository-summary-rows";

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

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

function renderRows(item = pull(), spaceId?: string) {
  vi.stubGlobal("window", { localStorage: { getItem: () => "en-US" } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  client.setQueryData(mySpacesQueryOptions.queryKey, { spaces: [] });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(LanguageProvider, { overrides: repositoryMessages },
      createElement(RepositoryWorktreeRows, {
        items: [item],
        filters: { q: "plan", scope: "processed" },
        ...(spaceId ? { spaceId } : {}),
      }),
    ),
  ));
}

describe("shared Repository Pull request cards", () => {
  it("opens numbered reviews from global and repository lists with the same state and file count", () => {
    const item = pull({ unitCount: 1 });
    for (const html of [renderRows(item), renderRows(item, space.id)]) {
      expect(html).toContain('href="/spaces/alpha/pulls/1"');
      expect(html).toContain('data-pr-state="ready"');
      expect(html).toContain("1 file");
      expect(html).toContain("Me&#x27;s Pull request contains 1 file in Alpha.");
    }
  });

  it("preserves legacy review filters and keeps summary-only work without a review link", () => {
    const legacy = renderRows(pull({ number: null }));
    expect(legacy).toContain('href="/worktrees"');
    expect(legacy).toContain('&quot;q&quot;:&quot;plan&quot;');
    expect(legacy).toContain('&quot;scope&quot;:&quot;processed&quot;');
    const item = pull();
    const summary = renderRows({ ...item, capabilities: { ...item.capabilities, review: false } });
    expect(summary).not.toContain("href=");
    expect(summary).toContain("Summary access only");
    expect(summary).toContain("7 files");
  });
});
