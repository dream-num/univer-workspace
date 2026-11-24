import { describe, expect, it } from "vitest";
import {
  isForkAddress,
  resolveRepoOrFork,
  WorkspaceForkFeature,
  WorkspaceHttp,
  WorkspaceSpaceFeature,
  WorkspaceUnitExchangeFeature,
} from "../src/index.js";

interface Call {
  readonly body: unknown;
  readonly idempotencyKey: string | null;
  readonly method: string;
  readonly path: string;
}

const UPSTREAM = {
  accessRole: "editor", capabilities: {}, description: "", fullName: "hana/team", id: "s1", name: "Team",
  owner: { id: "h1", username: "hana" }, publicRead: false, slug: "team", type: "team",
};

function fork(state: "clean" | "drafting" = "clean", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    createdAt: "2026-11-23T00:00:00.000Z", fullName: "agent/fix", id: "f1", name: "fix",
    owner: { id: "a1", username: "agent" }, state, upstream: UPSTREAM,
    worktree: state === "clean" ? null : { id: "w1", name: "fix", number: 7, state: "draft", teamSpace: { id: "s1" } },
    ...overrides,
  };
}

function unit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activationState: "notApplicable", change: "unchanged", draftHeadRevision: 0, freshness: null,
    mergeResult: "pending", name: "Budget", nodeId: "n1", resourceId: "r1", source: "trunk", target: null,
    unitId: "u1", unitType: "sheet", ...overrides,
  };
}

function worktree(units: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { id: "w1", name: "fix", number: 7, state: "draft", teamSpace: { id: "s1" }, units, updatedAt: "2026-11-23T01:00:00.000Z" };
}

function fileNode(id: string, name: string, unitId: string, parentNodeId: string | null = null): Record<string, unknown> {
  return {
    accessRole: "editor", hasChildren: false, id, name, parentNodeId, spaceId: "s1", updatedAt: "2026-11-23T00:00:00.000Z",
    capabilities: { browseChildren: false, createChildren: false, move: true, rename: true, share: true, trash: true },
    resource: {
      capabilities: { downloadContent: false, editContent: true, openContent: true },
      id: `r-${unitId}`, kind: "univer", unitId, unitType: "sheet",
    },
  };
}

function server(routes: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const call = {
      body: text ? (JSON.parse(text) as unknown) : undefined,
      idempotencyKey: request.headers.get("idempotency-key"),
      method: request.method,
      path: url.pathname + url.search,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    if (route === undefined) {
      return Response.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
    }
    const value = route(call);
    return value instanceof Response ? value : Response.json(value);
  };
  const http = new WorkspaceHttp({ cookie: "workspace_session=test", fetcher, origin: "https://workspace.test", role: "client" });
  return { calls, forks: new WorkspaceForkFeature(async () => http), spaces: new WorkspaceSpaceFeature(async () => http) };
}

const LOOKUP = "GET /api/forks/lookup?name=fix&owner=agent";
const writes = (calls: readonly Call[]) => calls.filter((call) => call.method === "POST");

