import { afterEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceNodeLocation } from "../src/client/api/univer-api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Worktree Unit location API", () => {
  it("marks a grant-root-clipped Personal Space path as shared", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        node: { id: "node-1", name: "Report.xlsx", accessRole: "editor" },
        space: { id: "space-a", type: "personal", name: "Alice" },
        breadcrumbs: [
          { id: "grant-root", name: "Shared project" },
          { id: "node-1", name: "Report.xlsx" },
        ],
        navigationRootNodeId: "grant-root",
      }),
    ) as typeof fetch;

    await expect(getWorkspaceNodeLocation("node-1")).resolves.toEqual({
      nodeId: "node-1",
      name: "Report.xlsx",
      accessRole: "editor",
      shared: true,
      space: { id: "space-a", type: "personal", name: "Alice" },
      breadcrumbs: [
        { id: "grant-root", name: "Shared project" },
        { id: "node-1", name: "Report.xlsx" },
      ],
    });
  });

  it("does not label an ordinary Space path as directly shared", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        node: { id: "node-2", name: "Team plan", accessRole: "editor" },
        space: { id: "space-team", type: "team", name: "Engineering" },
        breadcrumbs: [{ id: "node-2", name: "Team plan" }],
        navigationRootNodeId: null,
      }),
    ) as typeof fetch;

    await expect(getWorkspaceNodeLocation("node-2")).resolves.toMatchObject({
      shared: false,
      space: { id: "space-team", name: "Engineering" },
    });
  });

  it("rejects revoked and identity-mismatched locations", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;
    await expect(getWorkspaceNodeLocation("node-3")).rejects.toThrow(
      "workspace_node_location_unavailable",
    );

    globalThis.fetch = vi.fn(async () =>
      Response.json({
        node: { id: "another-node", name: "Wrong", accessRole: "editor" },
        space: { id: "space-a", type: "personal", name: "Alice" },
        breadcrumbs: [],
        navigationRootNodeId: null,
      }),
    ) as typeof fetch;
    await expect(getWorkspaceNodeLocation("node-3")).rejects.toThrow(
      "node location returned malformed data",
    );
  });
});
