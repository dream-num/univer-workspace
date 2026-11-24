import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { IssueAcceptancePanel } from "./issue-acceptance-panel";

const details = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@tanstack/react-query", () => ({
  useQueries: ({ queries }: { queries: readonly unknown[] }) => queries.map(() => ({})),
  useQuery: (options: { queryKey: readonly unknown[] }) =>
    options.queryKey[0] === "worktree" ? { data: details.get(options.queryKey[1] as string) } : { isPending: true },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
}));
vi.mock("@univerjs/core", () => ({ LocaleType: {} }));
vi.mock("@univer/unit-comparison-viewer", () => ({ UnitComparisonViewer: () => null }));
vi.mock("../editor/comparison-univer", () => ({ createComparisonUniver: vi.fn() }));
vi.mock("../html-views/drafts/draft-queries", () => ({ worktreeHtmlViewDraftsQueryOptions: vi.fn() }));
vi.mock("../../shared/i18n", () => ({ useI18n: () => ({ language: "en-US", t: (key: string) => key }) }));
vi.mock("../../shared/theme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("../../shared/ui", () => {
  const Box = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return { Avatar: Box, Badge: Box, Button: Box, Spinner: Box, toast: {} };
});
vi.mock("../worktrees", () => ({
  PullRequestChecks: ({ worktreeId, explainNone }: { worktreeId: string; explainNone: boolean }) =>
    createElement("section", { "data-checks": worktreeId, "data-explain-none": explainNone }),
  UnitChangeIcon: () => null,
  UnitTypeIcon: () => null,
  worktreeQueryOptions: (id: string) => ({ queryKey: ["worktree", id] }),
  worktreeStateLabel: (state: string) => state,
  worktreeStateVariant: () => "default",
  worktreeUnitComparisonQueryOptions: vi.fn(),
}));
vi.mock("./issue-composer", () => ({ IssueComposer: () => null }));
vi.mock("./issue-markdown", () => ({ IssueMarkdown: () => null }));
vi.mock("./issues.commands", () => ({ useIssueVerdict: () => ({}) }));
vi.mock("./issues.queries", () => ({ issueAccessChangesQueryOptions: () => ({ queryKey: ["access-changes"] }) }));

type Issue = ComponentProps<typeof IssueAcceptancePanel>["issue"];
type Pull = Issue["pullRequests"][number];

it("shows checks after each pull request the reader may review, and none for a discarded one", () => {
  const author = { id: "agent", username: "agent", displayName: "Agent", avatarUrl: null };
  const pull = (id: string, state: Pull["state"], review: boolean): Pull => {
    details.set(id, { worktree: { units: [], capabilities: { review } } });
    return { id, number: 1, title: id, state, author, mergedBy: null };
  };
  const issue = {
    body: "",
    state: "open",
    acceptance: null,
    assignees: [],
    capabilities: { close: false },
    space: { id: "space" },
    number: 1,
    pullRequests: [pull("merged", "merged", true), pull("ready", "ready", true), pull("hidden", "ready", false), pull("discarded", "discarded", true)],
  } as unknown as Issue;
  const html = renderToStaticMarkup(createElement(IssueAcceptancePanel, { issue, timeline: [] }));
  const checks = [...html.matchAll(/data-checks="([^"]+)" data-explain-none="true"/gu)].map((match) => match[1]);
  expect(checks).toEqual(["merged", "ready"]);
  expect(html.indexOf('data-checks="merged"')).toBeGreaterThan(html.indexOf('data-acceptance-pull="merged"'));
  expect(html.indexOf('data-checks="merged"')).toBeLessThan(html.indexOf('data-acceptance-pull="ready"'));
});