describe("Workspace forks", () => {
  it("tells a fork address from a Worktree ID", () => {
    expect(isForkAddress("agent/fix")).toBe(true);
    expect(isForkAddress(" agent/fix ")).toBe(true);
    for (const text of ["0b9e1f5c-1d1e-4f43-9a55-2b4c6f1d2e3a", "agent", "a/b/c", "https://workspace.test/a/b", "a /b"]) {
      expect(isForkAddress(text), text).toBe(false);
    }
  });

  it("reads a fork by address or by ID", async () => {
    const { calls, forks } = server({ [LOOKUP]: () => fork(), "GET /api/forks/f1": () => fork() });
    await expect(forks.get("agent/fix")).resolves.toMatchObject({ fullName: "agent/fix", state: "clean", worktree: null });
    await expect(forks.get("f1")).resolves.toMatchObject({ id: "f1", upstream: { fullName: "hana/team", id: "s1" } });
    expect(calls.map((call) => call.path)).toEqual(["/api/forks/lookup?name=fix&owner=agent", "/api/forks/f1"]);
  });

  it("rejects a fork whose state disagrees with its open Worktree", async () => {
    const { forks } = server({ [LOOKUP]: () => fork("drafting", { worktree: null }) });
    await expect(forks.get("agent/fix")).rejects.toMatchObject({ code: "workspace-invalid-response" });
  });

  it("reads an upstream Trunk file through a clean fork without opening a Worktree", async () => {
    const { calls, forks } = server({
      [LOOKUP]: () => fork(),
      "GET /api/unit-resources/u1": () => ({ node: fileNode("n1", "Budget", "u1") }),
    });
    await expect(forks.readScope("agent/fix", "u1")).resolves.toEqual({ kind: "trunk" });
    expect(writes(calls)).toEqual([]);
  });

  it("reads a file the fork changed from its open Worktree", async () => {
    const { calls, forks } = server({
      [LOOKUP]: () => fork("drafting"),
      "GET /api/worktrees/w1": () => ({ worktree: worktree([unit({ change: "modified" })]) }),
    });
    await expect(forks.readScope("agent/fix", "u1")).resolves.toEqual({ kind: "worktree", worktreeId: "w1" });
    expect(calls.some((call) => call.path.startsWith("/api/unit-resources/"))).toBe(false);
  });

  it("refuses a Unit outside the fork's upstream", async () => {
    const { calls, forks } = server({
      [LOOKUP]: () => fork(),
      "GET /api/unit-resources/u9": () => ({ node: { ...fileNode("n9", "Other", "u9"), spaceId: "s2" } }),
    });
    await expect(forks.writeScope("agent/fix", "u9")).rejects.toMatchObject({ code: "workspace-argument-invalid" });
    expect(writes(calls)).toEqual([]);
  });

  it("opens the fork's Worktree on its first write and adds the upstream file with a new key per call", async () => {
    const { calls, forks } = server({
      [LOOKUP]: () => fork(),
      "GET /api/unit-resources/u1": () => ({ node: fileNode("n1", "Budget", "u1") }),
      "POST /api/forks/f1/units": () =>
        Response.json({ unit: unit({ resourceId: "r-u1" }), worktree: worktree([unit({ resourceId: "r-u1" })]) }, { status: 201 }),
    });
    await expect(forks.writeScope("agent/fix", "u1")).resolves.toEqual({ kind: "worktree", worktreeId: "w1" });
    await forks.writeScope("agent/fix", "u1");
    const posts = writes(calls);
    expect(posts.map((call) => call.body)).toEqual([
      { resourceId: "r-u1", source: "trunk" },
      { resourceId: "r-u1", source: "trunk" },
    ]);
    expect(posts[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(posts[0]!.idempotencyKey).not.toBe(posts[1]!.idempotencyKey);
  });

  it("writes a file the fork created in place", async () => {
    const local = unit({ change: "added", source: "worktree", target: { parentNodeId: null, spaceId: "s1" }, unitId: "u5" });
    const { calls, forks } = server({
      [LOOKUP]: () => fork("drafting"),
      "GET /api/worktrees/w1": () => ({ worktree: worktree([local]) }),
    });
    await expect(forks.writeScope("agent/fix", "u5")).resolves.toEqual({ kind: "worktree", worktreeId: "w1" });
    expect(writes(calls)).toEqual([]);
  });

  it("creates a new file in the upstream through the fork route", async () => {
    const created = unit({ change: "added", name: "Notes", source: "worktree", target: { parentNodeId: "d1", spaceId: "s1" }, unitId: "u6", unitType: "doc" });
    const { calls, forks } = server({
      [LOOKUP]: () => fork(),
      "POST /api/forks/f1/units": () => Response.json({ unit: created, worktree: worktree([created]) }, { status: 201 }),
    });
    await expect(
      forks.createUnit("agent/fix", { idempotencyKey: "create-notes-0001", name: "Notes", parentNodeId: "d1", spaceId: "s1", type: "doc" }),
    ).resolves.toMatchObject({ source: "worktree", unitId: "u6", worktreeId: "w1" });
    expect(writes(calls)).toEqual([
      expect.objectContaining({
        body: { name: "Notes", source: "worktree", targetParentNodeId: "d1", targetSpaceId: "s1", unitType: "doc" },
        idempotencyKey: "create-notes-0001",
      }),
    ]);
  });

  it("refuses a created file that does not match the request", async () => {
    const created = unit({ change: "added", name: "Other", source: "worktree", target: { parentNodeId: null, spaceId: "s1" } });
    const { forks } = server({
      [LOOKUP]: () => fork(),
      "POST /api/forks/f1/units": () => ({ unit: created, worktree: worktree([created]) }),
    });
    await expect(forks.createUnit("agent/fix", { name: "Notes", spaceId: "s1", type: "sheet" })).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
  });

  it("lists the upstream as the fork's Worktree sees it", async () => {
    const added = unit({ change: "added", name: "Notes", nodeId: "n5", source: "worktree", target: { parentNodeId: "d1", spaceId: "s1" }, unitId: "u5" });
    const removed = unit({ change: "deleted", name: "Old", nodeId: "n2", unitId: "u2" });
    const folder = { ...fileNode("d1", "Plans", "unused"), hasChildren: true, resource: null };
    const page = (parent: string | null, nodes: readonly unknown[], breadcrumbs: readonly unknown[]) => ({
      breadcrumbs, navigationRootNodeId: null, nextCursor: null, nodes, parentNode: parent === null ? null : folder,
      space: { id: "s1", name: "Team", publicRead: false, type: "team" },
    });
    const { forks, spaces } = server({
      [LOOKUP]: () => fork("drafting"),
      "GET /api/worktrees/w1": () => ({ worktree: worktree([added, removed]) }),
      "GET /api/spaces/s1/nodes": () => page(null, [fileNode("n1", "Budget", "u1"), fileNode("n2", "Old", "u2"), folder], []),
      "GET /api/nodes/d1/children": () => page("d1", [], [{ id: "d1", name: "Plans" }]),
    });
    const listing = await forks.listing(await forks.get("agent/fix"));
    const nodes = await spaces.browse({ ...listing, recursive: true });
    expect(nodes.map((node) => node.path)).toEqual(["/Budget", "/Plans", "/Plans/Notes"]);
    expect(nodes.at(-1)).toMatchObject({ accessRole: "editor", nodeId: "n5", resource: { kind: "univer", unitId: "u5" }, spaceId: "s1" });
  });

  it("lists a clean fork as its upstream Trunk", async () => {
    const { forks } = server({ [LOOKUP]: () => fork() });
    await expect(forks.listing(await forks.get("agent/fix"))).resolves.toEqual({ spaceId: "s1" });
  });

  it("resolves a fork address only after the repository lookup misses", async () => {
    const { calls, forks, spaces } = server({
      "GET /api/spaces": () => ({ spaces: [] }),
      "GET /api/spaces/lookup?owner=hana&slug=team": () => UPSTREAM,
      [LOOKUP]: () => fork(),
    });
    await expect(resolveRepoOrFork(spaces, forks, "hana/team")).resolves.toEqual({ spaceId: "s1" });
    await expect(resolveRepoOrFork(spaces, forks, "agent/fix")).resolves.toMatchObject({ fork: { id: "f1" } });
    await expect(resolveRepoOrFork(spaces, forks, "agent/none")).rejects.toMatchObject({
      detail: expect.objectContaining({ path: "/api/spaces/lookup" }),
    });
    expect(calls.filter((call) => call.path.startsWith("/api/forks")).map((call) => call.path)).toEqual([
      "/api/forks/lookup?name=fix&owner=agent",
      "/api/forks/lookup?name=none&owner=agent",
    ]);
  });

  it("imports through a fork into the Worktree that the fork's write opened", async () => {
    const feature = new WorkspaceUnitExchangeFeature({
      configureExchange: async () => undefined,
      createUnit: async (input) => ({
        activationState: "notApplicable", change: "added", draftHeadRevision: 0, freshness: null, mergeResult: "pending",
        name: input.name, nodeId: "n7", resourceId: "r7", source: "worktree",
        target: { parentNodeId: null, spaceId: input.spaceId }, type: input.type, unitId: "u7", worktreeId: "w1",
      }),
      exportToFile: async () => undefined,
      importFile: async () => ({ id: "converted", name: "Imported" }),
      license: "test-license",
      licenseKey: "test-license-key",
      resolveImageAsset: async () => { throw new Error("Unexpected Asset request"); },
      resolveRuntimeTarget: async () => { throw new Error("Unexpected read"); },
      runtime: { exportUnitData: async () => ({}) as never },
    });
    await expect(feature.importFile({ sourcePath: "report.xlsx", spaceId: "s1", worktreeId: "agent/fix" })).resolves.toMatchObject({
      unitId: "u7",
      worktreeId: "w1",
    });
    await expect(feature.importFile({ sourcePath: "report.xlsx", spaceId: "s1", worktreeId: "w2" })).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
  });
});
