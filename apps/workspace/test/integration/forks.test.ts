import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface Actor {
  readonly id: string;
  readonly username: string;
  readonly cookie: string;
}

describe("forks", () => {
  it("records a fork of a Team Space with 500 files as one product row and nothing in Collaboration (A4.1)", async () => {
    const { origin, database } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const team = await createRepo(origin, holder, "Team");
    for (let file = 1; file <= 500; file += 1) await createSheet(origin, holder, team, `Sheet ${file}`);
    expect((await setRole(origin, team, holder, agent.id, "viewer")).status).toBe(200);

    const before = await database.rowCounts();
    expect(before.resources).toBe(500);
    expect(Object.entries(before).find(([table]) => /^collaboration\.(collaboration_)?units$/.test(table))?.[1]).toBe(500);
    const created = await send(origin, "POST", "/api/forks", { upstreamSpaceId: team, name: "fix-totals" }, agent.cookie);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      name: "fix-totals", fullName: "agent/fix-totals", owner: { id: agent.id, username: "agent" },
      upstream: { id: team, accessRole: "viewer", affiliation: "member" }, state: "clean", worktree: null,
    });
    const after = await database.rowCounts();
    expect(changedCounts(before, after)).toEqual({ forks: 1 });
  }, 180_000);

  it("is seen, looked up and deleted only by its owner, and never through the Space lookup", async () => {
    const { origin } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const team = await createRepo(origin, holder, "Team");
    await setRole(origin, team, holder, agent.id, "editor");
    const fork = await createFork(origin, agent, team, "fix-totals");

    expect((await send(origin, "GET", `/api/forks/${fork}`, undefined, holder.cookie)).status).toBe(404);
    expect((await send(origin, "GET", "/api/forks/lookup?owner=agent&name=fix-totals", undefined, holder.cookie)).status).toBe(404);
    expect(await forkIds(origin, holder)).toEqual([]);
    expect((await send(origin, "DELETE", `/api/forks/${fork}`, undefined, holder.cookie)).status).toBe(404);
    expect((await send(origin, "GET", `/api/forks/${fork}`)).status).toBe(401);

    expect(await forkIds(origin, agent)).toEqual([fork]);
    const looked = await send(origin, "GET", "/api/forks/lookup?owner=AGENT&name=Fix-Totals", undefined, agent.cookie);
    expect(await looked.json()).toMatchObject({ id: fork, fullName: "agent/fix-totals" });
    expect((await send(origin, "GET", "/api/spaces/lookup?owner=agent&slug=fix-totals", undefined, agent.cookie)).status).toBe(404);

    const removed = await send(origin, "DELETE", `/api/forks/${fork}`, undefined, agent.cookie);
    expect({ status: removed.status, body: await removed.json() }).toEqual({ status: 200, body: { worktree: null } });
    expect((await send(origin, "GET", `/api/forks/${fork}`, undefined, agent.cookie)).status).toBe(404);
  }, 60_000);

  it("takes several names for one upstream, returns a repeated create, and keeps one name per owner (A4.11)", async () => {
    const { origin, database } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const [team, other] = [await createRepo(origin, holder, "Team"), await createRepo(origin, holder, "Other")];
    await setRole(origin, team, holder, agent.id, "viewer");
    await setRole(origin, other, holder, agent.id, "viewer");

    const first = await createFork(origin, agent, team, "fix-totals");
    const second = await createFork(origin, agent, team, "add-forecast");
    expect(second).not.toBe(first);
    const repeated = await send(origin, "POST", "/api/forks", { upstreamSpaceId: team, name: "FIX-totals" }, agent.cookie);
    expect({ status: repeated.status, id: ((await repeated.json()) as { id: string }).id }).toEqual({ status: 200, id: first });
    await expectError(send(origin, "POST", "/api/forks", { upstreamSpaceId: other, name: "fix-totals" }, agent.cookie), 409, "SPACE_SLUG_TAKEN");
    expect(await forkIds(origin, agent)).toEqual([second, first]);
    expect((await database.rowCounts()).forks).toBe(2);
  }, 60_000);

  it("needs a role in a readable Team Space and a valid name", async () => {
    const { origin } = await start();
    const [holder, reader] = await Promise.all([person(origin, "holder"), person(origin, "reader")]);
    const team = await createRepo(origin, holder, "Team");
    const create = (actor: Actor, upstreamSpaceId: unknown, name: unknown) =>
      send(origin, "POST", "/api/forks", { upstreamSpaceId, name }, actor.cookie);

    await expectError(create(reader, team, "fix"), 404, "NOT_FOUND");
    expect((await send(origin, "PATCH", `/api/spaces/${team}`, { publicRead: true }, holder.cookie)).status).toBe(200);
    const refused = await expectError(create(reader, team, "fix"), 403, "FORBIDDEN");
    expect(refused.message).toMatch(/membership/);
    await expectError(create(reader, await personalSpace(origin, reader), "fix"), 404, "NOT_FOUND");
    await expectError(create(holder, await personalSpace(origin, holder), "fix"), 404, "NOT_FOUND");
    for (const name of ["personal", "a/b", "-lead", "", 7]) await expectError(create(holder, team, name), 400, "INVALID_INPUT");
    await expectError(create(holder, undefined, "fix"), 400, "INVALID_INPUT");
    expect(await createFork(origin, holder, team, "own-fork")).toBeTruthy();
    expect(await forkIds(origin, reader)).toEqual([]);
  }, 60_000);

  it("shares one namespace with the owner's Team Space slugs in both directions", async () => {
    const { origin } = await start();
    const owner = await person(origin, "owner");
    const team = await createRepo(origin, owner, "Team");
    const budget = await createRepo(origin, owner, "Budget");

    await expectError(send(origin, "POST", "/api/forks", { upstreamSpaceId: team, name: "BUDGET" }, owner.cookie), 409, "SPACE_SLUG_TAKEN");
    await createFork(origin, owner, team, "fix-totals");
    await expectError(send(origin, "POST", "/api/team-spaces", { name: "Fix", slug: "Fix-Totals" }, owner.cookie), 409, "SPACE_SLUG_TAKEN");
    await expectError(send(origin, "PATCH", `/api/spaces/${budget}`, { slug: "FIX-TOTALS" }, owner.cookie), 409, "SPACE_SLUG_TAKEN");
    const derived = await send(origin, "POST", "/api/team-spaces", { name: "Fix Totals" }, owner.cookie);
    expect({ status: derived.status, slug: ((await derived.json()) as { slug: string }).slug }).toEqual({ status: 201, slug: "fix-totals-2" });

    const other = await person(origin, "other");
    expect((await send(origin, "POST", "/api/team-spaces", { name: "Fix", slug: "fix-totals" }, other.cookie)).status).toBe(201);
  }, 60_000);

  it("caps an unclaimed agent at three forks", async () => {
    const { origin } = await start();
    const agent = await guestAgent(origin);
    const repo = await createRepo(origin, agent, "Research");
    for (const name of ["one", "two", "three"]) await createFork(origin, agent, repo, name);
    await expectError(send(origin, "POST", "/api/forks", { upstreamSpaceId: repo, name: "four" }, agent.cookie), 403, "AGENT_QUOTA_EXCEEDED");
    expect((await send(origin, "POST", "/api/forks", { upstreamSpaceId: repo, name: "two" }, agent.cookie)).status).toBe(200);

    const claimed = await guestAgent(origin);
    await claim(origin, claimed, await person(origin, "claimer"));
    const claimedRepo = await createRepo(origin, claimed, "Claimed");
    for (const name of ["one", "two", "three", "four"]) await createFork(origin, claimed, claimedRepo, name);
  }, 60_000);

  it("leaves its Worktrees and their history to the upstream when deleted (A4.10)", async () => {
    const { origin, database } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const team = await createRepo(origin, holder, "Team");
    const budget = await createSheet(origin, holder, team, "Budget");
    await setRole(origin, team, holder, agent.id, "viewer");
    const fork = await createFork(origin, agent, team, "fix-totals");
    const done = await createPull(origin, agent, team, budget.resourceId);
    expect(await transition(origin, done, "discard", agent)).toBe("discarded");
    const open = await createPull(origin, agent, team, budget.resourceId);
    await database.run("UPDATE worktrees SET fork_id = $1 WHERE id IN ($2, $3)", [fork, done, open]);

    const drafting = (await (await send(origin, "GET", `/api/forks/${fork}`, undefined, agent.cookie)).json()) as Record<string, unknown>;
    expect(drafting).toMatchObject({ state: "drafting", worktree: { id: open, state: "draft", teamSpace: { id: team } } });
    expect(drafting.worktree).not.toHaveProperty("units");
    expect(await transition(origin, open, "ready", agent)).toBe("ready");
    expect(await (await send(origin, "GET", `/api/forks/${fork}`, undefined, agent.cookie)).json()).toMatchObject({ state: "proposed" });
    const second = await createPull(origin, agent, team, budget.resourceId);
    await expect(database.run("UPDATE worktrees SET fork_id = $1 WHERE id = $2", [fork, second])).rejects.toThrow(/UNIQUE|worktrees_open_fork/);

    const removed = await send(origin, "DELETE", `/api/forks/${fork}`, undefined, agent.cookie);
    expect({ status: removed.status, body: await removed.json() }).toMatchObject({ status: 200, body: { worktree: { id: open, state: "ready" } } });
    expect(await database.all("SELECT id, fork_id FROM worktrees WHERE id IN ($1, $2) ORDER BY id", [done, open]))
      .toEqual([done, open].sort().map((id) => ({ id, fork_id: null })));
    for (const [id, state] of [[done, "discarded"], [open, "ready"]] as const) {
      const worktree = await send(origin, "GET", `/api/worktrees/${id}`, undefined, agent.cookie);
      expect(await worktree.json()).toMatchObject({ worktree: { id, state, units: [{ resourceId: budget.resourceId }] } });
    }
    expect(await transition(origin, open, "merge", holder)).toBe("merged");
  }, 60_000);

  it("stays readable and deletable by its owner after the upstream and its Worktree are gone", async () => {
    const { origin, database } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const team = await createRepo(origin, holder, "Team");
    const budget = await createSheet(origin, holder, team, "Budget");
    await setRole(origin, team, holder, agent.id, "viewer");
    const [kept, orphaned] = [await createFork(origin, agent, team, "fix-totals"), await createFork(origin, agent, team, "orphaned")];
    await database.run("UPDATE worktrees SET fork_id = $1 WHERE id = $2", [orphaned, await createPull(origin, holder, team, budget.resourceId)]);
    expect((await send(origin, "DELETE", `/api/team-spaces/${team}/members/${agent.id}`, undefined, holder.cookie)).status).toBe(204);

    for (const fork of [kept, orphaned]) {
      const read = await send(origin, "GET", `/api/forks/${fork}`, undefined, agent.cookie);
      expect({ status: read.status, body: await read.json() }).toMatchObject({ status: 200, body: { id: fork, upstream: null, state: "clean", worktree: null } });
      const removed = await send(origin, "DELETE", `/api/forks/${fork}`, undefined, agent.cookie);
      expect({ status: removed.status, body: await removed.json() }).toEqual({ status: 200, body: { worktree: null } });
    }
    expect(await database.all("SELECT id FROM worktrees WHERE fork_id IS NOT NULL", [])).toEqual([]);
  }, 60_000);
});

