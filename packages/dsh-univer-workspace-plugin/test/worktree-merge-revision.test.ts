import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWorktreeDetail, mergeWorktree } from "../src/provider/workspace-api.ts";
import { registerWorktreeTools } from "../src/tools/worktree.ts";
import { createBrowserApiHandler } from "../src/webServer/plugin.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

const summary = {
  id: "wt-1", name: "Budget", summary: null, kind: "team", teamSpace: { id: "team-1", type: "team", name: "Team" },
  visibility: "space", state: "ready",
  creator: { id: "user-2", username: "bob", displayName: "Bob", avatarUrl: null }, unitCount: 0, processedAt: null,
  createdAt: "2026-11-17T00:00:00.000Z", updatedAt: "2026-11-17T00:00:00.000Z",
  capabilities: { review: true, editDraft: false, addUnit: false, changeVisibility: false, markReady: false, reopen: false, merge: true, discard: false },
};

describe("merging someone else's pull request from the Workspace Agent", () => {
  it("reads the revision from the detail and sends it with the merge", async () => {
    const request = vi.fn(async (path: string, _init?: RequestInit) =>
      Response.json(path.endsWith("/merge")
        ? { worktree: { ...summary, state: "merged" } }
        : { worktree: { ...summary, revision: "rev-1", units: [] } }),
    );
    const client = { origin: "https://workspace.test", sessionToken: "token", request };
    const { revision } = await getWorktreeDetail(client, "wt-1");
    expect(revision).toBe("rev-1");
    await expect(mergeWorktree(client, "wt-1", revision)).resolves.toMatchObject({ state: "merged" });
    expect(JSON.parse(String(request.mock.calls[1]![1]!.body))).toEqual({ revision: "rev-1" });
  });

  it("merges the revision the univer_worktree tool viewed", async () => {
    const service = {
      resolveSpaceForSession: vi.fn().mockResolvedValue({ userId: "user-1", spaceId: "space-1" }),
      getWorktreeFileState: vi.fn().mockResolvedValue({ worktrees: [] }),
      getWorktreeDetail: vi.fn().mockResolvedValue({ worktreeId: "wt-1", revision: "rev-1", units: [] }),
      mergeWorktree: vi.fn().mockResolvedValue({ ...summary, state: "merged" }),
    };
    let tool: ToolDefinition | undefined;
    const ctx = {
      get: () => service,
      on: () => () => undefined,
      tools: { register: (definition: ToolDefinition) => { tool = definition; return () => undefined; } },
    } as unknown as Context;
    registerWorktreeTools(ctx);
    const exec = { agent: { session: { header: { cwd: "/tmp/session" } } } } as ToolRunContext;
    await tool!.execute({ action: "merge", worktreeId: "wt-1" }, exec);
    expect(service.mergeWorktree).toHaveBeenCalledWith("user-1", "wt-1", "rev-1");
  });

  it("passes the revision the review panel showed through the browser route", async () => {
    const transitionWorktree = vi.fn().mockResolvedValue({ ...summary, state: "merged" });
    const ctx = {
      get(name: string) {
        if (name === "workspaceAuth") return { currentIdentity: () => ({ userId: "user-1", username: "alice" }) };
        if (name === "univerWorkspace") return { transitionWorktree };
        return undefined;
      },
    } as unknown as Context;
    const handler = createBrowserApiHandler(ctx, {
      license: "",
      workspaceRoot: "/tmp/worktree-merge-revision-test",
      workspaceOrigin: "https://workspace.test",
      publicOrigin: "http://127.0.0.1",
      templates: [],
    });
    const server = createServer((incoming, outgoing) => void handler(incoming, outgoing));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (action: string, body?: unknown) =>
      fetch(`${origin}/univer-workspace/api/worktrees/wt-1/${action}`, {
        method: "POST",
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });

    expect((await post("merge", { revision: "rev-1" })).status).toBe(200);
    expect((await post("ready")).status).toBe(200);
    expect(transitionWorktree.mock.calls).toEqual([
      ["user-1", "wt-1", "merge", "rev-1"],
      ["user-1", "wt-1", "ready", undefined],
    ]);
  });
});
