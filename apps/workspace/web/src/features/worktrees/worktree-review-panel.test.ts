import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PullRequestChecks, WorktreeReviewPanel } from "./worktree-review-panel";

const state = vi.hoisted(() => ({
  pending: false,
  clicks: new Map<string, () => void>(),
  post: vi.fn(),
  invalidate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  me: "user-2" as string | null,
  pages: undefined as unknown,
  checks: undefined as unknown,
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: <T,>(options: T) => options,
  useQueries: () => [],
  useQuery: (options: { queryKey?: readonly unknown[] }) =>
    options.queryKey?.[0] === "session" && state.me
      ? { data: { authenticated: true, user: { id: state.me } } }
      : options.queryKey?.[1] === "worktree" ? { data: state.pages }
      : options.queryKey?.[1] === "checks" ? { data: state.checks } : {},
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useMutation: (config: {
    mutationFn: (value: unknown) => Promise<unknown>;
    onSuccess: (result: unknown) => Promise<unknown>;
  }) => ({
    isPending: state.pending,
    mutate: (value: unknown, callbacks: {
      onSuccess: (result: unknown) => void;
      onError: (error: unknown) => void;
    }) => {
      void config.mutationFn(value).then(async (result) => {
        await config.onSuccess(result);
        callbacks.onSuccess(result);
      }).catch(callbacks.onError);
    },
  }),
}));
vi.mock("../../shared/api/client", () => ({ api: { POST: state.post } }));
vi.mock("../auth", () => ({ sessionQueryOptions: { queryKey: ["session"] } }));
vi.mock("../../shared/i18n", () => ({
  useI18n: () => ({
    language: "en-US",
    t: (key: string, values?: Record<string, string>) => (values ? `${key}(${Object.values(values).join(", ")})` : key),
  }),
}));
vi.mock("../../shared/theme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@univerjs/core", () => ({ LocaleType: { EN_US: "en-US", ZH_CN: "zh-CN" } }));
vi.mock("@univer/unit-comparison-viewer", () => ({ UnitComparisonViewer: () => null }));
vi.mock("../editor/comparison-univer", () => ({ createComparisonUniver: vi.fn() }));
vi.mock("./worktrees.queries", () => ({
  worktreesQueryKey: ["worktrees"],
  worktreeChecksQueryOptions: (id: string) => ({ queryKey: ["worktrees", "checks", id] }),
  worktreeUnitComparisonQueryOptions: vi.fn(),
  worktreeUnitMergeReviewQueryOptions: vi.fn(),
}));
vi.mock("./worktree-review-header", () => ({
  WorktreeReviewHeader: ({ actions }: { actions: ReactNode }) => createElement("header", null, actions),
}));
vi.mock("../../shared/ui", () => {
  const Box = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return {
    Alert: Box, Badge: Box, Segmented: Box, Spinner: Box, Tooltip: Box,
    Empty: ({ title }: { title: ReactNode }) => createElement("div", null, title),
    ConfirmDialog: ({ trigger, description, confirmText, onConfirm }: { trigger: ReactNode; description: ReactNode; confirmText: string; onConfirm: () => void }) => {
      state.clicks.set(confirmText, onConfirm);
      return createElement("div", null, trigger, description);
    },
    Button: ({ children, disabled, onClick }: {
      children: ReactNode;
      disabled: boolean;
      onClick: () => void;
    }) => {
      const label = renderToStaticMarkup(createElement("span", null, children)).replace(/<[^>]*>/g, "");
      if (!disabled && onClick) state.clicks.set(label, onClick);
      return createElement("button", { disabled }, children);
    },
    toast: { success: state.success, error: state.error, info: state.info },
  };
});

type Worktree = ComponentProps<typeof WorktreeReviewPanel>["worktree"];

