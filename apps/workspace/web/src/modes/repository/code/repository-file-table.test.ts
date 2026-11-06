import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildPendingIndex, pendingAncestryPlan } from "../data/pending";
import { detail, recent, space, unit } from "../data/fixtures.test-support";
import { RepositoryFileTable } from "./repository-file-table";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) =>
    createElement("a", { href: to, className }, children),
}));
vi.mock("../../../shared/i18n", async (importOriginal) => {
  const { messages } = await importOriginal<typeof import("../../../shared/i18n")>();
  return {
    useI18n: () => ({
      language: "en-US",
      t: (key: keyof (typeof messages)["en-US"]) => messages["en-US"][key],
    }),
  };
});
vi.mock("../../../shared/ui", () => ({
  Avatar: () => null,
  Input: () => null,
  Empty: () => null,
  Button: () => null,
}));
vi.mock("../../../features/nodes/create-node-dropdown", () => ({ CreateNodeDropdown: () => null }));
vi.mock("../../../features/nodes/node-actions-menu", () => ({
  NodeActionsMenu: ({ children }: { children: (actions: ReactNode) => ReactNode }) =>
    children(null),
}));
vi.mock("../../../features/nodes/node-edit-dialog", () => ({
  useNodeEditDialog: () => ({ dialog: null }),
}));

const details = [
  detail({
    id: "risk",
    number: 3,
    units: [
      unit({
        name: "Risk Register",
        change: "added",
        source: "worktree",
        nodeId: "f8d11fd6-local",
        target: null,
      }),
    ],
  }),
  detail({
    id: "budget",
    number: 2,
    units: [
      unit({
        name: "Channel Budget Detail",
        change: "added",
        source: "worktree",
        nodeId: "budget-local",
        target: null,
      }),
    ],
  }),
];
const page = {
  space,
  parentNode: null,
  navigationRootNodeId: null,
  breadcrumbs: [],
  nodes: [],
  nextCursor: null,
};

describe("Repository pending addition rows", () => {
  it("renders both root additions with their PR number and Added chip without a partial-data warning", () => {
    expect(pendingAncestryPlan(space.id, details).ids).toEqual([]);
    const pending = buildPendingIndex(space.id, details, new Map(), true);
    const html = renderToStaticMarkup(
      createElement(RepositoryFileTable, { page, pending, latest: undefined }),
    );
    const rows = html.split('class="rd-frow rd-ghost"').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.includes("Risk Register"))).toMatch(/#3<\/span>Added/);
    expect(rows.find((row) => row.includes("Channel Budget Detail"))).toMatch(/#2<\/span>Added/);
    expect(html).not.toContain("Partial data");
  });

  it("renders an addition once when its node is subsequently visible in trunk", () => {
    const pending = buildPendingIndex(space.id, details, new Map(), true);
    const node = { ...recent("Risk Register").node, id: "f8d11fd6-local" };
    const html = renderToStaticMarkup(
      createElement(RepositoryFileTable, {
        page: { ...page, nodes: [node] },
        pending,
        latest: undefined,
      }),
    );
    expect(html.match(/Risk Register/g)).toHaveLength(1);
    expect(html).toContain("#3</span>Added");
    expect(html.match(/rd-frow rd-ghost/g)).toHaveLength(1);
  });
});
