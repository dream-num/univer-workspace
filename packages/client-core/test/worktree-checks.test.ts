import { expect, it } from "vitest";
import { WorkspaceHttp, WorkspaceWorktreeFeature } from "../src/index.js";

const check = {
  name: "totals-match",
  declared: true,
  state: "missing",
  atMerge: null,
  results: [{
    reporter: { id: "a", username: "agent", displayName: "Agent", avatarUrl: null },
    state: "passed", summary: "B5 = 60", reportedAt: "2026-11-24T00:00:00.000Z", current: false, counts: false,
  }],
};

it("reads checks, reports one with the name in the path, and reads the summary on a pull request", async () => {
  const calls: unknown[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    calls.push([request.method, new URL(request.url).pathname, text ? JSON.parse(text) : undefined]);
    if (request.method === "PUT") return Response.json({ check });
    if (request.url.endsWith("/checks")) return Response.json({ checks: [check] });
    return Response.json({ worktree: { id: "w1", name: "Fix", state: "merged", units: [], checks: { passed: 1, failed: 0, missing: 1, atMerge: true } } });
  };
  const http = new WorkspaceHttp({ cookie: "workspace_session=test", fetcher, origin: "https://workspace.test", role: "client" });
  const worktrees = new WorkspaceWorktreeFeature(async () => http);
  const parsed = { ...check, results: [{ ...check.results[0], reporter: { id: "a", username: "agent", displayName: "Agent" } }] };

  expect(await worktrees.checks("w1")).toEqual([parsed]);
  expect(await worktrees.reportCheck("w1", "totals-match", { state: "passed", summary: "B5 = 60" })).toEqual(parsed);
  expect((await worktrees.get("w1")).checks).toEqual({ passed: 1, failed: 0, missing: 1, atMerge: true });
  expect(calls).toEqual([
    ["GET", "/api/worktrees/w1/checks", undefined],
    ["PUT", "/api/worktrees/w1/checks/totals-match", { state: "passed", summary: "B5 = 60" }],
    ["GET", "/api/worktrees/w1", undefined],
  ]);
});
