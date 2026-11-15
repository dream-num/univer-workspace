import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "draft",
  editorMode: "edit",
  worktreeState: "draft",
  editDraft: true,
  change: "modified",
  openError: false,
  detailError: false,
  authenticated: true,
  feed: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useParams: () => ({ worktreeId: "wt-1", unitId: "unit-1", mode: state.mode }),
  }),
  redirect: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (key: string) => key === "session"
    ? { data: { authenticated: state.authenticated, user: { id: "user-1" } } }
    : key === "open"
      ? {
          isError: state.openError,
          data: {
            unit: { unitId: "unit-1", unitType: "sheet", editorMode: state.editorMode },
            collaborationScope: { kind: "worktree", worktreeId: "wt-1" },
          },
        }
      : {
          isError: state.detailError,
          data: { worktree: {
            state: state.worktreeState,
            capabilities: { editDraft: state.editDraft },
            units: [{ unitId: "unit-1", change: state.change }],
          } },
        },
}));
vi.mock("../../web/src/features/auth", () => ({
  requireAuthenticatedSession: vi.fn(),
  sessionQueryOptions: "session",
}));
vi.mock("../../web/src/features/worktrees", () => ({
  useWorktreeChangeFeed: state.feed,
  worktreeQueryOptions: () => "detail",
  worktreeUnitOpenQueryOptions: () => "open",
}));
vi.mock("../../web/src/features/editor", () => ({
  ResourceEditor: ({ readOnly }: { readOnly: boolean }) =>
    createElement("div", { "data-read-only": readOnly }),
}));

import { Route } from "../../web/src/routes/worktrees_.$worktreeId_.units.$unitId.$mode.js";

function render() {
  return renderToStaticMarkup(createElement(Route.options.component as ComponentType));
}

beforeEach(() => {
  Object.assign(state, {
    mode: "draft", editorMode: "edit", worktreeState: "draft", editDraft: true,
    change: "modified", openError: false, detailError: false, authenticated: true,
  });
  state.feed.mockClear();
});

describe("Worktree embedded editor permissions", () => {
  it("opens an authorized draft for editing and subscribes its independent page to updates", () => {
    expect(render()).toContain('data-read-only="false"');
    expect(state.feed).toHaveBeenCalledWith(true);
  });

  it.each(["trunk", "mergePreview"])("keeps %s review read-only even when the open descriptor allows editing", (mode) => {
    state.mode = mode;
    expect(render()).toContain('data-read-only="true"');
  });

  it("requires both server responses to allow editing across asynchronous Ready/Reopen refreshes", () => {
    state.worktreeState = "ready";
    state.editDraft = false;
    expect(render()).toContain('data-read-only="true"');
    state.worktreeState = "draft";
    state.editDraft = true;
    state.editorMode = "readOnly";
    expect(render()).toContain('data-read-only="true"');
    state.editorMode = "edit";
    expect(render()).toContain('data-read-only="false"');
  });

  it("honors revoked draft permission, removal, and failed permission refreshes even with cached open data", () => {
    state.editDraft = false;
    expect(render()).toContain('data-read-only="true"');
    state.editDraft = true;
    state.change = "deleted";
    expect(render()).toContain('data-read-only="true"');
    state.change = "modified";
    state.openError = true;
    expect(render()).toContain('data-read-only="true"');
    state.openError = false;
    state.detailError = true;
    expect(render()).toContain('data-read-only="true"');
  });

  it("does not mount the editor or connect the feed when signed out", () => {
    state.authenticated = false;
    expect(render()).toBe("");
    expect(state.feed).toHaveBeenCalledWith(false);
  });
});
