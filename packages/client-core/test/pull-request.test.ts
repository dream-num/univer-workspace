import { describe, expect, it, vi } from "vitest";
import {
  browseUrl,
  findPullRequest,
  listPullRequests,
  pullRequestSpace,
  pullSpaceId,
  workspaceError,
} from "../src/product.js";
import type {
  WorkspaceIssueFeature,
  WorkspaceSpace,
  WorkspaceWorktree,
  WorkspaceWorktreeFeature,
} from "../src/product.js";

const origin = async () => "https://workspace.test";
const userId = async () => "u1";
const worktree = (overrides: Partial<WorkspaceWorktree> = {}) =>
  ({ id: "wt-1", name: "PR", state: "draft", units: [], ...overrides }) as WorkspaceWorktree;
const http = (status: number) => Object.assign(new Error("x"), { detail: { status } });

describe("listPullRequests", () => {
  const list = vi.fn(async (_input: unknown) => [worktree()]);
  const deps = { userId, worktrees: { list } as Pick<WorkspaceWorktreeFeature, "list"> };

  it("scopes a Personal Space to the user and a Team Space to the space", async () => {
    await listPullRequests(deps, { space: { id: "p1", type: "personal" }, state: "open", limit: 5 });
    await listPullRequests(deps, { space: { id: "t1", type: "team" }, state: "merged", limit: 5 });
    await listPullRequests(deps, { state: "discarded", limit: 5, search: "q" });
    expect(list.mock.calls.map(([input]) => input)).toEqual([
      { scope: "user", view: "active", limit: 5 },
      { scope: "space", spaceId: "t1", view: "processed", states: ["merged"], limit: 5 },
      { view: "processed", states: ["discarded"], limit: 5, search: "q" },
    ]);
  });

  it("maps @me to the creator id and other authors to the username", async () => {
    list.mockClear();
    await listPullRequests(deps, { state: "all", limit: 1, author: "@me" });
    await listPullRequests(deps, { state: "all", limit: 1, author: "bob" });
    expect(list.mock.calls.map(([input]) => input)).toEqual([
      { view: "all", limit: 1, creatorId: "u1" },
      { view: "all", limit: 1, creatorUsername: "bob" },
    ]);
  });
});

describe("pullRequestSpace", () => {
  const spaces = (space: Partial<WorkspaceSpace>) => ({ get: async () => ({ id: "s", name: "s", ...space }) });
  it("refuses another user's Personal Space", async () => {
    await expect(
      pullRequestSpace(spaces({ type: "personal", owner: { id: "u2", username: "bob" } }), userId, "s"),
    ).rejects.toMatchObject({ code: "workspace-argument-invalid" });
    expect(
      await pullRequestSpace(spaces({ type: "personal", owner: { id: "u1", username: "me" } }), userId, "s"),
    ).toMatchObject({ id: "s" });
    expect(await pullRequestSpace(spaces({ type: "team" }), userId, "s")).toMatchObject({ id: "s" });
  });
});

describe("findPullRequest and pullSpaceId", () => {
  const worktrees = {
    get: vi.fn(async (id: string) => worktree({ id })),
    getByNumber: vi.fn(async (_spaceId: string, number: number) => worktree({ number })),
  };
  const repo = async () => ({ spaceId: "s1" });
  it("finds by number, URL and Worktree ID", async () => {
    expect(await findPullRequest(worktrees, "#4", origin, repo)).toMatchObject({ spaceId: "s1", worktree: { number: 4 } });
    expect(
      await findPullRequest(worktrees, "https://workspace.test/spaces/s2/pulls/9", origin, repo),
    ).toMatchObject({ spaceId: "s2", worktree: { number: 9 } });
    expect(await findPullRequest(worktrees, "wt-7", origin, repo)).toEqual({ worktree: worktree({ id: "wt-7" }) });
  });

  it("uses the creator's Personal Space and rejects one owned by someone else", async () => {
    const user = worktree({ number: 3, kind: "user", creator: { id: "u1", username: "me" } });
    const lookup = (owner: string) => async () =>
      ({ id: "p1", name: "p", type: "personal", owner: { id: owner, username: "me" } }) as WorkspaceSpace;
    expect(await pullSpaceId({ lookup: lookup("u1") }, user)).toBe("p1");
    await expect(pullSpaceId({ lookup: lookup("u2") }, user)).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
    expect(await pullSpaceId({ lookup: lookup("u2") }, worktree({ number: 3, spaceId: "t1" }))).toBe("t1");
    expect(await pullSpaceId({ lookup: lookup("u2") }, worktree({ number: null }))).toBeUndefined();
  });
});

describe("browseUrl", () => {
  const make = (pr: () => Promise<WorkspaceWorktree>, issue: () => Promise<unknown>) => ({
    issues: { get: issue } as unknown as Pick<WorkspaceIssueFeature, "get">,
    origin,
    pullSpaceId: async () => "p1",
    repo: async () => ({ spaceId: "s1" }),
    worktrees: { get: async () => worktree({ number: 2 }), getByNumber: pr },
  });
  const found = async () => worktree({ number: 5 });
  const missing = async () => {
    throw http(404);
  };

  it("prints the repository, pull request and Issue URLs", async () => {
    expect(await browseUrl(make(found, missing), {})).toEqual({ url: "https://workspace.test/spaces/s1" });
    expect(await browseUrl(make(found, missing), { argument: "5", unit: "u" })).toEqual({
      url: "https://workspace.test/spaces/s1/pulls/5?unit=u",
    });
    expect(await browseUrl(make(missing, async () => ({})), { argument: "#5" })).toEqual({
      url: "https://workspace.test/spaces/s1/issues/5",
    });
    expect(await browseUrl(make(found, missing), { argument: "wt-1" })).toEqual({
      url: "https://workspace.test/spaces/p1/pulls/2",
    });
  });

  it("maps a 404 or 409 on both sides to workspace-not-found and keeps other errors", async () => {
    const conflict = async () => {
      throw http(409);
    };
    for (const issue of [missing, conflict]) {
      await expect(browseUrl(make(missing, issue), { argument: "5" })).rejects.toMatchObject({
        code: "workspace-not-found",
        message: "No Issue or pull request #5 in this repository.",
      });
    }
    const boom = workspaceError("workspace-forbidden", "no");
    await expect(browseUrl(make(async () => Promise.reject(boom), missing), { argument: "5" })).rejects.toBe(boom);
    await expect(browseUrl(make(found, missing), { unit: "u" })).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
  });
});
