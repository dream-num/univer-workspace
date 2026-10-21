import { Command, type OutputConfiguration } from "commander";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceIssueFeature,
  WorkspaceSpaceFeature,
  WorkspaceWorktreeFeature,
} from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "../src/errors.js";
import { createBrowseCommand } from "../src/features/browse/command.js";
import { createIssueCommand } from "../src/features/issue/command.js";
import { createPullRequestCommands } from "../src/features/pr/command.js";
import { createRepoCommand } from "../src/features/repo/command.js";
import { createSearchCommand } from "../src/features/search/command.js";
import { RepoContext } from "../src/repo-context.js";

const ORIGIN = "https://workspace.test";
const teamSpace = {
  accessRole: "owner" as const,
  fullName: "alice/docs",
  id: "space-1",
  name: "Docs",
  owner: { id: "u1", username: "alice" },
  publicRead: false,
  slug: "docs",
  type: "team" as const,
};
const worktree = (overrides: Record<string, unknown> = {}) => ({
  createdAt: "2026-10-01T00:00:00.000Z",
  creator: { id: "u1", username: "alice" },
  id: "wt-1",
  name: "Add chart",
  number: 12,
  spaceId: "space-1",
  state: "draft",
  summary: null,
  units: [],
  updatedAt: "2026-10-02T00:00:00.000Z",
  ...overrides,
});
const issue = (overrides: Record<string, unknown> = {}) => ({
  assignees: [],
  author: { displayName: "A", id: "u1", username: "alice" },
  body: "text",
  capabilities: { close: true, comment: true, edit: true, triage: true },
  closedAt: null,
  closedBy: null,
  commentCount: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  id: "i3",
  labels: [],
  number: 3,
  referenceCount: 0,
  references: [],
  space: { id: "space-1", name: "Docs" },
  state: "open",
  stateReason: null,
  title: "Third",
  updatedAt: "2026-10-02T00:00:00.000Z",
  ...overrides,
});

function context(env: NodeJS.ProcessEnv = {}) {
  const lookup = vi.fn(async (owner: string, slug: string) => ({
    ...teamSpace,
    id: slug === "personal" ? "personal-1" : "space-1",
    name: `${owner}/${slug}`,
  }));
  return { lookup, repoContext: new RepoContext({ lookup }, async () => ORIGIN, env) };
}