function worktree(reopen: boolean): Worktree {
  return {
    id: "worktree-1",
    number: 1,
    name: "Worktree",
    summary: null,
    kind: "user",
    teamSpace: null,
    visibility: "private",
    state: "ready",
    createdVia: "agent",
    creator: { id: "user-1", username: "alice", displayName: "Alice", avatarUrl: null },
    claimer: null,
    unitCount: 0,
    processedAt: null,
    createdAt: "2026-11-15T00:00:00Z",
    issue: null,
    updatedAt: "2026-11-15T00:00:00Z",
    units: [],
    capabilities: {
      review: true,
      editDraft: false,
      addUnit: false,
      changeVisibility: false,
      reopen,
      markReady: false,
      merge: false,
      discard: false,
    },
  };
}

beforeEach(() => {
  state.pending = false;
  state.me = "user-2";
  state.pages = undefined;
  state.checks = undefined;
  state.clicks.clear();
  vi.clearAllMocks();
  state.post.mockResolvedValue({ data: { worktree: { state: "draft" } } });
  state.invalidate.mockResolvedValue(undefined);
});

describe("Worktree merge", () => {
  it("tells a Team member who cannot merge a ready pull request that only its author can", () => {
    const team = (merge: boolean): Worktree => ({
      ...worktree(false),
      kind: "team",
      capabilities: { ...worktree(false).capabilities, merge },
    });
    const line = (value: Worktree) =>
      renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value })).includes("onlyAuthorMerges");
    expect(line(team(false))).toBe(true);
    expect(line(team(true))).toBe(false);
    expect(line(worktree(false))).toBe(false);
    state.me = "user-1";
    expect(line(team(false)), "an author who lost edit access is not told to ask themself").toBe(false);
    state.me = null;
    expect(line(team(false)), "nothing until the session is known").toBe(false);
  });

  it("tells a member who cannot merge a pull request shared with the Team Space that merging needs edit access", () => {
    const shared: Worktree = { ...worktree(false), kind: "team", visibility: "space" };
    const html = (value: Worktree) => renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }));
    expect(html(shared)).toContain("mergeNeedsEditAccess");
    expect(html(shared)).not.toContain("onlyAuthorMerges");
    expect(html({ ...shared, capabilities: { ...shared.capabilities, merge: true } })).not.toContain("mergeNeedsEditAccess");
  });

  it("tells the author of a ready proposal they cannot merge that a member with edit access merges it", () => {
    const shared: Worktree = { ...worktree(false), kind: "team", visibility: "space" };
    const html = (value: Worktree) => renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }));
    state.me = "user-1";
    expect(html(shared)).toContain("memberWithEditAccessMerges");
    expect(html(shared)).not.toContain("mergeNeedsEditAccess");
    expect(html({ ...shared, capabilities: { ...shared.capabilities, merge: true } })).not.toContain("memberWithEditAccessMerges");
    expect(html({ ...shared, state: "draft" })).not.toContain("memberWithEditAccessMerges");
    expect(html({ ...shared, visibility: "private" }), "nobody else sees a private one").not.toContain("memberWithEditAccessMerges");
    state.me = "user-2";
    expect(html(shared)).not.toContain("memberWithEditAccessMerges");
  });

  it("notes a file in Trash instead of comparing it, and says its author leaves it out so the rest can merge", () => {
    const unit = (unitId: string, name: string, fileState: "live" | "inTrash") => ({
      unitId, resourceId: `resource-${unitId}`, nodeId: `node-${unitId}`, name, unitType: "sheet", source: "trunk", target: null,
      draftHeadRevision: 2, change: "modified", mergeResult: "pending", activationState: "notApplicable", freshness: null, fileState,
    }) as Worktree["units"][number];
    const open: Worktree = {
      ...worktree(false), kind: "team", visibility: "space", units: [unit("north", "North", "live"), unit("summary", "Summary", "inTrash")],
    };
    const html = (value: Worktree, selectedUnitId: string) =>
      renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value, selectedUnitId }));
    expect(html(open, "summary")).toContain("issueAcceptanceInTrash");
    expect(html(open, "north")).not.toContain("issueAcceptanceInTrash");
    expect(html(open, "north")).toContain("filesInTrashBlockMerge");
    expect(html(open, "north")).not.toContain("mergeNeedsEditAccess");
    state.me = "user-1";
    const draft: Worktree = { ...open, state: "draft", capabilities: { ...open.capabilities, editDraft: true } };
    expect(html(draft, "summary")).toContain("leaveOutOfPullRequest");
    expect(html(draft, "north")).toContain("markUnitRemoved");
  });

  it("names the person who claimed an agent author beside the agent, except to that person", () => {
    const html = (value: Worktree) => renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }));
    const person = { ...worktree(false), kind: "team" as const };
    const agent: Worktree = {
      ...person,
      creator: { id: "agent-1", username: "ada-x1y2", displayName: "Ada", avatarUrl: null },
      claimer: { id: "user-3", username: "clara", displayName: "Clara", avatarUrl: null },
    };
    expect(html(person)).toContain("onlyAuthorMerges(Alice)");
    expect(html(agent)).toContain("onlyAuthorOrClaimerMerges(Ada, Clara)");
    expect(html(agent)).not.toContain("onlyAuthorMerges");
    state.me = "user-3";
    expect(html(agent), "a claimer who cannot merge is not told to ask themself").not.toContain("Merges(");
  });
});

