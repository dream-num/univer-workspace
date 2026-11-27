import { describe, expect, it } from "vitest";
import { WorkspaceHttp, WorkspaceSpaceFeature } from "../src/index.js";

const user = (id: string, username: string) => ({ id, username, displayName: username, avatarUrl: null });
const owner = user("u-a", "agent-a");
const claimed = user("u-b", "agent-b");
const stopped = user("u-s", "agent-stopped");
const fullCapabilities = {
  browseRoot: true,
  createAtRoot: true,
  renameSpace: true,
  manageMembers: true,
  viewTrash: true,
  createIssue: true,
  triageIssues: true,
  manageIssueLabels: true,
  propose: true,
};

function workspace(options: { readonly caller?: "agent_unclaimed"; readonly refuse?: { code: string; message: string } } = {}) {
  const members = new Map([[stopped.id, membership(stopped, "editor")]]);
  const requests: string[] = [];
  const error = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status });
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/users/search") {
      if (options.caller === "agent_unclaimed") return error(403, "AGENT_NOT_ALLOWED", "An unclaimed agent cannot search Users.");
      const query = url.searchParams.get("query")!;
      return Response.json({
        users: [claimed].filter(({ id, username }) => id === query || username.includes(query.toLowerCase())),
      });
    }
    if (url.pathname === "/api/team-spaces/space-r/members") {
      return Response.json({ owner, members: [...members.values()] });
    }
    const userId = /^\/api\/team-spaces\/space-r\/members\/(.+)$/u.exec(url.pathname)?.[1];
    if (userId !== undefined && request.method === "PUT") {
      if (options.refuse) return error(403, options.refuse.code, options.refuse.message);
      const { role } = (await request.json()) as { role: string };
      const member = membership([claimed, stopped].find(({ id }) => id === userId)!, role);
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
    new WorkspaceHttp({ cookie: "workspace_session=test", fetcher, origin: "https://workspace.test", role: "client" }));
  return { requests, spaces };
}

function membership(member: ReturnType<typeof user>, role: string) {
  return { user: member, role, grantedBy: owner, createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z" };
}

const view = ({ avatarUrl: _avatarUrl, ...rest }: ReturnType<typeof user>) => rest;

describe("Team Space members", () => {
  it("lists the owner apart from the members", async () => {
    await expect(workspace().spaces.members("space-r")).resolves.toEqual({
      owner: view(owner),
      members: [{ ...membership(stopped, "editor"), user: view(stopped), grantedBy: view(owner) }],
    });
  });

  it("adds a claimed agent found by its username, then changes its role and removes it", async () => {
    const { requests, spaces } = workspace();
    await expect(spaces.addMember("space-r", "Agent-B", "viewer")).resolves.toMatchObject({
      user: view(claimed),
      role: "viewer",
    });
    await expect(spaces.editMember("space-r", "agent-b", "admin")).resolves.toMatchObject({ role: "admin" });
    await expect(spaces.removeMember("space-r", "agent-b")).resolves.toEqual({ removed: "agent-b" });
    await expect(spaces.members("space-r")).resolves.toMatchObject({ members: [{ user: { username: "agent-stopped" } }] });
    expect(requests.filter((request) => !request.startsWith("GET"))).toEqual([
      "PUT /api/team-spaces/space-r/members/u-b",
      "PUT /api/team-spaces/space-r/members/u-b",
      "DELETE /api/team-spaces/space-r/members/u-b",
    ]);
  });

  it("finds a member to edit or remove in the member list, so a stopped agent can still be removed", async () => {
    const { spaces } = workspace();
    await expect(spaces.removeMember("space-r", "agent-stopped")).resolves.toEqual({ removed: "agent-stopped" });
  });

  it("refuses a user search cannot find, and a role change for someone who is not a member, without writing", async () => {
    const { requests, spaces } = workspace();
    await expect(spaces.addMember("space-r", "agent-unclaimed", "viewer")).rejects.toMatchObject({
      code: "workspace-not-found",
      message: expect.stringContaining("Unclaimed and stopped agents cannot be members"),
    });
    await expect(spaces.editMember("space-r", "agent-b", "editor")).rejects.toMatchObject({
      code: "workspace-not-found",
      message: '"agent-b" is not a member of this repository.',
    });
    await expect(spaces.removeMember("space-r", "agent-a")).rejects.toMatchObject({ code: "workspace-not-found" });
    expect(requests.filter((request) => !request.startsWith("GET"))).toEqual([]);
  });

  it("says an unclaimed agent cannot add members when the server refuses it the user search", async () => {
    const { requests, spaces } = workspace({ caller: "agent_unclaimed" });
    await expect(spaces.addMember("space-r", "agent-b", "viewer")).rejects.toMatchObject({
      code: "AGENT_NOT_ALLOWED",
      message: "An unclaimed agent cannot add Team Space members. Give the user your handoff link from claim (uvw claim in the CLI). Once they take you, try again.",
    });
    expect(requests.filter((request) => !request.startsWith("GET"))).toEqual([]);
  });

  it("passes the server's member ceiling refusal through unchanged", async () => {
    const refuse = {
      code: "AGENT_NOT_ALLOWED",
      message: "An unclaimed agent cannot add or be a Team Space member, and an agent can be an admin only of a Team Space an agent owns.",
    };
    await expect(workspace({ refuse }).spaces.addMember("space-r", "agent-b", "admin")).rejects.toMatchObject(refuse);
  });
});

describe("Space capabilities and proposals", () => {
  const spaceWith = async (capabilities: unknown, fields: Record<string, unknown> = {}) =>
    await new WorkspaceSpaceFeature(async () =>
      new WorkspaceHttp({
        cookie: "workspace_session=test",
        fetcher: async () => Response.json({ id: "space-r", name: "R", capabilities, ...fields }),
        origin: "https://workspace.test",
        role: "client",
      })).get("space-r");

  it("keeps a known proposals setting and drops an unknown one", async () => {
    await expect(spaceWith(fullCapabilities, { proposals: "accountable" })).resolves.toMatchObject({
      proposals: "accountable",
      capabilities: { propose: true },
    });
    await expect(spaceWith(fullCapabilities, { proposals: "everyone" })).resolves.not.toHaveProperty("proposals");
  });

  it("reports what the caller may do, manageMembers included", async () => {
    await expect(spaceWith({ ...fullCapabilities, manageMembers: false, future: true })).resolves.toEqual({
      id: "space-r",
      name: "R",
      capabilities: { ...fullCapabilities, manageMembers: false },
    });
  });

  it("leaves capabilities out when the server does not report all of them", async () => {
    const { manageIssueLabels: _missing, ...older } = fullCapabilities;
    await expect(spaceWith(older)).resolves.toEqual({ id: "space-r", name: "R" });
  });
});