describe("uvw repository and Issue commands", () => {
  it("resolves -R and UVW_REPO to a Space and numbers like 12, #12 and URLs", async () => {
    const { lookup, repoContext } = context({ UVW_REPO: "alice/docs" });
    const get = vi.fn(async () => issue());
    const feature = { get, timeline: vi.fn(async () => []) } as unknown as WorkspaceIssueFeature;
    const command = createIssueCommand({ context: repoContext, feature, origin: async () => ORIGIN });

    await run(command, ["view", "#3"]);
    await run(command, ["view", "3", "-R", "bob/other"]);
    await run(command, ["view", `${ORIGIN}/spaces/space-9/issues/7`]);
    expect(lookup.mock.calls).toEqual([["alice", "docs"], ["bob", "other"]]);
    expect(get.mock.calls).toEqual([["space-1", 3], ["space-1", 3], ["space-9", 7]]);

    await expect(run(command, ["view", "abc"])).rejects.toMatchObject({ exitCode: 1 });
    await expect(run(command, ["view", `https://elsewhere.test/spaces/s/issues/1`])).rejects.toMatchObject({
      exitCode: 1,
    });
  });

  it("exits 4 and points at `uvw auth login` when sign-in is required", async () => {
    const { repoContext } = context();
    const command = createIssueCommand({
      context: repoContext,
      feature: {
        list: async () => {
          throw workspaceError("workspace-authentication-required", "No session.");
        },
      } as unknown as WorkspaceIssueFeature,
      origin: async () => ORIGIN,
    });
    const error = await run(command, ["list", "-R", "alice/docs"]).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ exitCode: 4, message: expect.stringContaining("uvw auth login") });
  });

  it("requires a repository when neither -R nor UVW_REPO is set", async () => {
    const { repoContext } = context();
    const list = vi.fn();
    const command = createIssueCommand({
      context: repoContext,
      feature: { list } as unknown as WorkspaceIssueFeature,
      origin: async () => ORIGIN,
    });
    const error = await run(command, ["list"]).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ exitCode: 1, message: expect.stringContaining("UVW_REPO") });
    expect(list).not.toHaveBeenCalled();
  });

  it("maps gh spellings onto the Issue feature and writes bare JSON", async () => {
    const { repoContext } = context();
    const list = vi.fn(async () => ({ counts: { closed: 0, open: 1 }, issues: [issue()], nextCursor: null }));
    const close = vi.fn(async () => issue({ state: "closed", stateReason: "not_planned" }));
    const comment = vi.fn(async () => ({ id: "c1" }));
    const command = createIssueCommand({
      context: repoContext,
      feature: { close, comment, list } as unknown as WorkspaceIssueFeature,
      origin: async () => ORIGIN,
    });

    const listed = await run(command, ["list", "-R", "alice/docs", "-a", "@me", "-A", "bob", "-l", "bug", "-S", "x", "-L", "5", "--json"]);
    expect(list).toHaveBeenCalledWith({
      assignee: "me", author: "bob", labels: ["bug"], limit: 5, search: "x", spaceId: "space-1", state: "open",
    });
    expect(JSON.parse(listed)).toMatchObject([{ number: 3, title: "Third" }]);
    expect(JSON.parse(await run(command, ["list", "-R", "alice/docs", "--json", "number,state"]))).toEqual([
      { number: 3, state: "open" },
    ]);
    await expect(run(command, ["list", "-R", "alice/docs", "--json", "nope"])).rejects.toMatchObject({
      message: expect.stringContaining("Available fields"),
    });

    const closed = await run(command, ["close", "3", "-R", "alice/docs", "-r", "not planned", "-c", "bye", "--json"]);
    expect(close).toHaveBeenCalledWith("space-1", 3, { comment: "bye", reason: "not_planned" });
    expect(JSON.parse(closed)).toMatchObject({ number: 3, state: "closed" });
    expect(await run(command, ["close", "3", "-R", "alice/docs"])).toContain(`${ORIGIN}/spaces/space-1/issues/3`);

    await run(command, ["comment", "3", "-R", "alice/docs", "-b", "hello"]);
    expect(comment).toHaveBeenCalledWith("space-1", 3, "hello");
  });

  it("lists, creates, renames and views repositories by owner/slug", async () => {
    const { lookup, repoContext } = context();
    const create = vi.fn(async () => teamSpace);
    const update = vi.fn(async () => ({ ...teamSpace, slug: "new" }));
    const list = vi.fn(async () => [teamSpace, { ...teamSpace, fullName: "alice/personal", id: "p", type: "personal" }]);
    const spaces = {
      create,
      get: vi.fn(async () => teamSpace),
      getStar: vi.fn(async () => ({ starCount: 2, starred: false })),
      list,
      update,
    } as unknown as WorkspaceSpaceFeature;
    const command = createRepoCommand(spaces, repoContext);

    expect(JSON.parse(await run(command, ["list", "--type", "team", "--json", "fullName"]))).toEqual([
      { fullName: "alice/docs" },
    ]);
    await run(command, ["create", "docs", "--name", "Docs", "--description", "d", "--public"]);
    expect(create).toHaveBeenCalledWith({ name: "Docs", publicRead: true, slug: "docs" });
    expect(update).toHaveBeenCalledWith("space-1", { description: "d" });
    await run(command, ["rename", "new", "-R", "alice/docs"]);
    expect(lookup).toHaveBeenCalledWith("alice", "docs");
    expect(update).toHaveBeenLastCalledWith("space-1", { slug: "new" });
    expect(JSON.parse(await run(command, ["view", "alice/docs", "--json"]))).toMatchObject({
      fullName: "alice/docs", starCount: 2,
    });
  });
});

