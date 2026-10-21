import { describe, expect, it } from "vitest";
import {
  parseItemNumber,
  parseRepoReference,
  resolveRepoReference,
  WorkspaceHttp,
  WorkspaceSpaceFeature,
  WorkspaceWorktreeFeature,
} from "../src/index.js";

interface Call { readonly method: string; readonly path: string; readonly body: unknown }

function clients(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const call = { method: request.method, path: url.pathname + url.search, body: text ? JSON.parse(text) : undefined };
    calls.push(call);
    return handler(call);
  };
  const http = new WorkspaceHttp({ cookie: "workspace_session=test", fetcher, origin: "https://workspace.test", role: "client" });
  return {
    calls,
    spaces: new WorkspaceSpaceFeature(async () => http),
    worktrees: new WorkspaceWorktreeFeature(async () => http),
  };
}

const notFound = () => Response.json({ error: { code: "NOT_FOUND", message: "The resource was not found." } }, { status: 404 });
const view = (overrides: Record<string, unknown> = {}) => ({
  id: "s1", type: "team", name: "Docs", publicRead: false, description: "d", slug: "docs", fullName: "me/docs",
  owner: { id: "u1", username: "me" }, accessRole: "owner", capabilities: {}, ...overrides,
});
const worktree = (overrides: Record<string, unknown> = {}) => ({
  id: "w1", number: 4, name: "PR", summary: "body", state: "draft", units: [], teamSpace: { id: "s1" }, ...overrides,
});