interface TestDatabase {
  rowCounts(): Promise<Record<string, number>>;
  run(sql: string, values: readonly unknown[]): Promise<void>;
  all(sql: string, values: readonly unknown[]): Promise<unknown[]>;
}

function testDatabase(config: ProductTestApplication["databaseConfig"]): TestDatabase {
  if (config.provider === "sqlite") {
    const open = (filename: string) => new DatabaseSync(filename);
    const counts = (filename: string, prefix: string) => {
      const db = open(filename);
      try {
        return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
          .map(({ name }) => [`${prefix}${String(name)}`, Number(db.prepare(`SELECT COUNT(*) AS n FROM "${String(name)}"`).get()?.n)]));
      } finally {
        db.close();
      }
    };
    const withProduct = <T>(operation: (db: DatabaseSync) => T) => {
      const db = open(config.filename);
      try {
        return operation(db);
      } finally {
        db.close();
      }
    };
    return {
      async rowCounts() {
        return { ...counts(config.filename, ""), ...counts(config.collaborationFilename, "collaboration.") };
      },
      async run(sql, values) {
        withProduct((db) => db.prepare(sql.replace(/\$\d+/g, "?")).run(...(values as string[])));
      },
      async all(sql, values) {
        return withProduct((db) => db.prepare(sql.replace(/\$\d+/g, "?")).all(...(values as string[])).map((row) => ({ ...row })));
      },
    };
  }
  const connect = async <T>(operation: (client: Client) => Promise<T>) => {
    const client = new Client({ connectionString: config.connectionString });
    await client.connect();
    try {
      return await operation(client);
    } finally {
      await client.end();
    }
  };
  return {
    rowCounts: () => connect(async (client) => {
      const { rows } = await client.query<{ schema: string; name: string }>(`SELECT table_schema AS schema, table_name AS name
        FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')`);
      const counts: Record<string, number> = {};
      for (const { schema, name } of rows) {
        counts[schema === "public" ? name : `${schema}.${name}`] = Number((await client.query(`SELECT COUNT(*) AS n FROM "${schema}"."${name}"`)).rows[0].n);
      }
      return counts;
    }),
    run: (sql, values) => connect(async (client) => void await client.query(sql, [...values])),
    all: (sql, values) => connect(async (client) => (await client.query(sql, [...values])).rows),
  };
}

