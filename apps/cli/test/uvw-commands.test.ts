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
import { createLabelCommand } from "../src/features/label/command.js";
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

  it.each([
    ["Éva", ["upper"]],
    ["éva", ["lower"]],
    ["ÉVA", ["upper"]],
    ["éVA", ["lower"]],
    ["alice", ["ascii"]],
    ["@me", ["lower"]],
    [undefined, ["upper", "lower", "ascii", "legacy"]],
  ])("filters repository owner %s using ASCII-only username comparison", async (owner, expectedIds) => {
    const { repoContext } = context();
    const spaces = {
      list: async () => [
        { ...teamSpace, id: "upper", accessRole: "viewer", owner: { id: "u1", username: "Éva" } },
        { ...teamSpace, id: "lower", owner: { id: "u2", username: "éva" } },
        { ...teamSpace, id: "ascii", accessRole: "viewer", owner: { id: "u3", username: "ALIce" } },
        { ...teamSpace, id: "legacy", accessRole: "viewer", owner: undefined },
      ],
    } as unknown as WorkspaceSpaceFeature;
    const command = createRepoCommand(spaces, repoContext);

    const listed = JSON.parse(await run(command, [
      "list", ...(owner === undefined ? [] : ["--owner", owner]), "--json", "id",
    ]));

    expect(listed).toEqual(expectedIds.map((id) => ({ id })));
  });

  it.each([
    ["351 characters", "x".repeat(351)],
    ["351 characters after trimming", ` \t${"x".repeat(351)}\n`],
    ["352 UTF-16 code units", "😀".repeat(176)],
  ])("rejects a repo description of %s before any writes", async (_name, description) => {
    const { repoContext } = context();
    const create = vi.fn(async () => teamSpace);
    const update = vi.fn(async () => teamSpace);
    const command = createRepoCommand({ create, update } as unknown as WorkspaceSpaceFeature, repoContext);

    const error: unknown = await run(command, ["create", "docs", "--description", description])
      .catch((caught: unknown) => caught);

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(error).toMatchObject({
      exitCode: 1,
      message: expect.stringContaining("workspace-argument-invalid"),
    });
    expect(error).toMatchObject({ message: expect.stringContaining("at most 350 characters") });
  });

  it.each([
    ["350 characters", "x".repeat(350)],
    ["350 characters after trimming", ` \t${"x".repeat(350)}\n`],
    ["whitespace only", " \t\n "],
    ["empty", ""],
    ["350 UTF-16 code units", "😀".repeat(175)],
  ])("creates a repo with a valid %s description", async (_name, description) => {
    const { repoContext } = context();
    const create = vi.fn(async () => teamSpace);
    const update = vi.fn(async () => teamSpace);
    const command = createRepoCommand({ create, update } as unknown as WorkspaceSpaceFeature, repoContext);

    await run(command, ["create", "docs", "--description", description]);

    expect(create).toHaveBeenCalledExactlyOnceWith({ name: "docs", slug: "docs" });
    expect(update).toHaveBeenCalledExactlyOnceWith("space-1", { description });
  });

  it("creates a repo without updating an omitted description", async () => {
    const { repoContext } = context();
    const create = vi.fn(async () => teamSpace);
    const update = vi.fn(async () => teamSpace);
    const command = createRepoCommand({ create, update } as unknown as WorkspaceSpaceFeature, repoContext);

    await run(command, ["create", "docs"]);

    expect(create).toHaveBeenCalledExactlyOnceWith({ name: "docs", slug: "docs" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("uvw pr and the worktree alias", () => {
  function pullRequestCommands(options: { env?: NodeJS.ProcessEnv; ownerId?: string } = {}) {
    const { repoContext } = context(options.env);
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
    const spaces = { get: vi.fn(async (id: string) => ({
      ...teamSpace,
      id,
      owner: { id: options.ownerId ?? "u1", username: "alice" },
      type: id === "personal-1" ? "personal" : "team",
    })) };
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

  const PERSONAL_REFS: readonly (readonly [string, readonly string[], NodeJS.ProcessEnv])[] = [
    ["full name", ["-R", "alice/personal"], {}],
    ["Space ID", ["-R", "personal-1"], {}],
    ["Browser URL", ["-R", `${ORIGIN}/spaces/personal-1`], {}],
    ["environment", [], { UVW_REPO: "alice/personal" }],
  ];

  it.each([
    ["pr", "list"], ["pr", "create"], ["alias", "list"], ["alias", "create"],
  ] as const)("rejects another owner's Personal Space before %s %s reads or writes User Worktrees", async (group, verb) => {
    for (const [reference, repoArgs, env] of PERSONAL_REFS) {
      const commands = pullRequestCommands({ env, ownerId: "u2" });
      const args = [verb, ...repoArgs, ...(verb === "create" ? ["-t", "Wrong target"] : []), "--json"];
      const error = await run(commands[group], args).catch((caught: unknown) => caught);
      expect(error, reference).toMatchObject({
        exitCode: 1,
        message: expect.stringContaining("Personal Space"),
      });
      expect(commands.calls, reference).toEqual([]);
    }
  });

  it.each(PERSONAL_REFS)("preserves the signed-in owner's User Worktrees via %s", async (_reference, repoArgs, env) => {
    for (const group of ["pr", "alias"] as const) {
      const commands = pullRequestCommands({ env });
      await run(commands[group], ["list", ...repoArgs, "--json"]);
      await run(commands[group], ["create", ...repoArgs, "-t", "Mine", "--json"]);
      expect(commands.calls).toEqual([
        ["list", { limit: 30, scope: "user", view: "active" }],
        ["create", { name: "Mine", scope: { kind: "user" } }],
      ]);
    }
  });

  it("preserves Team Space scope for a user who is not its owner", async () => {
    for (const group of ["pr", "alias"] as const) {
      const commands = pullRequestCommands({ ownerId: "u2" });
      await run(commands[group], ["list", "-R", "alice/docs", "--json"]);
      await run(commands[group], ["create", "-R", "alice/docs", "-t", "Team work", "--json"]);
      expect(commands.calls).toEqual([
        ["list", { limit: 30, scope: "space", spaceId: "space-1", view: "active" }],
        ["create", { name: "Team work", scope: { kind: "space", spaceId: "space-1" } }],
      ]);
    }
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

describe("Personal pull request Browser URLs", () => {
  const personalSpace = { ...teamSpace, fullName: "alice/personal", id: "personal-1", slug: null, type: "personal" as const };
  const numberedUrl = `${ORIGIN}/spaces/personal-1/pulls/12`;
  const commands = [
    { pr: ["view"], alias: ["get"], write: false },
    { pr: ["edit"], alias: ["update"], tail: ["-t", "Edited"], write: true },
    { pr: ["ready"], alias: ["ready"], write: true },
    { pr: ["ready"], alias: ["reopen"], tail: ["--undo"], write: true },
    { pr: ["merge"], alias: ["merge"], write: true },
    { pr: ["discard"], alias: ["discard"], write: true },
  ];
  const references = [
    ["ID", ["wt-1"]],
    ["number", ["#12", "-R", "personal-1"]],
    ["number URL", [numberedUrl]],
    ["legacy URL", [`${ORIGIN}/worktrees?worktree=wt-1`]],
  ] as const;

  function personalCommands(overrides: Record<string, unknown> = {}) {
    const current = worktree({
      kind: "user", spaceId: undefined,
      units: [{ change: "added", name: "Team sheet", type: "sheet", unitId: "unit-1", target: { spaceId: "unrelated-team", parentNodeId: null } }],
      ...overrides,
    });
    const writes: string[] = [];
    const spaces = {
      get: vi.fn(async () => personalSpace),
      lookup: vi.fn(async () => personalSpace),
    };
    const worktrees = {
      create: vi.fn(async () => { writes.push("create"); return current; }),
      get: vi.fn(async () => current),
      getByNumber: vi.fn(async () => current),
      update: vi.fn(async (_id: string, input: { name?: string }) => {
        writes.push("update");
        Object.assign(current, input);
        return current;
      }),
      transition: vi.fn(async (_id: string, action: string) => {
        writes.push(action);
        current.state = ({ ready: "ready", reopen: "draft", merge: "merged", discard: "discarded" } as Record<string, string>)[action]!;
        return current;
      }),
    };
    const deps = {
      context: new RepoContext(spaces, async () => ORIGIN, {}),
      origin: async () => ORIGIN,
      spaces: spaces as unknown as WorkspaceSpaceFeature,
      userId: async () => "u1",
      worktrees: worktrees as unknown as WorkspaceWorktreeFeature,
    };
    const [pr, alias] = createPullRequestCommands(deps);
    const browse = createBrowseCommand({ ...deps, issues: {} as WorkspaceIssueFeature });
    return { alias: alias!, browse, current, pr: pr!, spaces, worktrees, writes };
  }

  function argsFor(command: (typeof commands)[number], group: "pr" | "alias", target: readonly string[]) {
    return [...command[group], ...target, ...(group === "alias" && command.alias[0] === "reopen" ? [] : command.tail ?? [])];
  }

  it.each(commands)("prints the Personal Space URL for $pr and its alias through every addressing form", async (command) => {
    for (const group of ["pr", "alias"] as const) {
      for (const [reference, target] of references) {
        const fixture = personalCommands();
        const text = await run(fixture[group], argsFor(command, group, target));
        expect(text, `${group} ${reference}`).toContain(`\n${numberedUrl}\n`);
        expect(fixture.current.spaceId).toBeUndefined();
        expect(fixture.spaces.lookup.mock.calls).toEqual(reference === "ID" || reference === "legacy URL" ? [["alice", "personal"]] : []);
      }
    }
  });

  it.each(["pr", "alias"] as const)("reuses the already resolved Personal Space for %s create before writing", async (group) => {
    for (const repo of ["personal-1", "alice/personal"]) {
      const fixture = personalCommands();
      if (repo === "personal-1") fixture.spaces.lookup.mockRejectedValue(workspaceError("workspace-not-found", "Lookup unavailable."));
      expect(await run(fixture[group], ["create", "-R", repo, "-t", "Mine"])).toContain(`\n${numberedUrl}\n`);
      expect(fixture.spaces.lookup.mock.calls).toEqual(repo === "personal-1" ? [] : [["alice", "personal"]]);
      expect(fixture.writes).toEqual(["create"]);
      expect(fixture.current.spaceId).toBeUndefined();
    }
  });

  it("browses numbered Personal PRs through every addressing form and preserves --unit", async () => {
    for (const [reference, target] of references) {
      const fixture = personalCommands();
      expect(await run(fixture.browse, [...target, "--unit", "unit-1"]), reference).toBe(`${numberedUrl}?unit=unit-1\n`);
      expect(fixture.spaces.lookup.mock.calls).toEqual(reference === "ID" || reference === "legacy URL" ? [["alice", "personal"]] : []);
    }
  });

  it.each(commands)("does not resolve links or read an ID just for JSON on $pr and its alias", async (command) => {
    for (const group of ["pr", "alias"] as const) {
      for (const fields of [[], ["id,number"]]) {
        const fixture = personalCommands();
        fixture.spaces.lookup.mockRejectedValue(workspaceError("workspace-not-found", "Lookup unavailable."));
        const json = JSON.parse(await run(fixture[group], [...argsFor(command, group, ["wt-1"]), "--json", ...fields]));
        expect(json).toMatchObject({ id: "wt-1", number: 12 });
        expect(json.spaceId).toBeUndefined();
        expect(fixture.spaces.lookup).not.toHaveBeenCalled();
        expect(fixture.worktrees.get).toHaveBeenCalledTimes(command.write ? 0 : 1);
      }
    }
  });

  it.each(commands.filter((command) => command.write))("leaves the Worktree unchanged when the pre-write link lookup fails for $pr and its alias", async (command) => {
    for (const group of ["pr", "alias"] as const) {
      for (const target of [["wt-1"], [`${ORIGIN}/worktrees?worktree=wt-1`]]) {
        const fixture = personalCommands();
        fixture.spaces.lookup.mockRejectedValue(workspaceError("workspace-not-found", "Personal Space lookup failed."));
        await expect(run(fixture[group], argsFor(command, group, target))).rejects.toMatchObject({
          exitCode: 1, message: expect.stringContaining("Personal Space lookup failed"),
        });
        expect(fixture.writes).toEqual([]);
        expect(fixture.current).toMatchObject({ name: "Add chart", state: "draft" });
      }
    }
  });

  it("does not create a PR if the initial repository lookup fails", async () => {
    for (const group of ["pr", "alias"] as const) {
      const fixture = personalCommands();
      fixture.spaces.lookup.mockRejectedValue(workspaceError("workspace-not-found", "Personal Space lookup failed."));
      await expect(run(fixture[group], ["create", "-R", "alice/personal", "-t", "Mine"])).rejects.toMatchObject({ exitCode: 1 });
      expect(fixture.writes).toEqual([]);
    }
  });

  it("rejects mismatched Personal Space lookup results before writing", async () => {
    for (const space of [teamSpace, { ...personalSpace, owner: { id: "u2", username: "alice" } }]) {
      const fixture = personalCommands();
      fixture.spaces.lookup.mockResolvedValue(space as typeof personalSpace);
      await expect(run(fixture.pr, ["discard", "wt-1"])).rejects.toMatchObject({
        exitCode: 1, message: expect.stringContaining("workspace-result-mismatch"),
      });
      expect(fixture.writes).toEqual([]);
      expect(fixture.current.state).toBe("draft");
    }
  });

  it("keeps unnumbered and older-server Worktrees on ID links without a lookup", async () => {
    for (const number of [null, undefined]) {
      for (const command of commands) {
        for (const group of ["pr", "alias"] as const) {
          const fixture = personalCommands({ number });
          fixture.spaces.lookup.mockRejectedValue(workspaceError("workspace-server-capability-missing", "Old server."));
          expect(await run(fixture[group], argsFor(command, group, ["wt-1"]))).toContain(`${ORIGIN}/worktrees?worktree=wt-1\n`);
          expect(fixture.spaces.lookup).not.toHaveBeenCalled();
        }
      }
      const fixture = personalCommands({ number });
      expect(await run(fixture.browse, ["wt-1", "--unit", "unit-1"])).toBe(`${ORIGIN}/worktrees?worktree=wt-1&unit=unit-1\n`);
      expect(fixture.spaces.lookup).not.toHaveBeenCalled();
    }
  });

  it("uses the Worktree's Team Space without looking up the creator's Personal Space", async () => {
    const fixture = personalCommands({ kind: "team", spaceId: "team-9" });
    expect(await run(fixture.pr, ["edit", "wt-1", "-t", "Team"])).toContain(`${ORIGIN}/spaces/team-9/pulls/12\n`);
    expect(await run(fixture.browse, ["wt-1"])).toBe(`${ORIGIN}/spaces/team-9/pulls/12\n`);
    expect(fixture.spaces.lookup).not.toHaveBeenCalled();
  });
});

describe("uvw search and browse", () => {
  function browseCommand() {
    const { repoContext } = context();
    const notFound = workspaceError("workspace-not-found", "Not found.", { status: 404 });
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
    return { command, issues, notFound, worktrees };
  }

  it.each(["issues", "%69ssues"])("browses an authorized Issue URL using the canonical %s route", async (route) => {
    const { command, issues, worktrees } = browseCommand();
    expect(await run(command, [`${ORIGIN}/spaces/space-1/${route}/3`])).toBe(
      `${ORIGIN}/spaces/space-1/issues/3\n`,
    );
    expect(issues.get).toHaveBeenCalledWith("space-1", 3);
    expect(worktrees.getByNumber).not.toHaveBeenCalled();
  });

  it("preserves pull and legacy Worktree URLs", async () => {
    const { command, issues } = browseCommand();
    expect(await run(command, [`${ORIGIN}/spaces/space-1/pulls/12`, "--unit", "u-1"])).toBe(
      `${ORIGIN}/spaces/space-1/pulls/12?unit=u-1\n`,
    );
    expect(await run(command, [`${ORIGIN}/worktrees?worktree=wt-1`])).toBe(
      `${ORIGIN}/worktrees?worktree=wt-1\n`,
    );
    expect(issues.get).not.toHaveBeenCalled();
  });

  it("only falls back from pull requests to Issues for bare numbers", async () => {
    const { command, issues, worktrees } = browseCommand();
    await expect(run(command, [`${ORIGIN}/spaces/space-1/pulls/3`])).rejects.toMatchObject({ exitCode: 1 });
    expect(issues.get).not.toHaveBeenCalled();
    await expect(run(command, [`${ORIGIN}/spaces/space-1/issues/12`])).rejects.toMatchObject({ exitCode: 1 });
    expect(worktrees.getByNumber).toHaveBeenCalledTimes(1);
    expect(issues.get).toHaveBeenCalledWith("space-1", 12);
    expect(await run(command, ["3", "-R", "alice/docs"])).toBe(`${ORIGIN}/spaces/space-1/issues/3\n`);
  });

  it.each(["issues/3", "pulls/12", "../../worktrees?worktree=wt-1"])(
    "rejects cross-origin %s URLs before requesting an item",
    async (path) => {
      const { command, issues, worktrees } = browseCommand();
      await expect(run(command, [`https://elsewhere.test/spaces/space-1/${path}`])).rejects.toMatchObject({
        exitCode: 1,
        message: expect.stringContaining("workspace-origin-mismatch"),
      });
      expect(issues.get).not.toHaveBeenCalled();
      expect(worktrees.get).not.toHaveBeenCalled();
      expect(worktrees.getByNumber).not.toHaveBeenCalled();
    },
  );

  it.each(["issues/3", "pulls/12"])("checks item visibility before printing a %s URL", async (path) => {
    const { command, issues, notFound, worktrees } = browseCommand();
    issues.get.mockRejectedValue(notFound);
    worktrees.getByNumber.mockRejectedValue(notFound);
    await expect(run(command, [`${ORIGIN}/spaces/space-1/${path}`])).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining("workspace-not-found"),
    });
  });

  it("keeps typed Issue and PR commands from accepting the other URL kind", async () => {
    const { repoContext } = context();
    const get = vi.fn(async () => issue());
    const getByNumber = vi.fn(async () => worktree());
    const issueCommand = createIssueCommand({
      context: repoContext,
      feature: { get } as unknown as WorkspaceIssueFeature,
      origin: async () => ORIGIN,
    });
    const [prCommand] = createPullRequestCommands({
      context: repoContext,
      origin: async () => ORIGIN,
      spaces: {} as WorkspaceSpaceFeature,
      userId: async () => "u1",
      worktrees: { getByNumber } as unknown as WorkspaceWorktreeFeature,
    });
    await expect(run(issueCommand, ["view", `${ORIGIN}/spaces/space-1/pulls/12`])).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining("does not point at an issue"),
    });
    await expect(run(prCommand!, ["view", `${ORIGIN}/spaces/space-1/issues/3`])).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining("does not point at a pull request"),
    });
    expect(get).not.toHaveBeenCalled();
    expect(getByNumber).not.toHaveBeenCalled();
  });

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
    const { command } = browseCommand();
    expect(await run(command, ["-R", "alice/docs"])).toBe(`${ORIGIN}/spaces/space-1\n`);
    expect(await run(command, ["12", "-R", "alice/docs", "--unit", "u-1"])).toBe(
      `${ORIGIN}/spaces/space-1/pulls/12?unit=u-1\n`,
    );
    expect(await run(command, ["3", "-R", "alice/docs"])).toBe(`${ORIGIN}/spaces/space-1/issues/3\n`);
    expect(await run(command, ["wt-1"])).toBe(`${ORIGIN}/worktrees?worktree=wt-1\n`);
    await expect(run(command, ["99", "-R", "alice/docs"])).rejects.toMatchObject({ exitCode: 1 });
  });
});

describe("uvw JSON validation before product writes", () => {
  const WRITES = [
    ["repo", "create", "scratch", "--description", "description"],
    ["repo", "edit", "alice/docs", "--name", "Changed"],
    ["repo", "rename", "changed", "-R", "alice/docs"],
    ["issue", "create", "-R", "alice/docs", "-t", "Title"],
    ["issue", "edit", "3", "-R", "alice/docs", "-t", "Changed"],
    ["issue", "close", "3", "-R", "alice/docs", "-c", "Closing comment"],
    ["issue", "reopen", "3", "-R", "alice/docs"],
    ["issue", "comment", "3", "-R", "alice/docs", "-b", "Comment"],
    ["label", "create", "bug", "-R", "alice/docs", "--color", "red"],
    ["label", "edit", "bug", "-R", "alice/docs", "--name", "Changed"],
    ["label", "delete", "bug", "-R", "alice/docs"],
    ["pr", "create", "-R", "alice/docs", "-t", "Title"],
    ["pr", "edit", "12", "-R", "alice/docs", "-t", "Changed"],
    ["pr", "ready", "12", "-R", "alice/docs"],
    ["pr", "ready", "12", "-R", "alice/docs", "--undo"],
    ["pr", "merge", "12", "-R", "alice/docs"],
    ["pr", "discard", "12", "-R", "alice/docs"],
    ["worktree", "create", "-R", "alice/docs", "-t", "Title"],
    ["worktree", "update", "12", "-R", "alice/docs", "-t", "Changed"],
    ["worktree", "ready", "12", "-R", "alice/docs"],
    ["worktree", "reopen", "12", "-R", "alice/docs"],
    ["worktree", "merge", "12", "-R", "alice/docs"],
    ["worktree", "discard", "12", "-R", "alice/docs"],
  ];

  function commands() {
    const { repoContext } = context();
    const writes: string[] = [];
    const write = (method: string, value: unknown) => async () => {
      writes.push(method);
      return value;
    };
    const spaces = {
      create: write("repo.create", teamSpace),
      get: async () => teamSpace,
      update: write("repo.update", teamSpace),
    } as unknown as WorkspaceSpaceFeature;
    const label = { color: "red", description: "", id: "l1", name: "bug" };
    const issues = {
      close: write("issue.close", issue()),
      comment: write("issue.comment", { id: "c1" }),
      create: write("issue.create", issue()),
      createLabel: write("label.create", label),
      deleteLabel: write("label.delete", { deleted: "bug" }),
      reopen: write("issue.reopen", issue()),
      update: write("issue.update", issue()),
      updateLabel: write("label.update", label),
    } as unknown as WorkspaceIssueFeature;
    const worktrees = {
      create: write("pr.create", worktree()),
      getByNumber: async () => worktree(),
      transition: write("pr.transition", worktree()),
      update: write("pr.update", worktree()),
    } as unknown as WorkspaceWorktreeFeature;
    const output = { stderr: "", stdout: "" };
    const configure = (command: Command) => {
      command.exitOverride().configureOutput({
        writeErr: (text) => { output.stderr += text; },
        writeOut: (text) => { output.stdout += text; },
      });
      command.commands.forEach(configure);
    };
    const program = new Command("uvw");
    for (const command of [
      createRepoCommand(spaces, repoContext),
      createIssueCommand({ context: repoContext, feature: issues, origin: async () => ORIGIN }),
      createLabelCommand(issues, repoContext),
      ...createPullRequestCommands({
        context: repoContext, origin: async () => ORIGIN, spaces, userId: async () => "u1", worktrees,
      }),
    ]) program.addCommand(command);
    configure(program);
    return { output, program, writes };
  }

  describe.each(["typo", "id,typo", "", "  , \t, ", "toString"])("--json %j", (fields) => {
    it.each(WRITES.map((args) => [args.join(" "), args] as const))(
      "rejects %s without any remote write",
      async (_description, args) => {
        const { output, program, writes } = commands();
        const error: unknown = await program.parseAsync([...args, "--json", fields], { from: "user" })
          .catch((caught: unknown) => caught);
        expect(writes).toEqual([]);
        expect(error).toMatchObject({ exitCode: 1 });
        expect(output.stdout).toBe("");
        expect(output.stderr).toContain("workspace-argument-invalid");
        expect(output.stderr).not.toMatch(/\n\s+at /u);
        if (fields.includes("typo")) expect(output.stderr).toContain("Available fields");
      },
    );
  });

  it.each(WRITES.map((args) => [args.join(" "), args] as const))(
    "preserves text, full JSON and field selections for %s",
    async (_description, args) => {
      const field = args[0] === "label" && args[1] === "delete" ? "deleted" : "id";
      for (const json of [[], ["--json"], ["--json", ` ${field}, ${field} `]]) {
        const { output, program, writes } = commands();
        await program.parseAsync([...args, ...json], { from: "user" });
        expect(writes.length).toBeGreaterThan(0);
        expect(output.stderr).toBe("");
        expect(output.stdout.trim()).not.toBe("");
        if (json.length > 0) {
          expect(JSON.parse(output.stdout)).toHaveProperty(field);
          if (json.length > 1) expect(Object.keys(JSON.parse(output.stdout))).toEqual([field]);
        }
      }
    },
  );
});

describe("uvw read command JSON field contracts", () => {
  const legacySpace = { id: "space-old", name: "Old repository" };
  const personalPr = { id: "wt-personal", name: "Personal draft", state: "draft", units: [], kind: "user" };
  const labels = [{ color: "red", description: "Bugs", id: "l1", name: "bug", openIssueCount: 4 }];
  const timeline = [{ type: "comment", id: "c1", body: "Comment" }];
  const READS = [
    { args: ["repo", "list"], value: [teamSpace, legacySpace] },
    { args: ["repo", "view", "alice/docs"], value: { ...teamSpace, starCount: 2, starred: false } },
    { args: ["issue", "list", "-R", "alice/docs"], value: [issue()] },
    { args: ["issue", "view", "3", "-R", "alice/docs"], value: issue() },
    { args: ["label", "list", "-R", "alice/docs"], value: labels },
    { args: ["pr", "list", "-R", "alice/docs"], value: [worktree(), personalPr] },
    { args: ["pr", "view", "12", "-R", "alice/docs"], value: worktree() },
    { args: ["worktree", "list", "-R", "alice/docs"], value: [worktree(), personalPr] },
    { args: ["worktree", "get", "12", "-R", "alice/docs"], value: worktree() },
    { args: ["search", "issues"], value: [issue()] },
    { args: ["search", "prs"], value: [worktree(), personalPr] },
    { args: ["browse", "-R", "alice/docs"], value: { url: `${ORIGIN}/spaces/space-1` } },
  ];

  function commands(emptyLists = false) {
    const { lookup, repoContext } = context();
    const requests: string[] = [];
    const read = (method: string, value: unknown) => async () => {
      requests.push(method);
      return value;
    };
    const spaces = {
      get: read("repo.get", teamSpace),
      getStar: read("repo.getStar", { starCount: 2, starred: false }),
      list: read("repo.list", emptyLists ? [] : [teamSpace, legacySpace]),
    } as unknown as WorkspaceSpaceFeature;
    const issues = {
      get: read("issue.get", issue()),
      labels: read("label.list", emptyLists ? [] : labels),
      list: read("issue.list", { issues: emptyLists ? [] : [issue()], nextCursor: null }),
      timeline: read("issue.timeline", timeline),
    } as unknown as WorkspaceIssueFeature;
    const worktrees = {
      get: read("pr.get", worktree()),
      getByNumber: read("pr.getByNumber", worktree()),
      list: read("pr.list", emptyLists ? [] : [worktree(), personalPr]),
    } as unknown as WorkspaceWorktreeFeature;
    const userId = read("auth.whoami", "u1") as () => Promise<string>;
    const program = new Command("uvw");
    for (const command of [
      createRepoCommand(spaces, repoContext),
      createIssueCommand({ context: repoContext, feature: issues, origin: async () => ORIGIN }),
      createLabelCommand(issues, repoContext),
      ...createPullRequestCommands({ context: repoContext, origin: async () => ORIGIN, spaces, userId, worktrees }),
      createSearchCommand(issues, worktrees, userId),
      createBrowseCommand({ context: repoContext, issues, origin: async () => ORIGIN, worktrees }),
    ]) program.addCommand(command);
    return { lookup, program, requests };
  }

  it.each(READS.map(({ args }) => [args.join(" "), args] as const))(
    "rejects invalid fields before any request for %s, even with empty results",
    async (_description, args) => {
      for (const fields of ["typo", "id,typo", "", " ,\t, ", "id, ", "toString", "__proto__", "constructor"]) {
        const { lookup, program, requests } = commands(true);
        const error: unknown = await run(program, [...args, "--json", fields])
          .catch((caught: unknown) => caught);
        expect(error, fields).toMatchObject({
          exitCode: 1,
          message: expect.stringContaining("workspace-argument-invalid"),
        });
        expect(requests, fields).toEqual([]);
        expect(lookup, fields).not.toHaveBeenCalled();
      }
    },
  );

  it.each(READS.map(({ args, value }) => [args.join(" "), args, value] as const))(
    "preserves full JSON and text for %s",
    async (_description, args, value) => {
      expect(JSON.parse(await run(commands().program, [...args, "--json"]))).toEqual(value);
      expect((await run(commands().program, args)).trim()).not.toBe("");
    },
  );

  it.each([
    ["pr", "list", "-R", "alice/docs"],
    ["worktree", "list", "-R", "alice/docs"],
    ["search", "prs"],
  ])("projects optional fields in mixed PR lists for %s %s", async (...args) => {
    expect(JSON.parse(await run(commands().program, [...args, "--json", " id, spaceId, summary, id "]))).toEqual([
      { id: "wt-1", spaceId: "space-1", summary: null },
      { id: "wt-personal" },
    ]);
  });

  it("omits absent optional fields in PR details and older repository summaries", async () => {
    expect(JSON.parse(await run(commands().program, ["pr", "view", "12", "-R", "alice/docs", "--json", "id,visibility"])))
      .toEqual({ id: "wt-1" });
    expect(JSON.parse(await run(commands().program, ["repo", "list", "--json", "id,fullName,slug"])))
      .toEqual([{ id: "space-1", fullName: "alice/docs", slug: "docs" }, { id: "space-old" }]);
  });

  it("accepts star fields only on repo view and usage counts on label list", async () => {
    expect(JSON.parse(await run(commands().program, ["repo", "view", "alice/docs", "--json", "starCount,starred"])))
      .toEqual({ starCount: 2, starred: false });
    expect(JSON.parse(await run(commands().program, ["label", "list", "-R", "alice/docs", "--json", "name,openIssueCount"])))
      .toEqual([{ name: "bug", openIssueCount: 4 }]);
    const { program, requests } = commands();
    await expect(run(program, ["repo", "list", "--json", "starCount"])).rejects.toMatchObject({ exitCode: 1 });
    expect(requests).toEqual([]);
  });

  it("accepts timeline on issue view independently of --comments", async () => {
    const args = ["issue", "view", "3", "-R", "alice/docs"];
    expect(JSON.parse(await run(commands().program, [...args, "--json", "id,timeline"]))).toEqual({ id: "i3" });
    expect(JSON.parse(await run(commands().program, [...args, "--comments", "--json", "timeline"])))
      .toEqual({ timeline });
    expect(JSON.parse(await run(commands().program, [...args, "--comments", "--json"])))
      .toEqual({ ...issue(), timeline });
  });

  it.each([["issue", "list", "-R", "alice/docs"], ["search", "issues"]])(
    "rejects detail-only fields on %s %s before requests",
    async (...args) => {
      for (const field of ["body", "capabilities", "references", "timeline"]) {
        const { lookup, program, requests } = commands();
        await expect(run(program, [...args, "--json", field])).rejects.toMatchObject({ exitCode: 1 });
        expect(requests).toEqual([]);
        expect(lookup).not.toHaveBeenCalled();
      }
    },
  );

  it("projects the Browser URL with duplicate and padded field names", async () => {
    expect(JSON.parse(await run(commands().program, ["browse", "12", "-R", "alice/docs", "--json", " url, url "])))
      .toEqual({ url: `${ORIGIN}/spaces/space-1/pulls/12` });
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

describe("malformed Browser URL errors", () => {
  it.each(["%", "%ZZ", "%C3%28"])("presents invalid path encoding %s without a stack or product requests", async (encoded) => {
    const { lookup, repoContext } = context();
    const request = vi.fn();
    const spaces = { get: request, getStar: request } as unknown as WorkspaceSpaceFeature;
    const issues = { get: request, list: request } as unknown as WorkspaceIssueFeature;
    const worktrees = { get: request, getByNumber: request } as unknown as WorkspaceWorktreeFeature;
    const program = new Command("uvw");
    for (const command of [
      createRepoCommand(spaces, repoContext),
      createIssueCommand({ context: repoContext, feature: issues, origin: async () => ORIGIN }),
      ...createPullRequestCommands({ context: repoContext, origin: async () => ORIGIN, spaces, userId: request, worktrees }),
      createBrowseCommand({ context: repoContext, issues, origin: async () => ORIGIN, worktrees }),
    ]) program.addCommand(command);
    const output = { stderr: "", stdout: "" };
    const configure = (command: Command) => {
      command.exitOverride().configureOutput({
        writeErr: (text) => { output.stderr += text; },
        writeOut: (text) => { output.stdout += text; },
      });
      command.commands.forEach(configure);
    };
    configure(program);

    for (const args of [
      ["repo", "view", `${ORIGIN}/spaces/${encoded}`],
      ["issue", "list", "-R", `${ORIGIN}/spaces/${encoded}`],
      ["issue", "view", `${ORIGIN}/spaces/space-1/issues/${encoded}`],
      ["pr", "view", `${ORIGIN}/spaces/space-1/pulls/${encoded}`],
      ["worktree", "get", `${ORIGIN}/spaces/space-1/pulls/${encoded}`],
      ["browse", `${ORIGIN}/spaces/space-1/issues/${encoded}`],
    ]) {
      output.stderr = "";
      const error: unknown = await program.parseAsync(args, { from: "user" }).catch((caught: unknown) => caught);
      expect(error, args.join(" ")).toMatchObject({ exitCode: 1 });
      expect(output.stderr).toContain("workspace-argument-invalid");
      expect(output.stderr).not.toMatch(/URIError|\n\s+at /u);
      expect(output.stdout).toBe("");
    }
    expect(request).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
});

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