describe("uvw pr and the worktree alias", () => {
  function pullRequestCommands() {
    const { repoContext } = context();
    const calls: [string, ...unknown[]][] = [];
    const record = (name: string, result: unknown) =>
      vi.fn(async (...args: unknown[]) => {
        calls.push([name, ...args]);
        return result;
      });
    const worktrees = {
      create: record("create", worktree()),
      get: record("get", worktree()),
      getByNumber: record("getByNumber", worktree()),
      list: record("list", [worktree()]),
      transition: record("transition", worktree({ state: "ready" })),
      update: record("update", worktree({ name: "New" })),
    } as unknown as WorkspaceWorktreeFeature;
    const spaces = { get: vi.fn(async (id: string) => ({ ...teamSpace, id, type: id === "personal-1" ? "personal" : "team" })) };
    const [pr, alias] = createPullRequestCommands({
      context: repoContext,
      origin: async () => ORIGIN,
      spaces: spaces as unknown as WorkspaceSpaceFeature,
      userId: async () => "u1",
      worktrees,
    });
    return { alias: alias!, calls, pr: pr! };
  }

  // [pr arguments, equivalent worktree arguments]
  const PAIRS: readonly (readonly [string[], string[]])[] = [
    [["list", "-R", "alice/docs", "-s", "merged", "-L", "3", "--json"], ["list", "-R", "alice/docs", "-s", "merged", "-L", "3", "--json"]],
    [["list", "-R", "alice/docs", "-A", "@me", "--json"], ["list", "-R", "alice/docs", "-A", "@me", "--json"]],
    [["view", "12", "-R", "alice/docs", "--json"], ["get", "12", "-R", "alice/docs", "--json"]],
    [["view", "wt-1", "--json"], ["get", "wt-1", "--json"]],
    [["view", `${ORIGIN}/worktrees?worktree=wt-1`, "--json"], ["get", `${ORIGIN}/worktrees?worktree=wt-1`, "--json"]],
    [["create", "-R", "alice/docs", "-t", "T", "-b", "B", "--visibility", "space", "--idempotency-key", "k"], ["create", "-R", "alice/docs", "-t", "T", "-b", "B", "--visibility", "space", "--idempotency-key", "k"]],
    [["create", "-R", "alice/personal", "-t", "T", "--json"], ["create", "-R", "alice/personal", "-t", "T", "--json"]],
    [["edit", "12", "-R", "alice/docs", "-t", "New", "--visibility", "private"], ["update", "12", "-R", "alice/docs", "-t", "New", "--visibility", "private"]],
    [["ready", "12", "-R", "alice/docs"], ["ready", "12", "-R", "alice/docs"]],
    [["ready", "12", "-R", "alice/docs", "--undo"], ["reopen", "12", "-R", "alice/docs"]],
    [["merge", "12", "-R", "alice/docs"], ["merge", "12", "-R", "alice/docs"]],
    [["discard", "12", "-R", "alice/docs"], ["discard", "12", "-R", "alice/docs"]],
  ];

  it.each(PAIRS)("runs `pr %s` and its worktree spelling identically", async (prArgs, worktreeArgs) => {
    const viaPr = pullRequestCommands();
    const viaWorktree = pullRequestCommands();
    const prOutput = await run(viaPr.pr, prArgs);
    const worktreeOutput = await run(viaWorktree.alias, worktreeArgs);
    expect(viaWorktree.calls).toEqual(viaPr.calls);
    expect(worktreeOutput).toBe(prOutput);
    expect(viaPr.calls.length).toBeGreaterThan(0);
  });

  it("addresses by number, maps lifecycle verbs and treats owner/personal as User Worktrees", async () => {
    const { calls, pr } = pullRequestCommands();
    await run(pr, ["view", "12", "-R", "alice/docs"]);
    await run(pr, ["list", "-R", "alice/docs", "-s", "discarded"]);
    await run(pr, ["list", "-R", "alice/personal"]);
    await run(pr, ["create", "-R", "alice/personal", "-t", "Mine", "-b", "body"]);
    await run(pr, ["ready", "#12", "-R", "alice/docs", "--undo"]);
    expect(calls).toEqual([
      ["getByNumber", "space-1", 12],
      ["list", { limit: 30, scope: "space", spaceId: "space-1", states: ["discarded"], view: "processed" }],
      ["list", { limit: 30, scope: "user", view: "active" }],
      ["create", { name: "Mine", scope: { kind: "user" }, summary: "body" }],
      ["getByNumber", "space-1", 12],
      ["transition", "wt-1", "reopen"],
    ]);
  });

  it("answers gh's close and reopen with an explanation instead of guessing", async () => {
    const { alias, calls, pr } = pullRequestCommands();
    for (const verb of ["close", "reopen"]) {
      const error = await run(pr, [verb, "12", "--whatever"]).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ exitCode: 1, message: expect.stringContaining("uvw pr discard") });
    }
    expect(calls).toEqual([]);
    expect(pr.commands.filter((command) => command.name() === "close" || command.name() === "reopen")).toHaveLength(2);
    // The worktree group has its own reopen (Ready -> Draft) and no close.
    expect(alias.commands.map((command) => command.name())).toContain("reopen");
    expect(alias.commands.map((command) => command.name())).not.toContain("close");
    expect(pr.helpInformation()).not.toMatch(/\bclose\b/u);
  });
});

