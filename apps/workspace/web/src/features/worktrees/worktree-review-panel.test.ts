// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeReviewPanel } from "./worktree-review-panel";

const state = vi.hoisted(() => ({
  pending: false,
  clicks: new Map<string, () => void>(),
  confirms: new Map<string, () => void>(),
  post: vi.fn(),
  invalidate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueries: () => [],
  useQuery: () => ({}),
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useMutation: (config: {
    mutationFn: (value: unknown) => Promise<unknown>;
    onSuccess: () => Promise<unknown>;
    onError?: (error: unknown, value: unknown) => unknown;
  }) => ({
    isPending: state.pending,
    mutate: (value: unknown, callbacks: {
      onSuccess: (result: unknown) => void;
      onError: (error: unknown) => void;
    }) => {
      void config.mutationFn(value).then(async (result) => {
        await config.onSuccess();
        callbacks.onSuccess(result);
      }).catch((error: unknown) => {
        void config.onError?.(error, value);
        callbacks.onError(error);
      });
    },
  }),
}));
vi.mock("../../shared/api/client", () => ({ api: { POST: state.post } }));
vi.mock("../../shared/i18n", () => ({
  useI18n: () => ({ language: "en-US", t: (key: string) => key }),
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
    ConfirmDialog: ({ trigger, title, onConfirm }: { trigger: ReactNode; title: string; onConfirm: () => void }) => {
      state.confirms.set(title, onConfirm);
      return trigger;
    },
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

function worktree(reopen: boolean, overrides: Partial<Worktree> = {}): Worktree {
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
    unitCount: 0,
    processedAt: null,
    createdAt: "2026-11-15T00:00:00Z",
    updatedAt: "2026-11-15T00:00:00Z",
    revision: "revision-1",
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
    ...overrides,
  };
}

function mergeable(revision: string): Worktree {
  const base = worktree(false);
  return { ...base, revision, capabilities: { ...base.capabilities, merge: true } };
}

beforeEach(() => {
  state.pending = false;
  state.clicks.clear();
  state.confirms.clear();
  vi.clearAllMocks();
  state.post.mockResolvedValue({ data: { worktree: { state: "draft" } } });
  state.invalidate.mockResolvedValue(undefined);
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

describe("Worktree merge of the reviewed revision", () => {
  it("keeps the revision the person opened and asks them to look again when it changes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(WorktreeReviewPanel, { worktree: mergeable("r1") })));
    expect(container.textContent).toContain("confirmMerge");
    expect(container.textContent).not.toContain("taskChangedSinceReviewDescription");

    await act(async () => root.render(createElement(WorktreeReviewPanel, { worktree: mergeable("r2") })));
    expect(container.textContent).toContain("taskChangedSinceReviewDescription");
    expect(container.textContent).not.toContain("confirmMerge");

    await act(async () => state.clicks.get("reviewedLatestChanges")!());
    expect(container.textContent).not.toContain("taskChangedSinceReviewDescription");
    state.confirms.get("mergeConfirm")!();
    await vi.waitFor(() => expect(state.post).toHaveBeenCalledWith(
      "/api/worktrees/{worktreeId}/merge",
      expect.objectContaining({ body: { revision: "r2" } }),
    ));
    await act(async () => root.unmount());
  });

  it("reports a refused merge and reloads the pull request", async () => {
    state.post.mockResolvedValue({ error: { error: { code: "PRECONDITION_FAILED", message: "Changed." } } });
    renderToStaticMarkup(createElement(WorktreeReviewPanel, { worktree: mergeable("r1") }));
    state.confirms.get("mergeConfirm")!();
    await vi.waitFor(() => expect(state.error).toHaveBeenCalledWith("mergeRefusedChanged"));
    expect(state.post).toHaveBeenCalledWith(
      "/api/worktrees/{worktreeId}/merge",
      expect.objectContaining({ body: { revision: "r1" } }),
    );
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["worktrees"] });
    expect(state.success).not.toHaveBeenCalled();
  });
});