function changedCounts(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.keys({ ...before, ...after })
    .filter((table) => (after[table] ?? 0) !== (before[table] ?? 0))
    .map((table) => [table, (after[table] ?? 0) - (before[table] ?? 0)]));
}

async function start() {
  const directory = mkdtempSync(join(tmpdir(), "workspace-forks-"));
  directories.push(directory);
  const application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 0,
    productFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    passwordAuthEnabled: true,
    agentCreateLimitPerHour: 100,
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, database: testDatabase(application.databaseConfig) };
}

function send(origin: string, method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectError(request: Promise<Response>, status: number, code: string): Promise<{ message: string }> {
  const response = await request;
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect({ status: response.status, code: body.error.code }).toEqual({ status, code });
  return body.error;
}

async function signedIn(origin: string, response: Response): Promise<Actor> {
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const { user } = (await (await send(origin, "GET", "/api/session", undefined, cookie)).json()) as { user: { id: string; username: string } };
  return { id: user.id, username: user.username, cookie };
}

async function person(origin: string, username: string): Promise<Actor> {
  const response = await send(origin, "POST", "/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" });
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  return signedIn(origin, response);
}

async function guestAgent(origin: string): Promise<Actor> {
  const response = await send(origin, "POST", "/api/auth/guest", {});
  if (response.status !== 201) throw new Error(`Guest creation failed with ${response.status}`);
  return signedIn(origin, response);
}

