import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import { testStagingDirectory } from "./staging-directory.js";
import { toolError } from "./tool-error.js";
import { parseGatewayConfig } from "../src/shared/config.js";

const origin = "https://workspace.example";
const user = (id: string, username: string) => ({ id, username, displayName: username, avatarUrl: null });
const agentA = user("u-a", "agent-a");
const agentB = user("u-b", "agent-b");
const capabilities = {
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
const repo = {
  id: "space-r",
  name: "notes",
  type: "team",
  accessRole: "owner",
  affiliation: "owner",
  description: "",
  fullName: "agent-a/notes",
  owner: { id: agentA.id, username: agentA.username },
  publicRead: false,
  slug: "notes",
  capabilities,
};
const ceiling =
  "An unclaimed agent cannot add or be a Team Space member, and an agent can be an admin only of a Team Space an agent owns.";

describe("repository member tools", () => {
  let gateway: ReturnType<typeof createGateway> | undefined;
  let clients: Client[] = [];
  let session: Record<string, unknown> = { ...agentA, kind: "agent", claimed: true };
  let members = new Map<string, Record<string, unknown>>();
  let writes: string[] = [];

  const error = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status });
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== "GET") writes.push(`${request.method} ${url.pathname}`);
    const unclaimed = session["kind"] === "agent" && session["claimed"] === false;
    if (url.pathname === "/api/session") return Response.json({ authenticated: true, user: session });
    if (url.pathname === "/api/spaces/lookup" || url.pathname === "/api/spaces/space-r") return Response.json(repo);
    if (url.pathname === "/api/spaces/space-r/star") return Response.json({ starCount: 0, starred: false });
    if (url.pathname === "/api/forks/lookup") return error(404, "NOT_FOUND", "The resource was not found.");
    if (url.pathname === "/api/team-spaces" && request.method === "POST") return Response.json(repo, { status: 201 });
    if (url.pathname === "/api/users/search") {
      if (unclaimed) return error(403, "AGENT_NOT_ALLOWED", "An unclaimed agent cannot search Users.");
      return Response.json({ users: [agentB].filter(({ username }) => username === url.searchParams.get("query")) });
    }
    if (url.pathname === "/api/team-spaces/space-r/members") {
      return Response.json({ owner: agentA, members: [...members.values()] });
    }
    const userId = /^\/api\/team-spaces\/space-r\/members\/(.+)$/u.exec(url.pathname)?.[1];
    if (userId !== undefined && request.method === "PUT") {
      const { role } = (await request.json()) as { role: string };
      if (unclaimed || (role === "admin" && session["kind"] !== "agent")) return error(403, "AGENT_NOT_ALLOWED", ceiling);
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

  async function connect(suffix = "") {
    if (gateway !== undefined) await close();
    const listening = await listenGateway((url) =>
      createGateway(
        parseGatewayConfig({
          MCP_DEV_SESSION_PASSTHROUGH: "1",
          WORKSPACE_ORIGIN: origin,
          MCP_STAGING_DIRECTORY: testStagingDirectory(),
          MCP_PUBLIC_URL: url,
        }),
        { logger: pino({ level: "silent" }), fetcher },
      ));
    gateway = listening.gateway;
    const client = new Client({ name: "repo-member-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${listening.url}${suffix}`), {
        requestInit: { headers: { Authorization: "Bearer test-session-secret" } },
      }),
    );
    return client;
  }
  async function close() {
    await Promise.all(clients.map((client) => client.close()));
    clients = [];
    if (gateway === undefined) return;
    await gateway.close();
    gateway.server.closeAllConnections();
    await new Promise((resolve) => gateway!.server.close(resolve));
    gateway = undefined;
  }
  const names = async (suffix = "") => (await (await connect(suffix)).listTools()).tools.map(({ name }) => name);
  const memberTools = ["repo_create", "repo_edit", "repo_member_list", "repo_member_write"];

  afterEach(async () => {
    await close();
    session = { ...agentA, kind: "agent", claimed: true };
    members = new Map();
    writes = [];
  });

  it.each([true, false])("lists repo_create, repo_edit and the member tools on an agent's default connection (claimed: %s)", async (claimed) => {
    session = { ...agentA, kind: "agent", claimed };
    expect((await names()).filter((name) => memberTools.includes(name))).toEqual(memberTools);
    expect((await names("?toolsets=admin")).filter((name) => memberTools.includes(name))).toEqual(memberTools);
  });

  it("keeps them in admin only for a person", async () => {
    session = { id: "u-h", username: "hana", displayName: "hana" };
    expect((await names()).filter((name) => memberTools.includes(name))).toEqual([]);
    expect((await names("?toolsets=admin")).filter((name) => memberTools.includes(name))).toEqual(memberTools);
  });

  it("lets a claimed agent create a repository, see that it may manage members, and add, change and remove another agent", async () => {
    const client = await connect();
    const call = async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })).structuredContent;
    expect(await call("repo_create", { slug: "notes" })).toMatchObject({ fullName: "agent-a/notes" });
    expect(await call("repo_view", { repo: "agent-a/notes" })).toMatchObject({ capabilities: { manageMembers: true } });
    expect(await call("repo_member_write", { repo: "agent-a/notes", action: "add", user: "agent-b", role: "viewer" }))
      .toMatchObject({ user: { username: "agent-b" }, role: "viewer", grantedBy: { username: "agent-a" } });
    expect(await call("repo_member_list", { repo: "agent-a/notes" })).toEqual({
      owner: { id: "u-a", username: "agent-a", displayName: "agent-a" },
      members: [expect.objectContaining({ user: { id: "u-b", username: "agent-b", displayName: "agent-b" }, role: "viewer" })],
    });
    expect(await call("repo_member_write", { repo: "agent-a/notes", action: "edit", user: "agent-b", role: "admin" }))
      .toMatchObject({ role: "admin" });
    expect(await call("repo_member_write", { repo: "agent-a/notes", action: "remove", user: "agent-b" }))
      .toEqual({ removed: "agent-b" });
    expect(await call("repo_member_list", { repo: "agent-a/notes" })).toMatchObject({ members: [] });
    expect(writes).toEqual([
      "POST /api/team-spaces",
      "PUT /api/team-spaces/space-r/members/u-b",
      "PUT /api/team-spaces/space-r/members/u-b",
      "DELETE /api/team-spaces/space-r/members/u-b",
    ]);
  });

  it("returns the member ceiling refusals as AGENT_NOT_ALLOWED with a sentence the caller can act on", async () => {
    session = { ...agentA, kind: "agent", claimed: false };
    expect(toolError(await (await connect()).callTool({
      name: "repo_member_write",
      arguments: { repo: "agent-a/notes", action: "add", user: "agent-b", role: "viewer" },
    }))).toEqual({
      code: "AGENT_NOT_ALLOWED",
      message: "An unclaimed agent cannot add Team Space members. A person must claim it first.",
    });
    session = { id: "u-h", username: "hana", displayName: "hana" };
    expect(toolError(await (await connect("?toolsets=admin")).callTool({
      name: "repo_member_write",
      arguments: { repo: "agent-a/notes", action: "add", user: "agent-b", role: "admin" },
    }))).toMatchObject({ code: "AGENT_NOT_ALLOWED", message: ceiling });
    expect(writes).toEqual(["PUT /api/team-spaces/space-r/members/u-b"]);
  });

  it("refuses a missing or stray role and a user who is not a member before writing", async () => {
    const client = await connect();
    for (const [args, message] of [
      [{ action: "add", user: "agent-b" }, "role is required for action add."],
      [{ action: "remove", user: "agent-b", role: "viewer" }, "role does not apply to action remove."],
      [{ action: "edit", user: "agent-b", role: "editor" }, '"agent-b" is not a member of this repository.'],
    ] as const) {
      expect(toolError(await client.callTool({ name: "repo_member_write", arguments: { repo: "agent-a/notes", ...args } })))
        .toMatchObject({ message });
    }
    expect(writes).toEqual([]);
  });
});