describe("Worktree continue editing", () => {
  it("uses the server reopen capability and disables the action while pending", () => {
    expect(renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: worktree(false) })))
      .not.toContain("continueEditing");
    state.pending = true;
    const html = renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: worktree(true) }));
    expect(html).toContain("continueEditing");
    expect(html).toContain("disabled");
    expect(state.clicks.has("continueEditing")).toBe(false);
  });

  it("reopens through the product API and returns to the draft after refreshing state", async () => {
    const onSelectedViewChange = vi.fn();
    renderToStaticMarkup(createElement(WorktreeReviewPanel, {
      worktree: worktree(true), selectedView: "preview", onSelectedViewChange,
    }));
    state.clicks.get("continueEditing")!();
    await vi.waitFor(() => expect(onSelectedViewChange).toHaveBeenCalledWith("agent"));
    expect(state.post).toHaveBeenCalledWith("/api/worktrees/{worktreeId}/reopen", {
      params: { path: { worktreeId: "worktree-1" } },
    });
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["worktrees"] });
    expect(state.success).toHaveBeenCalledWith("taskReopened");
  });

  it("keeps the selected view and reports a rejected reopen", async () => {
    state.post.mockResolvedValue({ error: { error: { code: "FORBIDDEN", message: "Permission changed." } } });
    const onSelectedViewChange = vi.fn();
    renderToStaticMarkup(createElement(WorktreeReviewPanel, {
      worktree: worktree(true), selectedView: "comparison", onSelectedViewChange,
    }));
    state.clicks.get("continueEditing")!();
    await vi.waitFor(() => expect(state.error).toHaveBeenCalledWith("Permission changed."));
    expect(onSelectedViewChange).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
  });
});


const listedPage = (id: string, state: string) => ({ id, name: `${id}.univer.html`, state, author: { id: "user-3", username: "eve", displayName: "Eve", avatarUrl: null } });

it.each([0, 1, 2])("announces only a positive count (%s) of the listed pages a merge publishes", (count) => {
  const value = worktree(false);
  value.capabilities.merge = true;
  value.pendingPageDrafts = 5;
  state.pages = [...Array.from({ length: count }, (_, index) => listedPage(`draft-${index}`, "pending")), listedPage("old", "conflicted")];
  const html = renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }));
  expect(html).toContain("mergeDescription");
  if (count) expect(html).toContain(count === 1 ? "mergePublishesPage(1)" : "mergePublishesPages(2)");
  else expect(html).not.toContain("mergePublishesPage");
});

