import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../../shared/i18n";
import { spaceQueryOptions } from "../../spaces/spaces.queries";
import { session } from "../test-helpers";
import { agentSessionIdSchema } from "../agent.types";
import { AgentSessionsTable, HomeAgents } from "./sessions";

vi.mock("./client", () => ({ useAgentClient: () => ({ userId: "user-a", providers: { list: async () => [] } }) }));
vi.mock("./composer", () => ({ AgentComposer: () => null }));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ hash: "" }),
  Link: ({ to, params = {}, search, children, ...props }: { to: string; params?: Record<string, string>; search?: unknown; children: ReactNode }) => createElement("a", {
    ...props, href: to.replace(/\$(\w+)/g, (_, key: string) => params[key] ?? ""), "data-search": JSON.stringify(search),
  }, children),
}));

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); });
const items = Array.from({ length: 4 }, (_, index) => session({
  id: agentSessionIdSchema.parse(`session-${index}`),
  createdAt: `2026-11-${10 + index}T00:00:00.000Z`,
  scope: index === 3 ? { kind: "repository", spaceId: "repo", baseWorktreeId: null } : { kind: "global" },
  messages: [{ id: `message-${index}`, role: "user", parts: [{ type: "text", text: `Session ${index}` }] }],
}));
function render(content: ReactNode) {
  vi.stubGlobal("window", { localStorage: { getItem: () => "en-US" } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  client.setQueryData(["agent-sessions", "user-a"], items);
  client.setQueryData(spaceQueryOptions("repo").queryKey, {
    id: "repo", type: "team", name: "Finance", publicRead: false, slug: "finance", fullName: "user/finance", description: "",
    owner: { id: "user-a", username: "user" }, affiliation: "owner", accessRole: "owner",
    capabilities: { browseRoot: true, createAtRoot: true, renameSpace: true, manageMembers: true, viewTrash: true, createIssue: true, triageIssues: true, manageIssueLabels: true },
  });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(LanguageProvider, null, content)));
}
it("shows only the newest three Home sessions with scope, time, status and an all-sessions destination", () => {
  const html = render(createElement(HomeAgents));
  expect(html).not.toContain("Session 0");
  expect(html.indexOf("Session 3")).toBeLessThan(html.indexOf("Session 2"));
  expect(html).toContain("Session 1");
  expect(html).toContain("Finance");
  expect(html).toContain("All repositories");
  expect(html).toContain('<time dateTime="2026-11-11T00:00:00.000Z">');
  expect(html).toContain('data-status="idle"');
  expect(html).toContain('href="/recent" data-search="{&quot;tab&quot;:&quot;sessions&quot;}"');
});
it("shares session rows and adds the Repository column only for the cross-repository table", () => {
  const scoped = render(createElement(AgentSessionsTable, { items }));
  const all = render(createElement(AgentSessionsTable, { items, crossRepository: true }));
  expect(scoped).not.toContain('<th scope="col">Repository</th>');
  expect(all).toContain('<th scope="col">Repository</th>');
  expect(all).toContain("Finance");
  for (const html of [scoped, all]) {
    expect(html).toContain('href="/agents/session-3"');
    expect(html).toContain("Session 0");
    expect(html).toContain("Done");
  }
});
