import { Command, type OutputConfiguration } from "commander";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceFork,
  WorkspaceSpaceFeature,
  WorkspaceUnitFeature,
} from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "../src/errors.js";
import { createForkCommand } from "../src/features/fork/command.js";
import { createRepoCommand } from "../src/features/repo/command.js";
import { createSpaceCommand } from "../src/features/space/command.js";
import { createUnitCommand } from "../src/features/unit/command.js";
import { RepoContext } from "../src/repo-context.js";

const ORIGIN = "https://workspace.test";
const UPSTREAM = { fullName: "hana/team", id: "space-1", name: "Team", type: "team" as const };
const FORK: WorkspaceFork = {
  createdAt: "2026-11-23T00:00:00.000Z",
  fullName: "agent/fix",
  id: "fork-1",
  name: "fix",
  owner: { id: "a1", username: "agent" },
  state: "drafting",
  upstream: UPSTREAM,
  worktree: { id: "wt-1", name: "fix", number: 7, spaceId: "space-1", state: "draft" },
};
const notFound = () => workspaceError("NOT_FOUND", "Not found", { status: 404 });

function setup() {
  const spaces = {
    browse: vi.fn(async () => []),
    createNode: vi.fn(),
    find: vi.fn(async () => []),
    get: vi.fn(async () => UPSTREAM),
    list: vi.fn(async () => []),
    lookup: vi.fn(async (owner: string) => {
      if (owner === "hana") return UPSTREAM;
      throw notFound();
    }),
    update: vi.fn(),
  };
  const forks = {
    addUnit: vi.fn(async () => ({ unitId: "unit-1", worktreeId: "wt-1" })),
    create: vi.fn(async () => FORK),
    createUnit: vi.fn(async () => ({ unitId: "unit-2", worktreeId: "wt-1" })),
    delete: vi.fn(async () => ({ fork: FORK, worktree: FORK.worktree })),
    get: vi.fn(async (reference: string) => {
      if (reference === "agent/fix") return FORK;
      throw notFound();
    }),
    list: vi.fn(async () => [FORK]),
    listing: vi.fn(async () => ({ overlay: { accessRole: "editor" as const, worktree: { ...FORK.worktree!, units: [] } }, spaceId: "space-1" })),
    units: vi.fn(async () => []),
  };
  const units = { add: vi.fn(), create: vi.fn(), list: vi.fn() };
  const context = new RepoContext(spaces, forks, async () => ORIGIN, {});
  return {
    forkCommand: createForkCommand(forks as never, context),
    forks,
    repoCommand: createRepoCommand(spaces as unknown as WorkspaceSpaceFeature, context),
    spaceCommand: createSpaceCommand(spaces as unknown as WorkspaceSpaceFeature, context, forks),
    spaces,
    unitCommand: createUnitCommand(units as unknown as WorkspaceUnitFeature, forks as never, context, async () => ORIGIN),
    units,
  };
}

describe("uvw forks", () => {
  it("refuses a fork address where a repository's Trunk would change", async () => {
    const { repoCommand, spaceCommand, spaces } = setup();
    for (const [command, args] of [
      [repoCommand, ["edit", "agent/fix", "--name", "Other"]],
      [spaceCommand, ["node", "create", "agent/fix", "--name", "Plans"]],
    ] as const) {
      await expect(run(command, args)).rejects.toMatchObject({
        exitCode: 1,
        message: expect.stringContaining(
          "agent/fix is a fork of hana/team, not a repository. Pass it as --worktree to read and write its files and list them with `uvw space browse agent/fix`, and its pull request is #7 in hana/team.",
        ),
      });
    }
    expect(spaces.update).not.toHaveBeenCalled();
    expect(spaces.createNode).not.toHaveBeenCalled();
  });

  it("keeps a plain not-found for an address that is neither a repository nor a fork", async () => {
    const { repoCommand } = setup();
    await expect(run(repoCommand, ["edit", "agent/none", "--name", "Other"])).rejects.toMatchObject({
      message: expect.stringContaining("NOT_FOUND: Not found"),
    });
  });

  it("browses and finds a fork as its upstream with the fork's changes", async () => {
    const { forks, spaceCommand, spaces } = setup();
    await run(spaceCommand, ["browse", "agent/fix", "--recursive"]);
    await run(spaceCommand, ["find", "Budget", "--space", "agent/fix"]);
    await run(spaceCommand, ["browse", "hana/team"]);
    expect(forks.listing).toHaveBeenCalledWith(FORK);
    const overlay = { accessRole: "editor", worktree: expect.objectContaining({ id: "wt-1" }) };
    expect(spaces.browse.mock.calls).toEqual([
      [{ overlay, recursive: true, spaceId: "space-1" }],
      [{ spaceId: "space-1" }],
    ]);
    expect(spaces.find).toHaveBeenCalledWith({ overlay, query: "Budget", spaceId: "space-1" });
  });

  it("lists, adds and creates Units through a fork address and keeps Worktree IDs on the Worktree routes", async () => {
    const { forks, unitCommand, units } = setup();
    await run(unitCommand, ["list", "--worktree", "agent/fix"]);
    await run(unitCommand, ["add", "--worktree", "agent/fix", "--resource", "resource-1"]);
    await run(unitCommand, ["create", "--worktree", "agent/fix", "--space", "agent/fix", "--type", "doc", "--name", "Notes"]);
    await run(unitCommand, ["create", "--worktree", "agent/fix", "--space", "hana/team", "--type", "doc", "--name", "Notes", "--parent", "dir-1"]);
    await run(unitCommand, ["add", "--worktree", "wt-9", "--resource", "resource-1"]);
    expect(forks.units).toHaveBeenCalledWith("agent/fix");
    expect(forks.addUnit).toHaveBeenCalledWith("agent/fix", "resource-1");
    expect(forks.createUnit.mock.calls).toEqual([
      ["agent/fix", { name: "Notes", spaceId: "space-1", type: "doc" }],
      ["agent/fix", { name: "Notes", parentNodeId: "dir-1", spaceId: "space-1", type: "doc" }],
    ]);
    expect(units.add).toHaveBeenCalledWith("wt-9", "resource-1");
    expect(units.list).not.toHaveBeenCalled();
    expect(units.create).not.toHaveBeenCalled();
    await expect(
      run(unitCommand, ["create", "--worktree", "agent/fix", "--space", "hana/team", "--type", "doc", "--name", "Copy", "--from", "node-1"]),
    ).rejects.toMatchObject({ message: expect.stringContaining("--from needs a Worktree ID") });
  });

  it("creates, lists, shows and deletes forks, naming the upstream and the pull request", async () => {
    const { forkCommand, forks } = setup();
    expect(await run(forkCommand, ["create", "hana/team", "--name", "fix"])).toBe("agent/fix\n");
    expect(forks.create).toHaveBeenCalledWith({ name: "fix", upstreamSpaceId: "space-1" });
    expect(await run(forkCommand, ["list"])).toBe("agent/fix  hana/team  drafting  #7\n");
    expect(await run(forkCommand, ["view", "agent/fix"])).toBe(
      [
        "agent/fix  fork of hana/team",
        "state: drafting",
        "id: fork-1",
        "pull request: #7 in hana/team (uvw pr view 7 -R hana/team)",
        "",
      ].join("\n"),
    );
    expect(JSON.parse(await run(forkCommand, ["view", "agent/fix", "--json", "upstream,worktree"]))).toEqual({
      upstream: UPSTREAM,
      worktree: FORK.worktree,
    });
    expect(await run(forkCommand, ["delete", "agent/fix"])).toBe("Deleted agent/fix; pull request #7 stays in hana/team\n");
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
