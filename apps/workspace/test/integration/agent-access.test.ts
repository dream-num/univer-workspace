import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteTestApplication, type SqliteTestApplication } from "../support/sqlite/test-application.js";
import type { WorkspaceConfig } from "../../server/src/config.js";
import { logger } from "../../server/src/logging/logger.js";
import { UnitStoreError } from "../../server/src/integrations/univer/unit-store.js";
import { createStaticSiteRouter } from "../../server/src/middleware/static-site.js";
import type { WorktreeBackend } from "../../server/src/modules/worktrees/index.js";
import { UniverType } from "@univerjs/protocol";

const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Agent {
  readonly id: string;
  readonly username: string;
  /** The Workspace session the MCP gateway gets for the agent's personal access token. */
  readonly cookie: string;
  readonly token: string;
}

const applications: SqliteTestApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];
/** How long the stub Unit store takes, so that concurrent creations overlap. */
let unitStoreDelayMs = 0;
/** Makes the stub Unit store fail for good, leaving a failed Operation behind. */
let unitStoreFails = false;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  unitStoreDelayMs = 0;
  unitStoreFails = false;
});

describe("principal kind", () => {
  it("shows an agent's kind and claim in its session and in the token exchange, and only the kind for a human", async () => {
    const { origin, application } = await start();
    const agent = await createAgent(origin);
    const exchanged = (await (await exchange(origin, agent.token)).json()) as { user: unknown };
    const agentUser = { id: agent.id, username: agent.username, displayName: "agent", avatarUrl: null, kind: "agent", claimed: false };
    expect(exchanged.user).toEqual(agentUser);
    expect(await session(origin, agent.cookie)).toMatchObject({ authenticated: true, user: agentUser });

    const human = await register(origin, "alice");
    application.database.connection
      .prepare("UPDATE agents SET owner_user_id = ?, claimed_at = 1 WHERE user_id = ?")
      .run(human.id, agent.id);
    expect((await session(origin, agent.cookie)).user).toEqual({ ...agentUser, claimed: true });
    expect((await session(origin, human.cookie)).user).toEqual({
      id: human.id, username: "alice", displayName: "alice", avatarUrl: null, kind: "human",
    });
  });
});

describe("a banned agent", () => {
  it("is unauthenticated on its sessions and gets invalid_grant from the token exchange", async () => {
    const { origin, application } = await start();
    const agent = await createAgent(origin);
    const guest = await post(origin, "/api/auth/guest", {});
    const guestCookie = guest.headers.get("set-cookie")!.split(";")[0]!;
    const guestId = ((await guest.json()) as { agent: { id: string } }).agent.id;
    expect((await fetch(`${origin}/api/spaces`, { headers: { cookie: agent.cookie } })).status).toBe(200);

    application.database.connection
      .prepare("UPDATE agents SET banned_at = ? WHERE user_id IN (?, ?)")
      .run(Date.now(), agent.id, guestId);

    for (const cookie of [agent.cookie, guestCookie]) {
      const refused = await fetch(`${origin}/api/spaces`, { headers: { cookie } });
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
      expect(await session(origin, cookie)).toMatchObject({ authenticated: false });
      expect(await application.identity.getRealtimeSession(cookie)).toBeNull();
    }
    const refused = await exchange(origin, agent.token);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "invalid_grant" });
  });
});

describe("db:ban-agent", () => {
  it("bans an agent by username or user id, keeps the first ban time and refuses other Users", async () => {
    const directory = mkdtempSync(join(tmpdir(), "workspace-ban-agent-"));
    directories.push(directory);
    const databaseFilename = join(directory, "workspace.sqlite");
    const { origin, application } = await start({ database: { provider: "sqlite", filename: databaseFilename, collaborationFilename: ":memory:" } });
    const [byName, byId] = [await createAgent(origin), await createAgent(origin)];
    await register(origin, "alice");
    const ban = (target: string) => spawnSync(process.execPath, ["--import", "tsx", "server/src/db/ban-agent.ts", target], {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, DATABASE_FILE: databaseFilename },
      timeout: 30_000,
    });
    const bannedAt = (agentId: string) => (application.database.connection
      .prepare("SELECT banned_at FROM agents WHERE user_id = ?")
      .get(agentId) as { banned_at: number | null }).banned_at;

    expect(ban(byName.username).status).toBe(0);
    expect(ban(byId.id).status).toBe(0);
    for (const agent of [byName, byId]) {
      expect((await fetch(`${origin}/api/spaces`, { headers: { cookie: agent.cookie } })).status).toBe(401);
      expect(await (await exchange(origin, agent.token)).json()).toEqual({ error: "invalid_grant" });
    }

    const first = bannedAt(byName.id);
    expect(first).toEqual(expect.any(Number));
    expect(ban(byName.username).status).toBe(0);
    expect(bannedAt(byName.id)).toBe(first);

    expect(ban("alice")).toMatchObject({ status: 1, stderr: expect.stringContaining("not an agent") });
    expect(ban("nobody")).toMatchObject({ status: 1, stderr: expect.stringContaining("No User matches") });
  });
});

