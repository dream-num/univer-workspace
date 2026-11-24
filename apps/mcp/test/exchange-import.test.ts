import { expect, it, vi } from "vitest";
import { WorkspaceContentSource } from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { exchangeImport } from "../src/executor/ops/exchange-import.js";
import { zeroCost } from "../src/shared/usage.js";
import type { OpContext } from "../src/executor/context.js";

it("rejects oversized converted UnitData before any create/commit HTTP request", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const http = new WorkspaceHttp({
    origin: "http://workspace.test",
    cookie: "workspace_session=test",
    role: "client",
    fetcher,
  });
  const source = new WorkspaceContentSource(http);
  const ctx: OpContext = {
    userId: "owner",
    requestId: "large",
    signal: new AbortController().signal,
    transportOrigin: http.origin,
    http: () => http,
    source: () => source,
    usage: { executor: "none", cost: { ...zeroCost } },
    runtime: { executeRead: vi.fn(), executeAndCommit: vi.fn(), exportUnitData: vi.fn() },
    exchange: {
      license: "",
      licenseKey: "",
      importBuffer: async () => ({ name: "Too large", content: "x".repeat(900 * 1024) }),
    },
  };
  await expect(
    exchangeImport(
      ctx,
      {
        worktreeId: "wt",
        spaceId: "space",
        fileName: "large.xlsx",
        idempotencyKey: "key",
      },
      new Uint8Array([0, 255]),
    ),
  ).rejects.toMatchObject({
    code: "workspace-import-too-large",
    detail: { maxBytes: 921600, size: 921633 },
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(ctx.usage.cost.committed_revisions).toBe(0);
});

it("imports through a fork address into the Worktree the fork's write opened", async () => {
  const posts: { path: string; body: unknown }[] = [];
  const fork = {
    createdAt: "2026-11-23T00:00:00.000Z", fullName: "agent/fix", id: "f1", name: "fix",
    owner: { id: "a1", username: "agent" }, state: "clean", worktree: null,
    upstream: { id: "s1", name: "Team", type: "team", fullName: "hana/team" },
  };
  const unit = {
    activationState: "notApplicable", change: "added", draftHeadRevision: 0, freshness: null, mergeResult: "pending",
    name: "Imported", nodeId: "n7", resourceId: "r7", source: "worktree", target: { parentNodeId: null, spaceId: "s1" },
    unitId: "u7", unitType: "sheet",
  };
  const paths: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname + url.search;
    paths.push(path);
    if (path === "/api/forks/lookup?name=fix&owner=agent") return Response.json(fork);
    if (request.method === "POST" && path === "/api/forks/f1/units") {
      posts.push({ path, body: await request.json() });
      const worktree = { id: "w1", name: "fix", number: 7, state: "draft", teamSpace: { id: "s1" }, units: [unit] };
      return Response.json({ unit, worktree }, { status: 201 });
    }
    return Response.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  });
  const http = new WorkspaceHttp({ origin: "http://workspace.test", cookie: "workspace_session=test", role: "client", fetcher });
  const ctx: OpContext = {
    userId: "a1",
    requestId: "fork",
    signal: new AbortController().signal,
    transportOrigin: http.origin,
    http: () => http,
    source: () => new WorkspaceContentSource(http),
    usage: { executor: "none", cost: { ...zeroCost } },
    runtime: { executeRead: vi.fn(), executeAndCommit: vi.fn(), exportUnitData: vi.fn() },
    exchange: { license: "", licenseKey: "", importBuffer: async () => ({ id: "converted", name: "Imported" }) },
  };
  const { output } = await exchangeImport(
    ctx,
    { worktreeId: "agent/fix", spaceId: "s1", fileName: "report.xlsx", idempotencyKey: "import-key-000001" },
    new Uint8Array([0, 255]),
  );
  expect(output).toMatchObject({ unitId: "u7", worktreeId: "w1", type: "sheet" });
  expect(posts).toMatchObject([
    { path: "/api/forks/f1/units", body: { source: "worktree", name: "Imported", targetSpaceId: "s1", unitType: "sheet" } },
  ]);
  expect(paths.filter((path) => path.startsWith("/api/worktrees/"))).toEqual([]);
});