describe("merging the pages a person reviewed", () => {
  it("waits for the page list before it offers the merge", () => {
    const value = worktree(false);
    value.capabilities.merge = true;
    expect(renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }))).toContain("disabled");
    state.pages = [];
    expect(renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }))).not.toContain("disabled");
  });

  it("sends the listed pages the merge acts on", async () => {
    const value = worktree(false);
    value.capabilities.merge = true;
    state.pages = [listedPage("draft-1", "pending"), listedPage("draft-2", "conflicted"), listedPage("draft-3", "expired"), listedPage("draft-4", "rejected")];
    state.post.mockResolvedValue({ data: { worktree: { state: "merged" }, publishedPages: [] } });
    renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }));
    state.clicks.get("confirmMerge")!();
    await vi.waitFor(() => expect(state.success).toHaveBeenCalledWith("taskMerged"));
    expect(state.post).toHaveBeenCalledWith("/api/worktrees/{worktreeId}/merge", expect.objectContaining({ body: { pageDraftIds: ["draft-1", "draft-2"] } }));
  });

  it("refreshes the page list and asks the person to review again when the pages changed", async () => {
    const value = worktree(false);
    value.capabilities.merge = true;
    state.pages = [listedPage("draft-1", "pending")];
    state.post.mockResolvedValue({ error: { error: { code: "PAGES_CHANGED", message: "The pages or files of this pull request changed since you reviewed it." } } });
    renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }));
    state.clicks.get("confirmMerge")!();
    await vi.waitFor(() => expect(state.error).toHaveBeenCalledWith("pagesChangedReviewAgain"));
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["html-view-drafts", "worktree", "worktree-1"] });
    expect(state.success).not.toHaveBeenCalled();
  });
});

it.each([{ publishedPages: [] }, { publishedPages: [{ draftId: "draft-1", name: "Page", nodeId: "page-1" }] }, { publishedPages: [{ draftId: "draft-1", name: "Page", nodeId: "page-1" }, { draftId: "draft-2", name: "Page 2", nodeId: "page-2" }] }])("links to published pages only when merge returns them (%j)", async ({ publishedPages }) => {
  const value = worktree(false); value.capabilities.merge = true;
  state.pages = [];
  state.post.mockResolvedValue({ data: { worktree: { state: "merged" }, publishedPages } });
  renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }));
  state.clicks.get("confirmMerge")!();
  await vi.waitFor(() => expect(state.success).toHaveBeenCalled());
  if (publishedPages.length) {
    const call = state.success.mock.calls.find(([message]) => message === "taskMerged");
    expect(call).toBeDefined();
    expect(renderToStaticMarkup(call![1].description)).toContain(publishedPages.length === 1 ? "pagePublished(1)" : "pagesPublished(2)");
    expect(renderToStaticMarkup(call![1].description)).toContain('href="/nodes/page-1"');
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["html-view-drafts"] });
  } else expect(state.success).toHaveBeenCalledTimes(1);
});

it("lists a file draft beside the pages with its size and a download in place of a preview, and counts it in the merge", async () => {
  const value = worktree(false);
  value.capabilities.merge = true;
  state.pages = [listedPage("page-draft", "pending"), { ...listedPage("file-draft", "pending"), name: "report.pdf", page: false, byteSize: 2048 }];
  const html = renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: value }));
  expect(html).toContain("Pages and files");
  expect(html).toContain('href="/api/html-view-drafts/file-draft/content" download="report.pdf"');
  expect(html).toContain("2 KB");
  expect(html).not.toContain('href="/drafts/file-draft"');
  expect(html).toContain('href="/drafts/page-draft"');
  expect(html).toContain("mergePublishesPage(1) mergeReplacesFile(1)");

  state.post.mockResolvedValue({ data: { worktree: { state: "merged" }, publishedPages: [{ draftId: "file-draft", name: "report.pdf", nodeId: "file-node" }] } });
  state.clicks.get("confirmMerge")!();
  await vi.waitFor(() => expect(state.success).toHaveBeenCalled());
  expect(state.post).toHaveBeenCalledWith("/api/worktrees/{worktreeId}/merge", expect.objectContaining({ body: { pageDraftIds: ["page-draft", "file-draft"] } }));
  const description = renderToStaticMarkup(state.success.mock.calls[0]![1].description);
  expect(description).toContain("fileReplaced(1)");
  expect(description).not.toContain("pagePublished");
});