describe("uvw search and browse", () => {
  it("searches across repositories without a repository context", async () => {
    const issues = { list: vi.fn(async () => ({ counts: { closed: 0, open: 1 }, issues: [issue()], nextCursor: null })) };
    const worktrees = { list: vi.fn(async () => [worktree()]) };
    const command = createSearchCommand(
      issues as unknown as WorkspaceIssueFeature,
      worktrees as unknown as WorkspaceWorktreeFeature,
      async () => "u1",
    );
    await run(command, ["issues", "-a", "@me", "-s", "all"]);
    await run(command, ["prs", "-A", "@me", "-s", "merged"]);
    expect(issues.list).toHaveBeenCalledWith({ assignee: "me", limit: 30, state: "all" });
    expect(worktrees.list).toHaveBeenCalledWith({
      creatorId: "u1", limit: 30, states: ["merged"], view: "processed",
    });
  });

  it("prints the repository, pull request or Issue URL without opening anything", async () => {
    const { repoContext } = context();
    const notFound = Object.assign(new Error("not found"), { code: "NOT_FOUND", detail: { status: 404 } });
    const worktrees = {
      get: vi.fn(async () => worktree({ number: null, spaceId: undefined })),
      getByNumber: vi.fn(async (_space: string, number: number) => {
        if (number === 12) return worktree();
        throw notFound;
      }),
    };
    const issues = { get: vi.fn(async (_space: string, number: number) => {
      if (number === 3) return issue();
      throw notFound;
    }) };
    const command = createBrowseCommand({
      context: repoContext,
      issues: issues as unknown as WorkspaceIssueFeature,
      origin: async () => ORIGIN,
      worktrees: worktrees as unknown as WorkspaceWorktreeFeature,
    });
    expect(await run(command, ["-R", "alice/docs"])).toBe(`${ORIGIN}/spaces/space-1\n`);
    expect(await run(command, ["12", "-R", "alice/docs", "--unit", "u-1"])).toBe(
      `${ORIGIN}/spaces/space-1/pulls/12?unit=u-1\n`,
    );
    expect(await run(command, ["3", "-R", "alice/docs"])).toBe(`${ORIGIN}/spaces/space-1/issues/3\n`);
    expect(await run(command, ["wt-1"])).toBe(`${ORIGIN}/worktrees?worktree=wt-1\n`);
    await expect(run(command, ["99", "-R", "alice/docs"])).rejects.toMatchObject({ exitCode: 1 });
  });
});

async function run(command: Command, args: readonly string[]): Promise<string> {
  let output = "";
  const configuration: OutputConfiguration = {
    writeErr: (text) => {
      output += text;
    },
    writeOut: (text) => {
      output += text;
    },
  };
  const configure = (target: Command) => {
    target.configureOutput(configuration).exitOverride();
    target.commands.forEach(configure);
  };
  configure(command);
  const program = new Command("uvw");
  configure(program);
  program.addCommand(command);
  await program.parseAsync([command.name(), ...args], { from: "user" });
  return output;
}

describe("uvw startup", () => {
  it("keeps the product commands off the Univer runtime", async () => {
    const { readFile } = await import("node:fs/promises");
    const files = [
      "command.ts", "errors.ts", "repo-context.ts", "product-commands.ts", "transport/http.ts",
      "features/auth/command.ts", "features/auth/session.ts", "features/browse/command.ts",
      "features/issue/command.ts", "features/label/command.ts", "features/pr/command.ts",
      "features/repo/command.ts", "features/search/command.ts",
    ];
    for (const file of files) {
      const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/from "@univerjs\/univer-workspace-client-core"/u);
    }
  });
});