describe("db:executor-access", () => {
  it("grants, lists and revokes by username or user id, and reports it in the session and the token exchange", async () => {
    const directory = mkdtempSync(join(tmpdir(), "workspace-executor-access-"));
    directories.push(directory);
    const databaseFilename = join(directory, "workspace.sqlite");
    const { origin } = await start({ database: { provider: "sqlite", filename: databaseFilename, collaborationFilename: ":memory:" } });
    const alice = await register(origin, "alice");
    const agent = await createAgent(origin);
    const pat = ((await (await post(origin, "/api/auth/tokens", { name: "mcp" }, { cookie: alice.cookie })).json()) as { token: string }).token;
    const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "server/src/db/executor-access.ts", ...args], {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, DATABASE_FILE: databaseFilename },
      timeout: 30_000,
    });
    const reported = async () => ({
      session: ((await session(origin, alice.cookie)) as { executorAccess?: unknown }).executorAccess,
      exchange: ((await (await exchange(origin, pat)).json()) as { executor_access?: unknown }).executor_access,
      agentSession: ((await session(origin, agent.cookie)) as { executorAccess?: unknown }).executorAccess,
    });

    expect(await reported()).toEqual({ session: undefined, exchange: undefined, agentSession: undefined });
    expect(run("list")).toMatchObject({ status: 0, stdout: "", stderr: expect.stringContaining("No users have executor access") });
    expect(run("grant", "alice")).toMatchObject({ status: 0, stdout: `alice (${alice.id}) now has executor access\n` });
    expect(run("grant", alice.id)).toMatchObject({ status: 0, stdout: `alice (${alice.id}) already has executor access\n` });
    expect(await reported()).toEqual({ session: true, exchange: true, agentSession: undefined });
    expect(run("list").stdout).toMatch(new RegExp(`^alice\\t${alice.id}\\thuman\\t\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z\\n$`));

    const selfGrant = await send(origin, "PATCH", "/api/users/me", { executorAccess: true }, { cookie: agent.cookie });
    expect(selfGrant.status).toBe(400);
    expect((await session(origin, agent.cookie)) as { executorAccess?: unknown }).not.toHaveProperty("executorAccess");

    expect(run("revoke", alice.id)).toMatchObject({ status: 0, stdout: `alice (${alice.id}) no longer has executor access\n` });
    expect(run("revoke", "alice")).toMatchObject({ status: 0, stdout: `alice (${alice.id}) already has no executor access\n` });
    expect(await reported()).toEqual({ session: undefined, exchange: undefined, agentSession: undefined });
    expect(run("list")).toMatchObject({ status: 0, stdout: "" });

    expect(run("grant", "nobody")).toMatchObject({ status: 1, stderr: expect.stringContaining("No User matches nobody") });
    for (const args of [["grant"], ["list", "alice"], ["allow", "alice"]]) {
      expect(run(...args)).toMatchObject({ status: 1, stderr: expect.stringContaining("Usage: db:executor-access") });
    }
  }, 60_000);
});

describe("access rules for agents", () => {
  it("holds an unclaimed agent to Viewer on an Editor link, like the anonymous reader", async () => {
    const { origin, application } = await start();
    const owner = await register(origin, "owner");
    const other = await register(origin, "other");
    const agent = await createAgent(origin);
    const nodeId = await createFile(origin, owner.cookie, "Shared sheet");
    expect((await put(origin, `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "editor" }, owner.cookie)).status).toBe(200);

    expect(await accessRole(origin, nodeId, other.cookie)).toBe("editor");
    expect(await accessRole(origin, nodeId, undefined)).toBe("viewer");
    expect(await accessRole(origin, nodeId, agent.cookie)).toBe("viewer");

    application.database.connection
      .prepare("UPDATE agents SET owner_user_id = ?, claimed_at = 1 WHERE user_id = ?")
      .run(owner.id, agent.id);
    expect(await accessRole(origin, nodeId, agent.cookie)).toBe("editor");
  });

  it("gives nobody but the owner a role in a suspended agent's Space, in lookups and listings alike", async () => {
    const { origin, application } = await start();
    const reader = await register(origin, "reader");
    const agent = await createAgent(origin);
    const nodeId = await createFile(origin, agent.cookie, "Agent sheet");
    await expectRefused(put(origin, `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "viewer" }, agent.cookie), "AGENT_NOT_ALLOWED");
    await expectRefused(put(origin, `/api/nodes/${nodeId}/grants/${reader.id}`, { role: "editor" }, agent.cookie), "AGENT_NOT_ALLOWED");
    await linkOpenedEarlier(application, agent.id, nodeId);
    await application.repositories.permissions.upsertGrant({ nodeId, userId: reader.id, role: "editor", grantedBy: agent.id, now: Date.now() }, () => {});
    const sharedWithReader = async () =>
      ((await (await fetch(`${origin}/api/shared-with-me`, { headers: { cookie: reader.cookie } })).json()) as { items: unknown[] }).items.length;
    const suspend = (column: "expires_at" | "banned_at", value: number | null) =>
      application.database.connection.prepare(`UPDATE agents SET ${column} = ? WHERE user_id = ?`).run(value, agent.id);

    for (const [column, lifted] of [["expires_at", Date.now() + 60_000], ["banned_at", null]] as const) {
      expect(await accessRole(origin, nodeId, undefined)).toBe("viewer");
      expect(await accessRole(origin, nodeId, reader.cookie)).toBe("editor");
      expect(await sharedWithReader()).toBe(1);

      suspend(column, Date.now() - 1);
      expect(await accessRole(origin, nodeId, undefined)).toBeNull();
      expect(await accessRole(origin, nodeId, reader.cookie)).toBeNull();
      expect(await sharedWithReader()).toBe(0);
      expect((await application.access.resolveNode(agent.id, nodeId))?.role).toBe("owner");
      suspend(column, lifted);
    }
    expect(await accessRole(origin, nodeId, undefined)).toBe("viewer");
  });
});