it("lists each page the pull request carries with its author, state and preview, to a reviewer only", () => {
  state.pages = [
    { id: "draft-1", name: "Budget.univer.html", state: "pending", author: { id: "user-3", username: "eve", displayName: "Eve", avatarUrl: null } },
    { id: "draft-2", name: "Old.univer.html", state: "conflicted", author: { id: "user-1", username: "alice", displayName: "Alice", avatarUrl: null } },
  ];
  const html = renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: worktree(false) }));
  expect(html).toContain("Budget.univer.html");
  expect(html).toContain("by Eve");
  expect(html).toContain("Pending review");
  expect(html).toContain("Conflicted");
  expect(html).toContain('href="/drafts/draft-1"');
  expect(html).toContain('href="/drafts/draft-2"');
  const hidden = worktree(false);
  hidden.capabilities.review = false;
  expect(renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: hidden }))).not.toContain("/drafts/");
});

it("lists each check with its state and every result, marking those out of date or not counting", () => {
  const reporter = (name: string) => ({ id: name, username: name, displayName: name, avatarUrl: null });
  const result = (name: string, current: boolean, counts: boolean) =>
    ({ reporter: reporter(name), state: "passed", summary: `${name} read B5`, reportedAt: "2026-11-24T00:00:00.000Z", current, counts });
  state.checks = [
    { name: "totals-match", declared: true, state: "passed", results: [result("Editor", true, true), result("Viewer", true, false), result("Old", false, false)] },
    { name: "smoke", declared: false, state: "missing", results: [] },
  ];
  const html = renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: worktree(false) }));
  expect(html).toContain("totals-match");
  expect(html).toContain("Editor · checkPassed · Editor read B5");
  expect(html).toContain("Viewer · checkPassed · checkDoesNotCount · Viewer read B5");
  expect(html).toMatch(/line-through[^>]*>Old · checkPassed · checkOutOfDate/u);
  expect(html).toContain("checkNotDeclared");
  const hidden = worktree(false);
  hidden.capabilities.review = false;
  expect(renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: hidden }))).not.toContain("totals-match");
});

it("says plainly when the repository declares no checks, where the reader asks for it", () => {
  const checks = (explainNone: boolean) =>
    renderToStaticMarkup(createElement(PullRequestChecks, { worktreeId: "worktree-1", explainNone }));
  state.checks = [];
  expect(checks(true)).toContain("checksNoneDeclared");
  expect(checks(false)).toBe("");
  state.checks = [{ name: "smoke", declared: false, state: "missing", results: [] }];
  expect(checks(true)).toMatch(/checksNoneDeclared.*smoke/su);
  state.checks = [{ name: "totals-match", declared: true, state: "missing", results: [] }];
  expect(checks(true)).not.toContain("checksNoneDeclared");
  state.checks = undefined;
  expect(checks(true), "nothing while the checks load").toBe("");
});

it("labels a merged pull request's checks as at merge, or as computed now when its merge recorded none", () => {
  const checks = (atMerge: boolean | null) => {
    state.checks = [{ name: "totals-match", declared: true, state: "passed", results: [], atMerge }];
    return renderToStaticMarkup(createElement(PullRequestChecks, { worktreeId: "worktree-1" }));
  };
  expect(checks(true)).toContain(">checksAtMerge</h2>");
  expect(checks(false)).toMatch(/>checksNow<\/h2>.*checksNotRecordedAtMerge/su);
  expect(checks(null), "an open pull request").toContain(">checks</h2>");
});
