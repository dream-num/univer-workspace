import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listActiveWorktrees, listReviewWorktrees } from "../src/provider/worktree-api.ts";
import type { WorkspaceHttpClient } from "../src/provider/workspace-contract.ts";
import { createBrowserApiHandler } from "../src/webServer/plugin.ts";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("Worktree browser API", () => {
  it("walks active and processed pages and de-duplicates Worktree details", async () => {
    const requests: string[] = [];
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "session",
      async request(path) {
        requests.push(path);
        const url = new URL(path, "https://workspace.test");
        if (url.pathname === "/api/worktrees") {
          const scope = url.searchParams.get("scope");
          const cursor = url.searchParams.get("cursor");
          if (scope === "active" && cursor === null) {
            return response({ items: [{ id: "wt-active" }], nextCursor: "active-next" });
          }
          if (scope === "active" && cursor === "active-next") {
            return response({ items: [{ id: "wt-shared" }], nextCursor: null });
          }
          if (scope === "processed" && cursor === null) {
            return response({
              items: [{ id: "wt-shared" }, { id: "wt-processed" }],
              nextCursor: null,
            });
          }
        }
        const detail = /^\/api\/worktrees\/(wt-[a-z]+)$/.exec(url.pathname);
        if (detail !== null) return response(worktreeDetail(detail[1]!));
        throw new Error(`unexpected request ${path}`);
      },
    };

    const worktrees = await listReviewWorktrees(client);

    expect(worktrees.map((worktree) => worktree.worktreeId).sort()).toEqual([
      "wt-active",
      "wt-processed",
      "wt-shared",
    ]);
    expect(
      worktrees.find((worktree) => worktree.worktreeId === "wt-active")?.units[0],
    ).toMatchObject({
      nodeId: "node-1",
      mergeResult: "pending",
      activationState: "notApplicable",
    });
    expect(requests).toContain("/api/worktrees?scope=active&limit=50&cursor=active-next");
    expect(requests.filter((path) => path === "/api/worktrees/wt-shared")).toHaveLength(1);
  });

  it("rejects a malformed Worktree list item instead of hiding it", async () => {
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "session",
      async request(path) {
        expect(path).toBe("/api/worktrees?scope=active&limit=50");
        return response({ items: [{ name: "Missing id" }], nextCursor: null });
      },
    };

    await expect(listActiveWorktrees(client)).rejects.toMatchObject({
      code: "MALFORMED_WORKTREES",
      status: 502,
    });
  });

  it("requires a connected identity before listing Worktrees", async () => {
    const listWorktrees = vi.fn(async () => []);
    const identity = { current: undefined as undefined | { userId: string; username: string } };
    const server = await serve(identity, listWorktrees);

    const result = await fetch(`${server.origin}/univer-workspace/api/worktrees`);

    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: "workspace_connection_required" });
    expect(listWorktrees).not.toHaveBeenCalled();
  });

  it("lists the current identity's origin-level Worktrees", async () => {
    const worktrees = [worktreeView("wt-ready")];
    const listWorktrees = vi.fn(async () => worktrees);
    const identity = { current: { userId: "user-1", username: "alice" } };
    const server = await serve(identity, listWorktrees);

    const result = await fetch(`${server.origin}/univer-workspace/api/worktrees`);

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ worktrees });
    expect(listWorktrees).toHaveBeenCalledExactlyOnceWith("user-1");
  });
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function worktreeDetail(id: string): unknown {
  const processed = id === "wt-processed";
  return {
    worktree: {
      id,
      name: id,
      summary: null,
      kind: "user",
      teamSpace: null,
      visibility: "private",
      state: processed ? "merged" : "draft",
      creator: { id: "user-1", username: "alice", displayName: "Alice", avatarUrl: null },
      unitCount: id === "wt-active" ? 1 : 0,
      processedAt: processed ? "2026-09-04T00:00:02Z" : null,
      createdAt: "2026-09-04T00:00:00Z",
      updatedAt: "2026-09-04T00:00:01Z",
      capabilities: {
        review: true,
        editDraft: !processed,
        addUnit: !processed,
        changeVisibility: false,
        markReady: !processed,
        reopen: false,
        merge: false,
        discard: !processed,
      },
      units:
        id === "wt-active"
          ? [
              {
                unitId: "unit-1",
                resourceId: "resource-1",
                nodeId: "node-1",
                source: "trunk",
                name: "Existing Sheet",
                unitType: "sheet",
                target: null,
                draftHeadRevision: 1,
                change: "unchanged",
                mergeResult: "pending",
                activationState: "notApplicable",
              },
            ]
          : [],
    },
  };
}

function worktreeView(worktreeId: string) {
  return {
    worktreeId,
    name: "Quarterly update",
    summary: "Prepare both resources",
    status: "ready" as const,
    kind: "user" as const,
    teamSpace: null,
    visibility: "private" as const,
    creator: { id: "user-1", username: "alice", displayName: "Alice", avatarUrl: null },
    unitCount: 0,
    processedAt: null,
    createdAt: "2026-09-04T00:00:00Z",
    updatedAt: "2026-09-04T00:00:01Z",
    capabilities: {
      review: true,
      editDraft: false,
      addUnit: false,
      changeVisibility: false,
      markReady: false,
      reopen: true,
      merge: true,
      discard: true,
    },
    units: [],
  };
}

async function serve(
  identity: { current: undefined | { userId: string; username: string } },
  listWorktrees: (userId: string) => Promise<unknown>,
): Promise<{ origin: string }> {
  const context = {
    get(name: string) {
      if (name === "workspaceAuth") {
        return {
          currentIdentity: () => identity.current,
          currentClient: () => undefined,
        };
      }
      if (name === "univerWorkspace") return { listWorktrees };
      return undefined;
    },
  } as unknown as Context;
  const handler = createBrowserApiHandler(context, {
    license: "",
    workspaceRoot: "/tmp/worktree-browser-api-test",
    workspaceOrigin: "https://workspace.test",
    publicOrigin: "http://127.0.0.1",
    templates: [],
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${address.port}` };
}