describe("ceilings", () => {
  it("keeps an unclaimed agent from making a Space public, and gives a claimed one a confirm link its claimer can act on", async () => {
    const { origin, application } = await start();
    const human = await register(origin, "owner");
    const agent = await createAgent(origin);
    const team = (await (await post(origin, "/api/team-spaces", { name: "Team", publicRead: true }, { cookie: human.cookie })).json()) as { id: string };
    const personal = await personalSpaceId(origin, agent.cookie);

    await expectRefused(send(origin, "PATCH", `/api/spaces/${personal}`, { publicRead: true }, { cookie: agent.cookie }), "AGENT_NOT_ALLOWED");
    expect((await send(origin, "PATCH", `/api/spaces/${personal}`, { name: "Renamed" }, { cookie: agent.cookie })).status).toBe(200);
    expect(await (await fetch(`${origin}/api/spaces`, { headers: { cookie: agent.cookie } })).json()).toMatchObject({
      spaces: [{ type: "personal", name: "Renamed", publicRead: false }],
    });
    claim(application, agent.id, human.id);
    const asked = await send(origin, "PATCH", `/api/spaces/${personal}`, { publicRead: true }, { cookie: agent.cookie });
    expect({ status: asked.status, body: await asked.json() }).toMatchObject({ status: 403, body: { error: {
      code: "INTERACTIVE_SESSION_REQUIRED", url: `/confirm/public?space=${personal}`,
    } } });
    expect((await send(origin, "PATCH", `/api/spaces/${personal}`, { publicRead: true }, { cookie: human.cookie })).status).toBe(200);

    const other = await register(origin, "member");
    expect((await put(origin, `/api/team-spaces/${team.id}/members/${other.id}`, { role: "viewer" }, human.cookie)).status).toBe(200);
    expect((await send(origin, "PATCH", `/api/spaces/${team.id}`, { publicRead: false }, { cookie: human.cookie })).status).toBe(200);
    expect((await send(origin, "PATCH", `/api/spaces/${team.id}`, { publicRead: true }, { cookie: human.cookie })).status).toBe(200);
  });

  it("lets a human add a claimed agent to a Team Space as viewer or editor, never as admin, and no unclaimed agent", async () => {
    const { origin, application } = await start();
    const human = await register(origin, "owner");
    const claimer = await register(origin, "claimer");
    const agent = await createAgent(origin);
    const unclaimed = await createAgent(origin);
    claim(application, agent.id, claimer.id);
    const team = (await (await post(origin, "/api/team-spaces", { name: "Team" }, { cookie: human.cookie })).json()) as { id: string };
    const created = await post(
      origin,
      "/api/resources",
      { kind: "univer", spaceId: team.id, parentNodeId: null, name: "Budget", unitType: "sheet" },
      { cookie: human.cookie, "idempotency-key": randomUUID() },
    );
    const nodeId = ((await created.json()) as { node: { id: string } }).node.id;
    const setRole = (userId: string, role: string) => put(origin, `/api/team-spaces/${team.id}/members/${userId}`, { role }, human.cookie);
    const members = async () =>
      ((await (await fetch(`${origin}/api/team-spaces/${team.id}/members`, { headers: { cookie: human.cookie } })).json()) as {
        members: { user: { id: string }; role: string }[];
      }).members.map(({ user, role }) => [user.id, role]);
    const agentSpaces = async () =>
      ((await (await fetch(`${origin}/api/spaces`, { headers: { cookie: agent.cookie } })).json()) as { spaces: { id: string }[] }).spaces.map(
        (space) => space.id,
      );

    for (const role of ["viewer", "editor", "admin"]) await expectRefused(setRole(unclaimed.id, role), "AGENT_NOT_ALLOWED");
    await expectRefused(setRole(agent.id, "admin"), "AGENT_NOT_ALLOWED");
    expect(await members()).toEqual([]);
    expect(await accessRole(origin, nodeId, agent.cookie)).toBeNull();

    expect((await setRole(agent.id, "viewer")).status).toBe(200);
    expect(await agentSpaces()).toContain(team.id);
    expect(await accessRole(origin, nodeId, agent.cookie)).toBe("viewer");

    expect((await setRole(agent.id, "editor")).status).toBe(200);
    expect(await accessRole(origin, nodeId, agent.cookie)).toBe("editor");
    await expectRefused(setRole(agent.id, "admin"), "AGENT_NOT_ALLOWED");
    expect(await members()).toEqual([[agent.id, "editor"]]);
  });

  it("refuses an unclaimed agent's 21st file on the direct path, and counts Trash out and restores in", async () => {
    const { origin } = await start();
    const agent = await createAgent(origin);
    const key = randomUUID();
    const nodeIds: string[] = [];
    for (let index = 1; index <= 20; index += 1) {
      const response = await createFileRequest(origin, agent.cookie, `File ${index}`, index === 20 ? key : undefined);
      expect(response.status).toBe(201);
      nodeIds.push(((await response.json()) as { node: { id: string } }).node.id);
    }
    const refused = await createFileRequest(origin, agent.cookie, "File 21");
    expect({ status: refused.status, body: await refused.json() }).toMatchObject({ status: 403, body: { error: {
      code: "AGENT_QUOTA_EXCEEDED",
      message: "An unclaimed agent can keep at most 20 files across its Spaces, new files in its open pull requests included. Move files you no longer need to Trash, or give a person a handoff link so they can take you, which lifts this limit.",
    } } });
    // The 20th creation, replayed with its Idempotency-Key, is the same file and not a 21st.
    expect((await createFileRequest(origin, agent.cookie, "File 20", key)).status).toBe(200);

    const trashed = await post(origin, `/api/nodes/${nodeIds[0]}/trash`, undefined, { cookie: agent.cookie });
    expect(trashed.status).toBe(201);
    const batchId = ((await trashed.json()) as { id: string }).id;
    expect((await createFileRequest(origin, agent.cookie, "File 21")).status).toBe(201);
    await expectRefused(post(origin, `/api/trash-batches/${batchId}/restore`, undefined, { cookie: agent.cookie }), "AGENT_QUOTA_EXCEEDED");

    const upload = await exchangeUpload(origin, agent.cookie, 5);
    expect(upload.status).toBe(201);
    const { FileId } = (await upload.json()) as { FileId: string };
    await expectRefused(post(origin, "/universer-api/exchange/import", { fileID: FileId, outputType: 1 }, { cookie: agent.cookie }), "AGENT_QUOTA_EXCEEDED");
  });

  it("counts a failed creation again when it is replayed or retried", async () => {
    const { origin } = await start();
    const agent = await createAgent(origin);
    const nodeIds: string[] = [];
    for (let index = 1; index <= 19; index += 1) nodeIds.push(await createFile(origin, agent.cookie, `File ${index}`));
    const key = randomUUID();
    unitStoreFails = true;
    const failed = await createFileRequest(origin, agent.cookie, "File 20", key);
    expect(failed.status).toBe(202);
    expect(await failed.json()).toMatchObject({ operation: { state: "failed" } });
    unitStoreFails = false;
    await createFile(origin, agent.cookie, "Another file 20");

    const retry = () => post(origin, `/api/operations/${key}/retry`, undefined, { cookie: agent.cookie });
    await expectRefused(createFileRequest(origin, agent.cookie, "File 20", key), "AGENT_QUOTA_EXCEEDED");
    await expectRefused(retry(), "AGENT_QUOTA_EXCEEDED");

    expect((await post(origin, `/api/nodes/${nodeIds[0]}/trash`, undefined, { cookie: agent.cookie })).status).toBe(201);
    const retried = await retry();
    expect(retried.status).toBe(202);
    expect(await retried.json()).toMatchObject({ state: "completed" });
    await expectRefused(createFileRequest(origin, agent.cookie, "File 21"), "AGENT_QUOTA_EXCEEDED");
  });

  it("holds the limit when creations race", async () => {
    const { origin } = await start();
    const agent = await createAgent(origin);
    unitStoreDelayMs = 20;
    const statuses = await Promise.all(
      Array.from({ length: 30 }, async (_, index) => (await createFileRequest(origin, agent.cookie, `File ${index}`)).status),
    );
    expect(statuses.filter((status) => status === 201)).toHaveLength(20);
    expect(statuses.filter((status) => status === 403)).toHaveLength(10);
  });

  it("refuses the 21st file inside a pull request at creation, counting both paths together", async () => {
    const { origin } = await start();
    const agent = await createAgent(origin);
    const spaceId = await personalSpaceId(origin, agent.cookie);
    const worktree = (await (await post(origin, "/api/worktrees", { kind: "user", name: "Budget", summary: null }, { cookie: agent.cookie, "idempotency-key": randomUUID() })).json()) as { id: string };
    const addUnit = (name: string) =>
      post(
        origin,
        `/api/worktrees/${worktree.id}/units`,
        { source: "worktree", name, unitType: "sheet", targetSpaceId: spaceId, targetParentNodeId: null },
        { cookie: agent.cookie, "idempotency-key": randomUUID() },
      );
    for (let index = 1; index <= 12; index += 1) expect((await addUnit(`Draft ${index}`)).status).toBe(201);
    for (let index = 13; index <= 20; index += 1) expect((await createFileRequest(origin, agent.cookie, `File ${index}`)).status).toBe(201);
    await expectRefused(addUnit("Draft 21"), "AGENT_QUOTA_EXCEEDED");
    await expectRefused(createFileRequest(origin, agent.cookie, "File 21"), "AGENT_QUOTA_EXCEEDED");

    // Discarding the pull request gives its twelve pending files back.
    expect((await post(origin, `/api/worktrees/${worktree.id}/discard`, {}, { cookie: agent.cookie, "idempotency-key": randomUUID() })).status).toBe(200);
    expect((await createFileRequest(origin, agent.cookie, "File 21")).status).toBe(201);
  });

  it("does not limit a claimed agent or a human", async () => {
    const { origin, application } = await start();
    const human = await register(origin, "owner");
    const agent = await createAgent(origin);
    claim(application, agent.id, human.id);
    for (const cookie of [agent.cookie, human.cookie]) {
      for (let index = 1; index <= 21; index += 1) expect((await createFileRequest(origin, cookie, `File ${index}`)).status).toBe(201);
      expect((await reserveBlob(origin, cookie, 10 * 1024 * 1024 + 1)).status).toBe(201);
    }
  });

  it("refuses an unclaimed agent a file above 10 MB at blob upload and at exchange upload", async () => {
    const { origin } = await start();
    const agent = await createAgent(origin);
    expect((await reserveBlob(origin, agent.cookie, 10 * 1024 * 1024)).status).toBe(201);
    const refused = await reserveBlob(origin, agent.cookie, 10 * 1024 * 1024 + 1);
    expect({ status: refused.status, body: await refused.json() }).toMatchObject({ status: 403, body: { error: {
      code: "AGENT_QUOTA_EXCEEDED",
      message: "An unclaimed agent can store files of at most 10485760 bytes. Store a smaller file, or give a person a handoff link so they can take you, which lifts this limit.",
    } } });

    await expectRefused(exchangeUpload(origin, agent.cookie, 10 * 1024 * 1024 + 1), "AGENT_QUOTA_EXCEEDED");
    expect((await exchangeUpload(origin, agent.cookie, 5)).status).toBe(201);
  });

  it("requires an interactive session for a human to write Link Sharing, and refuses an unclaimed agent its own file", async () => {
    const { origin } = await start();
    const human = await register(origin, "owner");
    const nodeId = await createFile(origin, human.cookie, "Private sheet");
    const pat = ((await (await post(origin, "/api/auth/tokens", { name: "cli" }, { cookie: human.cookie })).json()) as { token: string }).token;
    const delegated = await tokenSession(origin, pat);
    const settings = { enabled: true, role: "viewer" };

    await expectRefused(put(origin, `/api/nodes/${nodeId}/link-sharing`, settings, delegated), "INTERACTIVE_SESSION_REQUIRED");
    const read = await fetch(`${origin}/api/nodes/${nodeId}/link-sharing`, { headers: { cookie: delegated } });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ enabled: false });
    expect((await put(origin, `/api/nodes/${nodeId}/link-sharing`, settings, human.cookie)).status).toBe(200);

    const agent = await createAgent(origin);
    const agentNodeId = await createFile(origin, agent.cookie, "Agent sheet");
    await expectRefused(put(origin, `/api/nodes/${agentNodeId}/link-sharing`, settings, agent.cookie), "AGENT_NOT_ALLOWED");
    expect((await put(origin, `/api/nodes/${agentNodeId}/link-sharing`, { ...settings, enabled: false }, agent.cookie)).status).toBe(200);
    expect((await put(origin, `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "editor" }, agent.cookie)).status).toBe(403);
  });

  it("requires an interactive session for a human to make a Space public, and lets a token session unpublish and rename", async () => {
    const { origin } = await start();
    const human = await register(origin, "owner");
    const personal = await personalSpaceId(origin, human.cookie);
    const nodeId = await createFile(origin, human.cookie, "Private sheet");
    const pat = ((await (await post(origin, "/api/auth/tokens", { name: "mcp" }, { cookie: human.cookie })).json()) as { token: string }).token;
    const delegated = await tokenSession(origin, pat);
    const created = await post(origin, "/api/team-spaces", { name: "Team" }, { cookie: delegated });
    expect(created.status).toBe(201);
    const team = (await created.json()) as { id: string };
    const spaces = async () => ((await (await fetch(`${origin}/api/spaces`, { headers: { cookie: human.cookie } })).json()) as { spaces: unknown[] }).spaces;
    const before = await spaces();

    for (const spaceId of [personal, team.id]) {
      for (const settings of [{ publicRead: true }, { name: "Published", publicRead: true }]) {
        await expectRefused(send(origin, "PATCH", `/api/spaces/${spaceId}`, settings, { cookie: delegated }), "INTERACTIVE_SESSION_REQUIRED");
      }
    }
    await expectRefused(post(origin, "/api/team-spaces", { name: "Public team", publicRead: true }, { cookie: delegated }), "INTERACTIVE_SESSION_REQUIRED");
    expect(await spaces()).toEqual(before);
    expect(await accessRole(origin, nodeId, undefined)).toBeNull();

    expect((await send(origin, "PATCH", `/api/spaces/${personal}`, { publicRead: true }, { cookie: human.cookie })).status).toBe(200);
    expect(await accessRole(origin, nodeId, undefined)).toBe("viewer");
    const unpublished = await send(origin, "PATCH", `/api/spaces/${personal}`, { name: "Renamed", publicRead: false }, { cookie: delegated });
    expect(unpublished.status).toBe(200);
    expect(await unpublished.json()).toMatchObject({ name: "Renamed", publicRead: false });
    expect(await accessRole(origin, nodeId, undefined)).toBeNull();
    expect((await send(origin, "PATCH", `/api/spaces/${team.id}`, { description: "Notes" }, { cookie: delegated })).status).toBe(200);
    expect((await post(origin, "/api/team-spaces", { name: "Public team", publicRead: true }, { cookie: human.cookie })).status).toBe(201);
  });
});

function claim(application: SqliteTestApplication, agentId: string, ownerId: string): void {
  application.database.connection
    .prepare("UPDATE agents SET owner_user_id = ?, claimed_at = 1, expires_at = NULL WHERE user_id = ?")
    .run(ownerId, agentId);
}

async function expectRefused(request: Promise<Response>, code: string): Promise<void> {
  const response = await request;
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code } });
}

async function personalSpaceId(origin: string, cookie: string): Promise<string> {
  const spaces = (await (await fetch(`${origin}/api/spaces`, { headers: { cookie } })).json()) as { spaces: { id: string; type: string }[] };
  return spaces.spaces.find((space) => space.type === "personal")!.id;
}

function exchangeUpload(origin: string, cookie: string, declaredSize: number): Promise<Response> {
  const form = new FormData();
  form.append("file", new File(["small"], "book.xlsx"));
  return fetch(`${origin}/universer-api/stream/file/upload?size=${declaredSize}&source=1&flate=false`, { method: "POST", headers: { cookie }, body: form });
}

async function reserveBlob(origin: string, cookie: string, byteSize: number): Promise<Response> {
  return post(
    origin,
    "/api/blob-upload-sessions",
    { spaceId: await personalSpaceId(origin, cookie), parentNodeId: null, name: `${randomUUID()}.bin`, originalFilename: "data.bin", byteSize },
    { cookie, "idempotency-key": randomUUID() },
  );
}

/** Pull requests without a collaboration runtime: enough to create them, add new Units and discard. */
function memoryWorktreeBackend(): WorktreeBackend {
  type Worktree = Awaited<ReturnType<WorktreeBackend["getWorktree"]>>;
  const worktrees = new Map<string, Worktree>();
  const backend: Pick<WorktreeBackend, "createWorktree" | "getWorktree" | "createUnit" | "discard"> = {
    async createWorktree(worktreeID) {
      const worktree: Worktree = { worktreeID, status: "draft", units: [] };
      worktrees.set(worktreeID, worktree);
      return worktree;
    },
    async getWorktree(worktreeID) {
      return worktrees.get(worktreeID)!;
    },
    async createUnit(input) {
      const current = worktrees.get(input.worktreeId)!;
      const worktree = { ...current, units: [...current.units, { unitID: input.unitId, type: UniverType.UNIVER_SHEET, source: "worktree", draftHeadRevision: 1 }] } as Worktree;
      worktrees.set(input.worktreeId, worktree);
      return worktree;
    },
    async discard(worktreeID) {
      const worktree = { ...worktrees.get(worktreeID)!, status: "discarded" } as Worktree;
      worktrees.set(worktreeID, worktree);
      return worktree;
    },
  };
  return backend as WorktreeBackend;
}

describe("GET /api/users/search", () => {
  it("returns humans and claimed agents that are not stopped, by name and by exact id", async () => {
    const { origin, application } = await start();
    const alice = await register(origin, "alice");
    const bob = await register(origin, "bobby");
    const agent = (await (await post(origin, "/api/agents", { label: "bobbin" })).json()) as { agent: { id: string; username: string } };
    expect(agent.agent.username).toMatch(/^bobbin-/);
    const search = async (query: string) =>
      ((await (await fetch(`${origin}/api/users/search?query=${query}`, { headers: { cookie: alice.cookie } })).json()) as {
        users: { id: string }[];
      }).users.map((user) => user.id);

    expect(await search("bobb")).toEqual([bob.id]);
    expect(await search(agent.agent.id)).toEqual([]);
    expect(await search(bob.id)).toEqual([bob.id]);

    claim(application, agent.agent.id, bob.id);
    expect(await search("bobb")).toEqual([agent.agent.id, bob.id]);
    expect(await search(agent.agent.id)).toEqual([agent.agent.id]);

    expect((await fetch(`${origin}/api/agents/${agent.agent.id}/stop`, { method: "POST", headers: { cookie: bob.cookie } })).status).toBe(204);
    expect(await search("bobb")).toEqual([bob.id]);
    expect(await search(agent.agent.id)).toEqual([]);
  });

  it("refuses an unclaimed agent, which anyone can create", async () => {
    const { origin } = await start();
    await register(origin, "alice");
    const agent = await createAgent(origin);
    const response = await fetch(`${origin}/api/users/search?query=alice`, { headers: { cookie: agent.cookie } });
    expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 403, body: { error: {
      code: "AGENT_NOT_ALLOWED",
      message: "An unclaimed agent cannot search Users. Leave other Users out, or give a person a handoff link so they can take you, which lifts this limit.",
    } } });
  });
});

describe("Link Sharing settings", () => {
  it("name the Space owner and say when an unclaimed agent's link expires", async () => {
    const { origin, application } = await start();
    const human = await register(origin, "owner");
    const agent = await createAgent(origin);
    const linkSharing = async (cookie: string, nodeId: string) =>
      (await (await fetch(`${origin}/api/nodes/${nodeId}/link-sharing`, { headers: { cookie } })).json()) as { owner: unknown; expiresAt: string | null };

    const humanNodeId = await createFile(origin, human.cookie, "Human sheet");
    expect(await linkSharing(human.cookie, humanNodeId)).toMatchObject({ enabled: false, owner: { username: "owner", kind: "human" }, expiresAt: null });
    expect((await linkSharing(human.cookie, humanNodeId)).owner).not.toHaveProperty("claimed");

    const agentNodeId = await createFile(origin, agent.cookie, "Agent sheet");
    await linkOpenedEarlier(application, agent.id, agentNodeId);
    expect(await linkSharing(agent.cookie, agentNodeId)).toMatchObject({
      enabled: true,
      owner: { username: agent.username, kind: "agent", claimed: false },
      expiresAt: new Date(agentLifecycle(application, agent.id).get().expires_at!).toISOString(),
    });

    claim(application, agent.id, human.id);
    expect(await linkSharing(agent.cookie, agentNodeId)).toMatchObject({
      owner: { username: agent.username, kind: "agent", claimed: true },
      expiresAt: null,
    });
  });
});

describe("GET /api/nodes/:nodeId", () => {
  it("names the Personal Space owner as the author to every reader, and nobody in a Team Space", async () => {
    const { origin, application } = await start();
    const human = await register(origin, "alice");
    const reader = await register(origin, "reader");
    const agent = await createAgent(origin);
    const author = async (nodeId: string, cookie?: string) =>
      ((await (await fetch(`${origin}/api/nodes/${nodeId}`, { headers: cookie ? { cookie } : {} })).json()) as { owner: unknown }).owner;

    const agentNodeId = await createFile(origin, agent.cookie, "Agent sheet");
    await linkOpenedEarlier(application, agent.id, agentNodeId);
    const unclaimed = { displayName: "agent", kind: "agent", claimed: false };
    for (const cookie of [undefined, reader.cookie, agent.cookie]) expect(await author(agentNodeId, cookie)).toEqual(unclaimed);
    claim(application, agent.id, human.id);
    expect(await author(agentNodeId)).toEqual({ ...unclaimed, claimed: true });

    const humanNodeId = await createFile(origin, human.cookie, "Human sheet");
    await put(origin, `/api/nodes/${humanNodeId}/link-sharing`, { enabled: true, role: "viewer" }, human.cookie);
    expect(await author(humanNodeId)).toEqual({ displayName: "alice", kind: "human" });

    const team = (await (await post(origin, "/api/team-spaces", { name: "Team", publicRead: true }, { cookie: human.cookie })).json()) as { id: string };
    const folder = (await (await post(origin, "/api/nodes", { spaceId: team.id, parentNodeId: null, name: "Plans" }, { cookie: human.cookie })).json()) as { id: string };
    expect(await author(folder.id)).toBeNull();
  });
});

describe("POST /api/nodes/:nodeId/reports", () => {
  it("stores a report from an anonymous reader or a session and logs it without the reason", async () => {
    const { origin, application } = await start();
    const owner = await register(origin, "owner");
    const reader = await register(origin, "reader");
    const nodeId = await createFile(origin, owner.cookie, "Shared sheet");
    await put(origin, `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "viewer" }, owner.cookie);
    const warn = vi.spyOn(logger, "warn");

    const anonymous = await post(origin, `/api/nodes/${nodeId}/reports`, { reason: "  phishing page  " });
    expect(anonymous.status).toBe(201);
    const first = (await anonymous.json()) as { id: string };
    const signedIn = await post(origin, `/api/nodes/${nodeId}/reports`, { reason: "spam" }, { cookie: reader.cookie });
    expect(signedIn.status).toBe(201);
    const second = (await signedIn.json()) as { id: string };

    expect(application.database.connection
      .prepare("SELECT id, node_id, reporter_user_id, reason FROM node_reports ORDER BY created_at, rowid")
      .all().map((row) => ({ ...row }))).toEqual([
      { id: first.id, node_id: nodeId, reporter_user_id: null, reason: "phishing page" },
      { id: second.id, node_id: nodeId, reporter_user_id: reader.id, reason: "spam" },
    ]);
    const logged = warn.mock.calls.filter(([fields]) => (fields as { event?: string }).event === "node_reported");
    warn.mockRestore();
    expect(logged.map(([fields]) => fields)).toEqual([
      { event: "node_reported", nodeId, reportId: first.id },
      { event: "node_reported", nodeId, reportId: second.id },
    ]);
    expect(JSON.stringify(logged)).not.toContain("phishing");
  });

  it("answers not found for a Node the requester cannot read, and rejects a missing or oversized reason", async () => {
    const { origin, application } = await start();
    const owner = await register(origin, "owner");
    const nodeId = await createFile(origin, owner.cookie, "Private sheet");
    const stranger = await register(origin, "stranger");
    for (const headers of [{}, { cookie: stranger.cookie }]) {
      const hidden = await post(origin, `/api/nodes/${nodeId}/reports`, { reason: "guess" }, headers);
      expect(hidden.status).toBe(404);
      expect(await hidden.json()).toEqual(await (await fetch(`${origin}/api/nodes/${nodeId}`, { headers })).json());
    }
    expect((await post(origin, `/api/nodes/${randomUUID()}/reports`, { reason: "guess" })).status).toBe(404);
    for (const body of [{}, { reason: "   " }, { reason: 5 }, { reason: "x".repeat(1001) }]) {
      const invalid = await post(origin, `/api/nodes/${nodeId}/reports`, body, { cookie: owner.cookie });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_INPUT", field: "reason" } });
    }
    expect(application.database.connection.prepare("SELECT COUNT(*) AS reports FROM node_reports").get()).toMatchObject({ reports: 0 });
  });

  it("limits reports to 10 per source IP per hour", async () => {
    const { origin, application } = await start({ trustProxy: true });
    const owner = await register(origin, "owner");
    const nodeId = await createFile(origin, owner.cookie, "Shared sheet");
    await put(origin, `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "viewer" }, owner.cookie);
    const report = (ip: string, body: unknown = { reason: "spam" }) =>
      post(origin, `/api/nodes/${nodeId}/reports`, body, { "x-forwarded-for": ip });

    // An invalid report does not spend the limit.
    expect((await report("203.0.113.7", {})).status).toBe(400);
    for (let count = 1; count <= 10; count += 1) expect((await report("203.0.113.7")).status).toBe(201);
    const limited = await report("203.0.113.7");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "REPORT_RATE_LIMITED" } });
    expect((await report("203.0.113.8")).status).toBe(201);
    expect(application.database.connection.prepare("SELECT COUNT(*) AS reports FROM node_reports").get()).toMatchObject({ reports: 11 });
  });
});

describe("agent expiry", () => {
  it("moves an unclaimed agent's expiry 30 days out when it authenticates, at most once a day", async () => {
    const { origin, application } = await start();
    const agent = await createAgent(origin);
    const lifecycle = agentLifecycle(application, agent.id);
    const authenticate = () => fetch(`${origin}/api/spaces`, { headers: { cookie: agent.cookie } });

    lifecycle.set({ last_active_at: Date.now() - 25 * HOUR, expires_at: Date.now() + DAY });
    let before = Date.now();
    expect((await authenticate()).status).toBe(200);
    expect(lifecycle.get().last_active_at).toBeGreaterThanOrEqual(before);
    expect(lifecycle.get().expires_at).toBeGreaterThanOrEqual(before + 30 * DAY);

    // Seen within the day: the next request leaves the row alone.
    const soon = Date.now() + DAY;
    lifecycle.set({ last_active_at: Date.now() - 23 * HOUR, expires_at: soon });
    await authenticate();
    await exchange(origin, agent.token);
    expect(lifecycle.get().expires_at).toBe(soon);

    // Already expired: the next request brings it back even when it was seen within the day.
    lifecycle.set({ last_active_at: Date.now() - HOUR, expires_at: Date.now() - HOUR });
    before = Date.now();
    expect((await authenticate()).status).toBe(200);
    expect(lifecycle.get().expires_at).toBeGreaterThanOrEqual(before + 30 * DAY);

    lifecycle.set({ last_active_at: Date.now() - 25 * HOUR, expires_at: 1 });
    before = Date.now();
    expect((await exchange(origin, agent.token)).status).toBe(200);
    expect(lifecycle.get().expires_at).toBeGreaterThanOrEqual(before + 30 * DAY);

    const human = await register(origin, "claimer");
    application.database.connection
      .prepare("UPDATE agents SET owner_user_id = ?, claimed_at = 1, expires_at = NULL, last_active_at = 0 WHERE user_id = ?")
      .run(human.id, agent.id);
    before = Date.now();
    await authenticate();
    expect(lifecycle.get()).toEqual({ last_active_at: expect.any(Number), expires_at: null });
    expect(lifecycle.get().last_active_at).toBeGreaterThanOrEqual(before);
  });

  it("closes an expired agent's link to anonymous readers until the agent is active again", async () => {
    const { origin, application } = await start();
    const pages = await startPages(application);
    const agent = await createAgent(origin);
    const nodeId = await createFile(origin, agent.cookie, "Budget");
    const lifecycle = agentLifecycle(application, agent.id);
    const page = async () => (await fetch(`${pages}/nodes/${nodeId}`)).text();
    expect(await page()).toContain("<title>Budget · Univer Workspace</title>");

    const expired = { last_active_at: Date.now() - 31 * DAY, expires_at: Date.now() - DAY };
    lifecycle.set(expired);
    expect(await accessRole(origin, nodeId, undefined)).toBeNull();
    expect(await page()).toContain("<title>Univer Workspace</title>");
    expect(lifecycle.get()).toEqual(expired);

    expect((await fetch(`${origin}/api/spaces`, { headers: { cookie: agent.cookie } })).status).toBe(200);
    expect(await accessRole(origin, nodeId, undefined)).toBe("viewer");
    expect(await page()).toContain("<title>Budget · Univer Workspace</title>");
  });

  it("moves the expiry out when a reader opens the page of the agent's file, at most once a day", async () => {
    const { origin, application } = await start();
    const pages = await startPages(application);
    const agent = await createAgent(origin);
    const nodeId = await createFile(origin, agent.cookie, "Budget");
    const folder = await post(origin, "/api/nodes", { spaceId: await personalSpaceId(origin, agent.cookie), parentNodeId: null, name: "Drafts" }, { cookie: agent.cookie });
    const folderId = ((await folder.json()) as { id: string }).id;
    const lifecycle = agentLifecycle(application, agent.id);

    lifecycle.set({ last_active_at: Date.now() - 25 * HOUR, expires_at: Date.now() + DAY });
    const stale = lifecycle.get();
    expect(await (await fetch(`${pages}/nodes/${folderId}`)).text()).toContain("<title>Univer Workspace</title>");
    expect(lifecycle.get()).toEqual(stale);

    const before = Date.now();
    expect(await (await fetch(`${pages}/nodes/${nodeId}`)).text()).toContain("<title>Budget · Univer Workspace</title>");
    await expect.poll(() => lifecycle.get().last_active_at).toBeGreaterThanOrEqual(before);
    expect(lifecycle.get().expires_at).toBeGreaterThanOrEqual(before + 30 * DAY);

    lifecycle.set({ last_active_at: Date.now() - 23 * HOUR, expires_at: Date.now() + DAY });
    const fresh = lifecycle.get();
    await fetch(`${pages}/nodes/${nodeId}`);
    expect(lifecycle.get()).toEqual(fresh);

    const human = await register(origin, "claimer");
    await linkOpenedEarlier(application, agent.id, nodeId);
    claim(application, agent.id, human.id);
    lifecycle.set({ last_active_at: 0, expires_at: null });
    expect(await (await fetch(`${pages}/nodes/${nodeId}`)).text()).toContain("<title>Budget · Univer Workspace</title>");
    expect(lifecycle.get()).toEqual({ last_active_at: 0, expires_at: null });
  });
});

/** Link Sharing an unclaimed agent turned on while it still could. No session can turn it on now, so the repository writes it. */
async function linkOpenedEarlier(application: SqliteTestApplication, agentId: string, nodeId: string): Promise<void> {
  await application.repositories.permissions.upsertLinkSharing({ nodeId, enabled: true, role: "viewer", actorUserId: agentId, now: Date.now() }, () => {});
}

function agentLifecycle(application: SqliteTestApplication, agentId: string) {
  type Lifecycle = { last_active_at: number; expires_at: number | null };
  return {
    get: (): Lifecycle => ({
      ...(application.database.connection
        .prepare("SELECT last_active_at, expires_at FROM agents WHERE user_id = ?")
        .get(agentId) as unknown as Lifecycle),
    }),
    set: (value: Lifecycle) => {
      application.database.connection
        .prepare("UPDATE agents SET last_active_at = ?, expires_at = ? WHERE user_id = ?")
        .run(value.last_active_at, value.expires_at, agentId);
    },
  };
}

/** The share-page route the production build mounts when the web bundle exists. */
async function startPages(application: SqliteTestApplication): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "workspace-agent-pages-"));
  directories.push(directory);
  writeFileSync(join(directory, "index.html"), "<!doctype html><html><head><title>Univer Workspace</title></head><body></body></html>");
  const app = express();
  app.use(createStaticSiteRouter(directory, { nodes: application.nodes, identity: application.identity, permissions: application.permissions }));
  return listen(createServer(app));
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function start(config: Partial<WorkspaceConfig> = {}): Promise<{ origin: string; application: SqliteTestApplication }> {
  const application = await createSqliteTestApplication({
    host: "127.0.0.1",
    port: 0,
    database: { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    passwordAuthEnabled: true,
    emailAuth: null,
    agentCreateLimitPerHour: 100,
    oauthClients: {
      clients: [{ clientId: GATEWAY_ID, clientType: "confidential", clientSecret: GATEWAY_SECRET, tokenExchange: true, redirectUris: ["https://gw.example.test/cb"], scopes: ["identity"] }],
    },
    ...config,
  }, {
    unitStore: {
      async createUnit(input) {
        await delay(unitStoreDelayMs);
        if (unitStoreFails) throw new UnitStoreError("UNIT_STORE_DOWN", "The Unit store is down.", false);
        return { unitId: input.unitId, headRevision: 1 };
      },
    },
    worktreeBackend: memoryWorktreeBackend(),
  });
  applications.push(application);
  return { origin: await listen(createServer(application.app)), application };
}

async function createAgent(origin: string): Promise<Agent> {
  const created = (await (await post(origin, "/api/agents", {})).json()) as { agent: { id: string; username: string }; token: string };
  return { ...created.agent, token: created.token, cookie: await tokenSession(origin, created.token) };
}

async function tokenSession(origin: string, token: string): Promise<string> {
  const response = await exchange(origin, token);
  if (response.status !== 200) throw new Error(`Token exchange failed with ${response.status}`);
  return `workspace_session=${((await response.json()) as { access_token: string }).access_token}`;
}

async function register(origin: string, username: string): Promise<{ id: string; cookie: string }> {
  const response = await post(origin, "/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" });
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  const body = (await response.json()) as { user: { id: string } };
  return { id: body.user.id, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
}

async function createFile(origin: string, cookie: string, name: string): Promise<string> {
  const response = await createFileRequest(origin, cookie, name);
  if (response.status !== 201) throw new Error(`File creation failed with ${response.status}`);
  return ((await response.json()) as { node: { id: string } }).node.id;
}

async function createFileRequest(origin: string, cookie: string, name: string, key: string = randomUUID()): Promise<Response> {
  return post(
    origin,
    "/api/resources",
    { kind: "univer", spaceId: await personalSpaceId(origin, cookie), parentNodeId: null, name, unitType: "sheet" },
    { cookie, "idempotency-key": key },
  );
}

/** The requester's role on the node, or null when the node route answers not found. */
async function accessRole(origin: string, nodeId: string, cookie: string | undefined): Promise<string | null> {
  const response = await fetch(`${origin}/api/nodes/${nodeId}`, { headers: cookie ? { cookie } : {} });
  if (response.status === 404) return null;
  return ((await response.json()) as { node: { accessRole: string } }).node.accessRole;
}

function put(origin: string, path: string, body: unknown, cookie: string): Promise<Response> {
  return send(origin, "PUT", path, body, { cookie });
}

async function session(origin: string, cookie: string): Promise<{ authenticated: boolean; user?: unknown }> {
  return (await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json()) as { authenticated: boolean; user?: unknown };
}

function post(origin: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return send(origin, "POST", path, body, headers);
}

function send(origin: string, method: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function exchange(origin: string, subjectToken: string): Promise<Response> {
  return fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      client_id: GATEWAY_ID,
      client_secret: GATEWAY_SECRET,
      subject_token: subjectToken,
    }),
  });
}
