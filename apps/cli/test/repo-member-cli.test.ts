import { Command, type OutputConfiguration } from "commander";
import { describe, expect, it } from "vitest";
import { WorkspaceHttp, WorkspaceSpaceFeature } from "@univerjs/univer-workspace-client-core/product";
import { workspaceError } from "../src/errors.js";
import { createRepoCommand } from "../src/features/repo/command.js";
import { RepoContext } from "../src/repo-context.js";

const ORIGIN = "https://workspace.test";
const user = (id: string, username: string) => ({ id, username, displayName: username, avatarUrl: null });
const agentA = user("u-a", "agent-a");
const agentB = user("u-b", "agent-b");
const CEILING =
  "An unclaimed agent cannot add or be a Team Space member, and an agent can be an admin only of a Team Space an agent owns.";

function workspace(caller: "agent_claimed" | "agent_unclaimed" | "human" = "agent_claimed") {
  const members = new Map<string, unknown>();
  const writes: string[] = [];
  const error = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status });
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== "GET") writes.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/api/spaces/lookup") {
      return Response.json({ id: "space-r", name: "notes", type: "team", fullName: "agent-a/notes" });
    }
    if (url.pathname === "/api/users/search") {
      if (caller === "agent_unclaimed") return error(403, "AGENT_NOT_ALLOWED", "An unclaimed agent cannot search Users.");
      return Response.json({ users: [agentB].filter(({ username }) => username === url.searchParams.get("query")) });
    }
    if (url.pathname === "/api/team-spaces/space-r/members") {
      return Response.json({ owner: agentA, members: [...members.values()] });
    }
    const userId = /^\/api\/team-spaces\/space-r\/members\/(.+)$/u.exec(url.pathname)?.[1];
    if (userId !== undefined && request.method === "PUT") {
      const { role } = (await request.json()) as { role: string };
      if (role === "admin" && caller === "human") return error(403, "AGENT_NOT_ALLOWED", CEILING);
      const member = { user: agentB, role, grantedBy: agentA, createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z" };
      members.set(userId, member);
      return Response.json(member);
    }
    if (userId !== undefined && request.method === "DELETE") {
      members.delete(userId);
      return new Response(null, { status: 204 });
    }
    return error(404, "NOT_FOUND", "The resource was not found.");
  };
  const spaces = new WorkspaceSpaceFeature(async () =>
    new WorkspaceHttp({ cookie: "workspace_session=test", fetcher, origin: ORIGIN, role: "client" }));
  const forks = { get: async () => { throw workspaceError("NOT_FOUND", "Not found", { status: 404 }); } };
  const command = createRepoCommand(spaces, new RepoContext(spaces, forks, async () => ORIGIN, {}));
  return { command, writes };
}

describe("uvw repo member", () => {
  it("adds a claimed agent by username, lists it, changes its role and removes it", async () => {
    const { command, writes } = workspace();
    const repo = ["-R", "agent-a/notes"];
    expect(await run(command, ["member", "add", "agent-b", "--role", "viewer", ...repo])).toBe("Added agent-b as viewer\n");
    expect(await run(command, ["member", "list", ...repo])).toBe("agent-a  owner\nagent-b  viewer\n");
    expect(JSON.parse(await run(command, ["member", "edit", "agent-b", "--role", "editor", ...repo, "--json", "user,role"])))
      .toEqual({ user: { id: "u-b", username: "agent-b", displayName: "agent-b" }, role: "editor" });
    expect(JSON.parse(await run(command, ["member", "remove", "agent-b", ...repo, "--json"]))).toEqual({ removed: "agent-b" });
    expect(JSON.parse(await run(command, ["member", "list", ...repo, "--json", "members"]))).toEqual({ members: [] });
    expect(writes).toEqual([
      "PUT /api/team-spaces/space-r/members/u-b",
      "PUT /api/team-spaces/space-r/members/u-b",
      "DELETE /api/team-spaces/space-r/members/u-b",
    ]);
  });

  it.each([
    ["agent_unclaimed", ["add", "agent-b", "--role", "viewer"], "AGENT_NOT_ALLOWED: An unclaimed agent cannot add Team Space members. A person must claim it first."],
    ["human", ["add", "agent-b", "--role", "admin"], `AGENT_NOT_ALLOWED: ${CEILING}`],
    ["agent_claimed", ["add", "agent-gone", "--role", "viewer"], "workspace-not-found: No user named or identified by \"agent-gone\" can join."],
    ["agent_claimed", ["edit", "agent-b", "--role", "viewer"], "workspace-not-found: \"agent-b\" is not a member of this repository."],
    ["agent_claimed", ["add", "agent-b", "--role", "owner"], "workspace-argument-invalid"],
  ] as const)("exits 1 for a %s caller running member %s", async (caller, args, message) => {
    const { command } = workspace(caller);
    await expect(run(command, ["member", ...args, "-R", "agent-a/notes"])).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining(message),
    });
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