describe("repository references", () => {
  it("parses full names, IDs and Browser URLs", () => {
    expect(parseRepoReference("me/docs")).toEqual({ kind: "full-name", owner: "me", slug: "docs" });
    expect(parseRepoReference("me/personal")).toEqual({ kind: "full-name", owner: "me", slug: "personal" });
    expect(parseRepoReference("0c0c7a04-ca20")).toEqual({ kind: "id", spaceId: "0c0c7a04-ca20" });
    expect(parseRepoReference("https://workspace.test/spaces/s1")).toEqual({ kind: "url", spaceId: "s1" });
    expect(parseRepoReference("https://workspace.test/spaces/s1/issues/12?x=1")).toEqual({
      kind: "url", spaceId: "s1", item: { kind: "issue", number: 12 },
    });
    expect(parseRepoReference("https://workspace.test/spaces/s1/pulls/3#files")).toEqual({
      kind: "url", spaceId: "s1", item: { kind: "pr", number: 3 },
    });
    expect(parseRepoReference("https://workspace.test/spaces/s1/pulls")).toEqual({ kind: "url", spaceId: "s1" });
    expect(parseRepoReference("https://workspace.test/worktrees?worktree=w9&section=files")).toEqual({
      kind: "worktree-url", worktreeId: "w9",
    });
    for (const bad of ["", "a/b/c", "/b", "a/", "https://workspace.test/nodes/n1"]) {
      expect(() => parseRepoReference(bad), bad).toThrowError(expect.objectContaining({ code: "workspace-argument-invalid" }));
    }
  });

  it("parses item numbers", () => {
    expect(parseItemNumber("12")).toBe(12);
    expect(parseItemNumber("#12")).toBe(12);
    expect(parseItemNumber("https://workspace.test/spaces/s1/pulls/7")).toBe(7);
    expect(parseItemNumber("https://workspace.test/spaces/s1")).toBeUndefined();
    for (const other of ["0", "-1", "1.5", "w-1", "0c0c7a04-ca20", "#"]) expect(parseItemNumber(other), other).toBeUndefined();
  });

  it("resolves through the server lookup only when needed and rejects other origins", async () => {
    const { spaces, calls } = clients(() => Response.json(view()));
    await expect(resolveRepoReference(spaces, "Me/Docs")).resolves.toEqual({ spaceId: "s1" });
    expect(calls.map((call) => call.path)).toEqual(["/api/spaces/lookup?owner=Me&slug=Docs"]);
    await expect(resolveRepoReference(spaces, "s2")).resolves.toEqual({ spaceId: "s2" });
    await expect(resolveRepoReference(spaces, "https://workspace.test/spaces/s3/issues/5", "https://workspace.test"))
      .resolves.toEqual({ spaceId: "s3", item: { kind: "issue", number: 5 } });
    await expect(resolveRepoReference(spaces, "https://other.test/spaces/s3", "https://workspace.test"))
      .rejects.toMatchObject({ code: "workspace-origin-mismatch" });
    await expect(resolveRepoReference(spaces, "https://workspace.test/worktrees?worktree=w1"))
      .rejects.toMatchObject({ code: "workspace-argument-invalid" });
    expect(calls).toHaveLength(1);
  });

  it("reports a missing server capability only when the server predates Space full names", async () => {
    const oldServer = clients((call) =>
      call.path === "/api/spaces" ? Response.json({ spaces: [{ id: "p", name: "Personal", type: "personal" }] }) : notFound());
    await expect(oldServer.spaces.lookup("me", "docs")).rejects.toMatchObject({ code: "workspace-server-capability-missing" });
    await expect(oldServer.worktrees.getByNumber("s1", 4)).rejects.toMatchObject({ code: "workspace-server-capability-missing" });

    const newServer = clients((call) =>
      call.path === "/api/spaces" ? Response.json({ spaces: [view({ id: "p", type: "personal", slug: null, fullName: "me/personal" })] }) : notFound());
    await expect(newServer.spaces.lookup("me", "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(newServer.worktrees.getByNumber("s1", 9)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Errors other than 404 are never reinterpreted, and the probe is skipped.
    const failing = clients(() => Response.json({ error: { code: "INVALID_INPUT", message: "no" } }, { status: 400 }));
    await expect(failing.spaces.lookup("me", "x")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(failing.calls).toHaveLength(1);
  });
});

describe("Space and Worktree additions", () => {
  it("parses slug, full name and owner on Space views and keeps summaries unchanged", async () => {
    const { spaces } = clients(() => Response.json(view()));
    await expect(spaces.get("s1")).resolves.toEqual({
      id: "s1", type: "team", name: "Docs", publicRead: false, description: "d", slug: "docs",
      fullName: "me/docs", owner: { id: "u1", username: "me" }, accessRole: "owner",
    });
    const { spaces: summaryOnly } = clients(() => Response.json({ spaces: [{ id: "s", name: "N" }] }));
    await expect(summaryOnly.list()).resolves.toEqual([{ id: "s", name: "N" }]);
  });

  it("creates and updates Spaces with a slug and reads stars", async () => {
    const { spaces, calls } = clients((call) =>
      call.path.endsWith("/star") ? Response.json({ starred: true, starCount: 2 }) : Response.json(view()));
    await spaces.create({ name: "Docs", slug: "docs", publicRead: true });
    await spaces.update("s 1", { slug: "new", description: "x" });
    await expect(spaces.getStar("s1")).resolves.toEqual({ starCount: 2, starred: true });
    expect(calls.map(({ method, path, body }) => [method, path, body])).toEqual([
      ["POST", "/api/team-spaces", { name: "Docs", slug: "docs", publicRead: true }],
      ["PATCH", "/api/spaces/s%201", { slug: "new", description: "x" }],
      ["GET", "/api/spaces/s1/star", undefined],
    ]);
  });

  it("numbers, summaries and state filters on Worktrees", async () => {
    const { worktrees, calls } = clients((call) => {
      if (call.path.startsWith("/api/worktrees?")) return Response.json({ items: [worktree()], nextCursor: null });
      if (call.method === "POST") return Response.json(worktree());
      return Response.json({ worktree: worktree() });
    });
    await expect(worktrees.getByNumber("s 1", 4)).resolves.toMatchObject({ id: "w1", number: 4, summary: "body" });
    await worktrees.list({ view: "all", scope: "space", spaceId: "s1", states: ["merged", "discarded"] });
    await worktrees.create({ name: "PR", scope: { kind: "space", spaceId: "s1" }, summary: "why", idempotencyKey: "k" });
    await worktrees.update("w1", { summary: null });
    expect(calls.map(({ method, path, body }) => [method, path, body])).toEqual([
      ["GET", "/api/spaces/s%201/worktrees/4", undefined],
      ["GET", "/api/worktrees?scope=all&kind=team&teamSpaceId=s1&state=merged&state=discarded", undefined],
      ["POST", "/api/worktrees", { kind: "team", name: "PR", summary: "why", teamSpaceId: "s1", visibility: "private" }],
      ["PATCH", "/api/worktrees/w1", { summary: null }],
    ]);
  });
});
