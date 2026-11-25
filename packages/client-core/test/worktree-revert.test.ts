import { expect, it } from "vitest";
import { WorkspaceHttp, WorkspaceWorktreeFeature } from "../src/index.js";

const blocked = {
  action: "restore", state: "blocked", name: "North", nodeId: "n1", unitId: "u1", unitType: "sheet",
  targetRevision: 1, headRevision: 4, reason: "Edited on Trunk after this task's merge.",
  laterEdits: [{ user: { id: "e", username: "eve", displayName: "Eve", avatarUrl: null }, revisions: 2, lastEditedAt: "2026-11-24T00:00:00.000Z" }],
};
const trashed = { ...blocked, action: "trash", state: "done", unitId: null, unitType: null, targetRevision: null, headRevision: null, reason: null, laterEdits: [] };

it("reads an Issue's revert plan, reverts with a fresh key and no force, and reads a pending result", async () => {
  const calls: unknown[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push([request.method, new URL(request.url).pathname, request.headers.get("idempotency-key")?.length ?? null, await request.text()]);
    if (request.method === "GET") {
      return Response.json({ pullRequests: [{ id: "w1", number: 3, title: "Fix" }], items: [blocked], capabilities: { revert: true, force: false }, refusal: null });
    }
    return request.url.includes("/worktrees/")
      ? Response.json({ operation: { id: "o2", state: "pending" } }, { status: 202 })
      : Response.json({ operation: { id: "o1", state: "completed" }, items: [blocked, trashed] }, { status: 201 });
  };
  const http = new WorkspaceHttp({ cookie: "workspace_session=test", fetcher, origin: "https://workspace.test", role: "client" });
  const worktrees = new WorkspaceWorktreeFeature(async () => http);
  const { unitType: _sheet, ...item } = blocked;
  const parsed = { ...item, laterEdits: [{ user: { id: "e", username: "eve", displayName: "Eve" }, revisions: 2, lastEditedAt: "2026-11-24T00:00:00.000Z" }] };

  expect(await worktrees.revertPlan({ spaceId: "s1", issueNumber: 7 })).toEqual({
    pullRequests: [{ id: "w1", number: 3, title: "Fix" }], items: [parsed], capabilities: { revert: true, force: false }, refusal: null,
  });
  const done = await worktrees.revert({ spaceId: "s1", issueNumber: 7 });
  expect(done).toMatchObject({ operation: { id: "o1", state: "completed" }, items: [parsed, { action: "trash", state: "done" }] });
  expect(await worktrees.revert({ worktreeId: "w1" })).toEqual({ operation: { id: "o2", state: "pending" }, items: null });
  expect(calls).toEqual([
    ["GET", "/api/spaces/s1/issues/7/revert", null, ""],
    ["POST", "/api/spaces/s1/issues/7/revert", 36, ""],
    ["POST", "/api/worktrees/w1/revert", 36, ""],
  ]);
  await expect(worktrees.revertPlan({ spaceId: "s1", issueNumber: 0 })).rejects.toThrow("Issue number must be a positive integer.");
});
