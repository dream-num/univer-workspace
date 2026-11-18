import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeReviewPanel } from "./worktree-review-panel";

const state = vi.hoisted(() => ({
  pending: false,
  clicks: new Map<string, () => void>(),
  post: vi.fn(),
  invalidate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  me: "user-2" as string | null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueries: () => [],
  useQuery: (options: { queryKey?: readonly unknown[] }) =>
    options.queryKey?.[0] === "session" && state.me
      ? { data: { authenticated: true, user: { id: state.me } } }
      : {},
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useMutation: (config: {
    mutationFn: (value: unknown) => Promise<unknown>;
    onSuccess: () => Promise<unknown>;
  }) => ({
    isPending: state.pending,
    mutate: (value: unknown, callbacks: {
      onSuccess: (result: unknown) => void;
      onError: (error: unknown) => void;
    }) => {
      void config.mutationFn(value).then(async (result) => {
        await config.onSuccess();
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
  worktreeUnitComparisonQueryOptions: vi.fn(),
  worktreeUnitMergeReviewQueryOptions: vi.fn(),
}));
vi.mock("./worktree-review-header", () => ({
  WorktreeReviewHeader: ({ actions }: { actions: ReactNode }) => createElement("header", null, actions),
}));
vi.mock("../../shared/ui", () => {
  const Box = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return {
    Alert: Box, Badge: Box, Empty: Box, Segmented: Box, Spinner: Box, Tooltip: Box,
    ConfirmDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
    Button: ({ children, disabled, onClick }: {
      children: ReactNode;
      disabled: boolean;
      onClick: () => void;
    }) => {
      const label = renderToStaticMarkup(createElement("span", null, children)).replace(/<[^>]*>/g, "");
      if (!disabled) state.clicks.set(label, onClick);
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
