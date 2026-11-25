import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { IssueAcceptancePanel } from "./issue-acceptance-panel";

const details = vi.hoisted(() => new Map<string, unknown>());
const accessChanges = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("@tanstack/react-query", () => ({
  useQueries: ({ queries }: { queries: readonly unknown[] }) => queries.map(() => ({})),
  useQuery: (options: { queryKey: readonly unknown[] }) =>
    options.queryKey[0] === "worktree" ? { data: details.get(options.queryKey[1] as string) }
      : options.queryKey[0] === "access-changes" && accessChanges.data ? { data: accessChanges.data }
        : { isPending: true },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: ReactNode; params?: { nodeId?: string } }) =>
    createElement("a", { "data-node": params?.nodeId }, children),
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
  RevertSection: ({ target }: { target: { spaceId: string; number: number } }) =>
    createElement("section", { "data-revert": `${target.spaceId}#${String(target.number)}` }),
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

it("offers the revert to whoever may accept the Issue, once a linked pull request is merged", () => {
  const author = { id: "agent", username: "agent", displayName: "Agent", avatarUrl: null };
  const render = (close: boolean, state: Pull["state"]) => {
    details.set("pull", { worktree: { units: [], capabilities: { review: true } } });
    const issue = {
      body: "", state: "closed", acceptance: null, assignees: [], capabilities: { close }, space: { id: "space" }, number: 4,
      pullRequests: [{ id: "pull", number: 2, title: "Fix", state, author, mergedBy: null }],
    } as unknown as Issue;
    return renderToStaticMarkup(createElement(IssueAcceptancePanel, { issue, timeline: [] }));
  };
  expect(render(true, "merged")).toContain('data-revert="space#4"');
  expect(render(false, "merged")).not.toContain("data-revert");
  expect(render(true, "ready")).not.toContain("data-revert");
});

it("names a file now in Trash or deleted beside the files it can still compare, and offers no comparison for it", () => {
  const author = { id: "agent", username: "agent", displayName: "Agent", avatarUrl: null };
  const file = (name: string, fileState: string) => ({ unitId: name, name, change: "added", source: "worktree", unitType: "sheet", fileState });
  details.set("pull", { worktree: {
    units: [file("Totals", "live"), file("Added", "inTrash"), file("Gone", "deleted")],
    capabilities: { review: true },
  } });
  const issue = {
    body: "", state: "open", acceptance: null, assignees: [], capabilities: { close: false }, space: { id: "space" }, number: 4,
    pullRequests: [{ id: "pull", number: 2, title: "Fix", state: "merged", author, mergedBy: null }],
  } as unknown as Issue;
  const html = renderToStaticMarkup(createElement(IssueAcceptancePanel, { issue, timeline: [] }));
  expect(html).not.toContain("issueAcceptanceFilesHidden");
  expect([...html.matchAll(/<li.*?<\/li>/gsu)].map(([row]) => [
    /truncate">([^<]+)/u.exec(row)?.[1], row.includes("issueAcceptanceCompare"), /issueAcceptance(InTrash|Deleted)/u.exec(row)?.[1] ?? null,
  ])).toEqual([["Totals", true, null], ["Added", false, "InTrash"], ["Gone", false, "Deleted"]]);
});

it("links the files the reader may open and names the others, with a count, in the Personal Space sharing part", () => {
  const actor = { id: "agent", username: "agent", displayName: "Agent", avatarUrl: null };
  const issue = {
    body: "", state: "open", acceptance: null, assignees: [], capabilities: { close: true }, space: { id: "space" }, number: 4, pullRequests: [],
  } as unknown as Issue;
  const render = (items: readonly unknown[]) => {
    accessChanges.data = { publicRead: false, members: [], membersTruncated: false, personalSharing: { items, truncated: false } };
    return renderToStaticMarkup(createElement(IssueAcceptancePanel, { issue, timeline: [] }));
  };
  const link = { kind: "link", actor, role: "viewer", enabled: true, updatedAt: "2026-11-25T00:00:00.000Z" };
  const summary = render([{ ...link, node: { name: "Totals" } }]);
  expect(summary).toContain("Totals");
  expect(summary).not.toContain("data-node");
  expect(summary).toContain("issueAcceptancePersonalSummary");
  const full = render([{ ...link, node: { id: "node-1", name: "Totals" } }]);
  expect(full).toContain('data-node="node-1"');
  expect(full).not.toContain("issueAcceptancePersonalSummary");
  accessChanges.data = undefined;
});