async function claim(origin: string, agent: Actor, human: Actor): Promise<void> {
  const { code } = (await (await send(origin, "POST", "/api/agents/claim-codes", undefined, agent.cookie)).json()) as { code: string };
  const response = await send(origin, "POST", "/api/agents/claim", { code }, human.cookie);
  if (response.status !== 200) throw new Error(`Claim failed with ${response.status}`);
}

async function personalSpace(origin: string, actor: Actor): Promise<string> {
  const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, actor.cookie)).json()) as { spaces: { id: string; type: string }[] };
  return spaces.find((space) => space.type === "personal")!.id;
}

async function createRepo(origin: string, actor: Actor, name: string): Promise<string> {
  const response = await send(origin, "POST", "/api/team-spaces", { name }, actor.cookie);
  if (response.status !== 201) throw new Error(`Team Space creation failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

function setRole(origin: string, spaceId: string, actor: Actor, userId: string, role: string): Promise<Response> {
  return send(origin, "PUT", `/api/team-spaces/${spaceId}/members/${userId}`, { role }, actor.cookie);
}

async function createSheet(origin: string, actor: Actor, spaceId: string, name: string): Promise<{ resourceId: string }> {
  const response = await send(origin, "POST", "/api/resources", { kind: "univer", spaceId, parentNodeId: null, name, unitType: "sheet" },
    actor.cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 201) throw new Error(`File creation failed with ${response.status}: ${await response.text()}`);
  return { resourceId: ((await response.json()) as { node: { resource: { id: string } } }).node.resource.id };
}

async function createFork(origin: string, actor: Actor, upstreamSpaceId: string, name: string): Promise<string> {
  const response = await send(origin, "POST", "/api/forks", { upstreamSpaceId, name }, actor.cookie);
  if (response.status !== 201) throw new Error(`Fork creation failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

async function forkIds(origin: string, actor: Actor): Promise<string[]> {
  const { forks } = (await (await send(origin, "GET", "/api/forks", undefined, actor.cookie)).json()) as { forks: { id: string }[] };
  return forks.map((fork) => fork.id);
}

async function createPull(origin: string, actor: Actor, spaceId: string, resourceId: string): Promise<string> {
  const created = await send(origin, "POST", "/api/worktrees", { kind: "team", teamSpaceId: spaceId, visibility: "private", name: "fix-totals", summary: null },
    actor.cookie, { "idempotency-key": randomUUID() });
  if (created.status !== 201) throw new Error(`Pull request creation failed with ${created.status}: ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  const unit = await send(origin, "POST", `/api/worktrees/${id}/units`, { source: "trunk", resourceId }, actor.cookie, { "idempotency-key": randomUUID() });
  if (unit.status !== 201) throw new Error(`Adding a Unit failed with ${unit.status}: ${await unit.text()}`);
  return id;
}

async function transition(origin: string, worktreeId: string, action: "ready" | "merge" | "discard", actor: Actor): Promise<string> {
  const response = await send(origin, "POST", `/api/worktrees/${worktreeId}/${action}`, undefined, actor.cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 200) throw new Error(`${action} failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { worktree: { state: string } }).worktree.state;
}
