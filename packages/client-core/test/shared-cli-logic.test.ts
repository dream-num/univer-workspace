import { describe, expect, it } from "vitest";
import { listIssues, resolveItemTarget, selectRepos, issueApiUsername } from "../src/product.js";
import type { WorkspaceIssueFeature, WorkspaceSpace } from "../src/product.js";

const origin = async () => "https://workspace.test";
const repo = async () => ({ spaceId: "s1" });
const space = (id: string, type: "personal" | "team", username: string, role = "viewer") =>
  ({ id, name: id, type, accessRole: role, owner: { id: username, username } }) as WorkspaceSpace;

describe("selectRepos", () => {
  const spaces = [
    space("a", "personal", "Alice", "owner"),
    space("b", "team", "bob"),
    space("c", "team", "bob"),
  ];
  it("filters by type, owner (case-folded ASCII, @me) and limit", () => {
    expect(selectRepos(spaces, { limit: 9, type: "team" }).map((s) => s.id)).toEqual(["b", "c"]);
    expect(selectRepos(spaces, { limit: 9, owner: "ALICE" }).map((s) => s.id)).toEqual(["a"]);
    expect(selectRepos(spaces, { limit: 9, owner: "@me" }).map((s) => s.id)).toEqual(["a"]);
    expect(selectRepos(spaces, { limit: 1, owner: "bob" }).map((s) => s.id)).toEqual(["b"]);
  });
});

describe("resolveItemTarget", () => {
  it("accepts numbers, matching URLs and Worktree IDs; rejects the rest", async () => {
    expect(await resolveItemTarget("#12", "issue", origin, repo)).toEqual({
      kind: "number",
      number: 12,
      spaceId: "s1",
    });
    expect(
      await resolveItemTarget("https://workspace.test/spaces/s2/issues/3", "issue", origin, repo),
    ).toEqual({ kind: "number", number: 3, spaceId: "s2" });
    expect(await resolveItemTarget("wt-1", "pr", origin, repo)).toEqual({ kind: "id", id: "wt-1" });
    await expect(resolveItemTarget("x", "issue", origin, repo)).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: 'Issue number must look like 12 or #12, got "x".',
    });
    await expect(
      resolveItemTarget("https://other.test/spaces/s2/issues/3", "issue", origin, repo),
    ).rejects.toMatchObject({ code: "workspace-origin-mismatch" });
    await expect(
      resolveItemTarget("https://workspace.test/spaces/s2/pulls/3", "issue", origin, repo),
    ).rejects.toMatchObject({
      message: '"https://workspace.test/spaces/s2/pulls/3" does not point at an issue.',
    });
  });
});

describe("listIssues", () => {
  it("follows cursors until the limit and spells @me for the API", async () => {
    const seen: unknown[] = [];
    const feature = {
      async list(input: { cursor?: string; limit?: number }) {
        seen.push(input);
        return input.cursor === undefined
          ? { issues: [{ number: 1 }, { number: 2 }], nextCursor: "n" }
          : { issues: [{ number: 3 }], nextCursor: null };
      },
    } as unknown as WorkspaceIssueFeature;
    expect((await listIssues(feature, {}, 3)).map((i) => i.number)).toEqual([1, 2, 3]);
    expect(seen).toEqual([{ limit: 3 }, { limit: 1, cursor: "n" }]);
    expect(issueApiUsername("@me")).toBe("me");
    expect(issueApiUsername("bob")).toBe("bob");
  });
});
