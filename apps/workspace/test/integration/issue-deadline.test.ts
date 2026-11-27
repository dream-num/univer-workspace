import { agentPrincipal, interactivePrincipal } from "../fixtures/principal.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

const HOUR = 60 * 60 * 1000;
const PASSWORD = "correct horse battery staple";
const cleanups: AsyncDisposableStack[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup.disposeAsync();
  vi.useRealTimers();
});

const refused = (code: string) => expect.objectContaining({ code });

it("accepts a submitted Issue when its Space deadline passes and attributes the acceptance to no one", async () => {
  const { applications: [application], owner, agent, team, origin } = await setup();
  const { issues } = application!;
  const cookie = await login(origin, "owner");
  const patch = (body: unknown) => fetch(`${origin}/api/spaces/${team}`, {
    method: "PATCH", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body),
  });
  for (const invalid of [0, 721, 1.5, "72"]) expect((await patch({ acceptAfterHours: invalid })).status).toBe(400);
  expect(await (await patch({ acceptAfterHours: 72 })).json()).toMatchObject({ acceptAfterHours: 72 });
  await expect(application!.spaces.update(agentPrincipal(agent, true), team, { acceptAfterHours: null })).rejects.toEqual(refused("FORBIDDEN"));

  const issue = await issues.create(owner, team, { title: "Fix totals", assigneeUserIds: [agent] });
  const { acceptance } = await issues.verdict(agent, team, issue.number, { kind: "submitted", body: "Fixed B12." });
  const submitted = Date.parse(acceptance!.createdAt);
  expect(await issues.acceptDue(submitted + 72 * HOUR - 1, 25)).toBe(0);
  expect((await issues.get(owner, team, issue.number)).state).toBe("open");

  vi.setSystemTime(submitted + 72 * HOUR);
  expect(await issues.acceptDue(Date.now(), 25)).toBe(1);
  expect(await issues.get(owner, team, issue.number)).toMatchObject({
    state: "closed", stateReason: "completed", closedBy: null,
    acceptance: { kind: "accepted", actor: null, body: "" },
  });
  const events = (await issues.timeline(owner, team, issue.number, {})).items.flatMap((item) =>
    item.type === "event" ? [[item.kind, item.actor?.id ?? null]] : []);
  expect(events).toEqual([["assigned", owner], ["submitted", agent], ["accepted", null]]);
  const later = await login(origin, "owner");
  const activity = await (await fetch(`${origin}/api/spaces/${team}/activity?timeZone=UTC`, { headers: { cookie: later } })).json();
  expect(activity.events).toContainEqual(expect.objectContaining({
    kind: "issue-closed", actor: null, issue: expect.objectContaining({ number: issue.number }),
  }));
  await expect(issues.verdict(owner, team, issue.number, { kind: "accepted" })).rejects.toEqual(refused("ISSUE_CLOSED"));
  expect(await issues.acceptDue(Date.now() + 1000 * HOUR, 25)).toBe(0);
}, 120_000);

it("stops the clock on a send-back, restarts it on the next submission, and never accepts while the setting is off", async () => {
  const { applications: [application], owner, agent, team } = await setup();
  const { issues } = application!;
  const issue = await issues.create(owner, team, { title: "Add West", assigneeUserIds: [agent] });
  const verdict = (userId: string, kind: string, body?: string) =>
    issues.verdict(userId, team, issue.number, body === undefined ? { kind } : { kind, body });

  await verdict(agent, "submitted", "Done.");
  expect(await issues.acceptDue(Date.now() + 1000 * HOUR, 25), "the setting is off by default").toBe(0);

  await application!.spaces.update(interactivePrincipal(owner), team, { acceptAfterHours: 1 });
  const first = Date.now();
  vi.setSystemTime(first + HOUR / 2);
  await verdict(owner, "sent_back", "West is missing.");
  expect(await issues.acceptDue(first + 10 * HOUR, 25)).toBe(0);
  expect((await issues.get(owner, team, issue.number)).acceptance).toMatchObject({ kind: "sent_back" });

  vi.setSystemTime(first + 5 * HOUR);
  const second = Date.parse((await verdict(agent, "submitted", "Added West.")).acceptance!.createdAt);
  expect(await issues.acceptDue(second + HOUR - 1, 25), "the first submission no longer counts").toBe(0);

  await application!.spaces.update(interactivePrincipal(owner), team, { acceptAfterHours: null });
  expect(await issues.acceptDue(second + 1000 * HOUR, 25), "turning it off stops it").toBe(0);
  await application!.spaces.update(interactivePrincipal(owner), team, { acceptAfterHours: 1 });
  expect(await issues.acceptDue(second + HOUR, 25)).toBe(1);
  expect(await issues.get(owner, team, issue.number)).toMatchObject({ state: "closed", acceptance: { kind: "accepted", actor: null } });
}, 120_000);

it("restarts the clock when someone reopens a submitted Issue another person closed", async () => {
  const { applications: [application], owner, agent, team } = await setup();
  const { issues } = application!;
  await application!.spaces.update(interactivePrincipal(owner), team, { acceptAfterHours: 1 });
  const issue = await issues.create(owner, team, { title: "Add North", assigneeUserIds: [agent] });
  const { acceptance } = await issues.verdict(agent, team, issue.number, { kind: "submitted", body: "Done." });
  const submitted = Date.parse(acceptance!.createdAt);
  expect(acceptance!.deadline).toBe(new Date(submitted + HOUR).toISOString());

  vi.setSystemTime(submitted + HOUR / 2);
  const closed = await issues.update(owner, team, issue.number, { state: "closed", stateReason: "not_planned" });
  expect(closed.acceptance).toMatchObject({ kind: "submitted", deadline: null });
  vi.setSystemTime(submitted + 3 * HOUR);
  const reopened = await issues.update(owner, team, issue.number, { state: "open" });
  const reopenedAt = Date.parse((await issues.timeline(owner, team, issue.number, {})).items.findLast((item) =>
    item.type === "event" && item.kind === "reopened")!.createdAt);
  expect(reopened.acceptance).toMatchObject({ kind: "submitted", deadline: new Date(reopenedAt + HOUR).toISOString() });

  expect(await issues.acceptDue(reopenedAt + HOUR - 1, 25), "the reopen restarted the clock").toBe(0);
  expect((await issues.get(owner, team, issue.number)).state).toBe("open");
  expect(await issues.acceptDue(reopenedAt + HOUR, 25)).toBe(1);
  expect(await issues.get(owner, team, issue.number)).toMatchObject({
    state: "closed", stateReason: "completed", acceptance: { kind: "accepted", actor: null, deadline: null },
  });
}, 120_000);

it("passes over an Issue whose acceptance fails and still accepts the rest up to the limit", async () => {
  const failing = new Set<string>();
  const { applications: [application], owner, agent, team } = await setup(1, { failAccepting: failing });
  const { issues } = application!;
  await application!.spaces.update(interactivePrincipal(owner), team, { acceptAfterHours: 1 });
  const numbers: number[] = [];
  for (const title of ["Oldest", "Next", "Last"]) {
    const issue = await issues.create(owner, team, { title, assigneeUserIds: [agent] });
    await issues.verdict(agent, team, issue.number, { kind: "submitted", body: "Done." });
    if (title === "Oldest") failing.add(issue.id);
    numbers.push(issue.number);
  }

  expect(await issues.acceptDue(Date.now() + HOUR, 2)).toBe(2);
  const states = await Promise.all(numbers.map(async (number) => (await issues.get(owner, team, number)).state));
  expect(states).toEqual(["open", "closed", "closed"]);
}, 120_000);

it("tries at most four times its limit per pass, and Issues that keep failing do not hold back the rest", async () => {
  const failing = new Set<string>();
  const { applications: [application], owner, agent, team, attempts } = await setup(1, { failAccepting: failing });
  const { issues } = application!;
  await application!.spaces.update(interactivePrincipal(owner), team, { acceptAfterHours: 1 });
  const submit = async (title: string) => {
    const issue = await issues.create(owner, team, { title, assigneeUserIds: [agent] });
    await issues.verdict(agent, team, issue.number, { kind: "submitted", body: "Done." });
    return issue;
  };
  for (let index = 0; index < 10; index++) failing.add((await submit(`Stuck ${index}`)).id);
  const healthy = await submit("Healthy");

  let passes = 0;
  while ((await issues.get(owner, team, healthy.number)).state === "open") {
    expect(++passes, "the healthy Issue is reached").toBeLessThan(30);
    attempts.length = 0;
    await issues.acceptDue(Date.now() + HOUR, 2);
    expect(attempts.length).toBeLessThanOrEqual(8);
  }
}, 120_000);

it("announces the Issues a pass accepted even when listing due Issues again would fail", async () => {
  const failing = new Set<string>();
  const { applications: [application], owner, agent, team, origin } = await setup(1, { failAccepting: failing, listings: 1 });
  const { issues } = application!;
  await application!.spaces.update(interactivePrincipal(owner), team, { acceptAfterHours: 1 });
  for (const title of ["Oldest", "Next"]) {
    const issue = await issues.create(owner, team, { title, assigneeUserIds: [agent] });
    await issues.verdict(agent, team, issue.number, { kind: "submitted", body: "Done." });
    if (title === "Oldest") failing.add(issue.id);
  }
  const socket = await connect(origin, await login(origin, "owner"));
  const announced = nextMessage(socket);

  expect(await issues.acceptDue(Date.now() + HOUR, 2)).toBe(1);
  await expect(announced).resolves.toEqual({ event: "issuesChanged", spaceId: team });
  socket.close();
}, 120_000);

it("records one acceptance and one close per Issue when two replicas run the job together, in bounded passes", async () => {
  const { applications, owner, agent, team } = await setup(2);
  const [first, second] = [applications[0]!, applications.at(-1)!];
  await first.spaces.update(interactivePrincipal(owner), team, { acceptAfterHours: 1 });
  const numbers: number[] = [];
  for (const title of ["One", "Two", "Three"]) {
    const { number } = await first.issues.create(owner, team, { title, assigneeUserIds: [agent] });
    await first.issues.verdict(agent, team, number, { kind: "submitted", body: "Done." });
    numbers.push(number);
  }
  const due = Date.now() + HOUR;
  expect(await first.issues.acceptDue(due, 1), "a pass takes at most its limit").toBe(1);

  const passes = await Promise.all([first.issues.acceptDue(due, 25), second.issues.acceptDue(due, 25)]);
  expect(passes[0]! + passes[1]!).toBe(2);
  for (const number of numbers) {
    const kinds = (await second.issues.timeline(owner, team, number, {})).items.flatMap((item) =>
      item.type === "event" ? [item.kind] : []);
    expect(kinds.filter((kind) => kind === "accepted")).toHaveLength(1);
    expect(kinds).not.toContain("closed");
    expect(await second.issues.get(owner, team, number)).toMatchObject({ state: "closed", closedBy: null });
  }
}, 120_000);

/** Replicas share only the database, so more than one needs PostgreSQL. `listings` caps the due listings that succeed. */
async function setup(
  replicas = 1,
  { failAccepting = new Set(), listings = Infinity }: { readonly failAccepting?: ReadonlySet<string>; readonly listings?: number } = {},
) {
  // The Issue module reads the clock it finds when the application is created.
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const cleanup = new AsyncDisposableStack();
  cleanups.push(cleanup);
  const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
  const postgres = url ? await createPostgresTestDatabase(url) : undefined;
  if (postgres) cleanup.defer(postgres.close);
  const config: WorkspaceConfig = {
    ...loadConfig({}),
    host: "127.0.0.1",
    port: 0,
    secureCookies: false,
    passwordAuthEnabled: true,
    agentCreateLimitPerHour: 100,
    ...(postgres && { s3BlobStore: await createTestBucket(cleanup) }),
    database: postgres
      ? { provider: "postgres", connectionString: postgres.connectionString }
      : { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
  };
  const applications: WorkspaceApplication[] = [];
  const attempts: string[] = [];
  let listed = 0;
  let claimAgent: ((agentId: string, ownerId: string) => Promise<unknown>) | undefined;
  for (let replica = 0; replica < (postgres ? replicas : 1); replica++) {
    const database = await openProductDatabase(config.database);
    cleanup.defer(() => database.close());
    claimAgent ??= (agentId, ownerId) => database.repositories.identity.claimAgent(agentId, ownerId, Date.now());
    const collaboration = await openCollaborationDatabase(config, database.unitCreationFacts);
    cleanup.defer(() => collaboration.close());
    const real = database.repositories.issues;
    const issuesRepository = new Proxy(real, {
      get(target, key) {
        if (key === "acceptDueIssue") {
          return (issueId: string, now: number) => {
            attempts.push(issueId);
            return failAccepting.has(issueId) ? Promise.reject(new Error("acceptance failed")) : target.acceptDueIssue(issueId, now);
          };
        }
        if (key === "listDueIssues") {
          return (...args: Parameters<typeof target.listDueIssues>) =>
            ++listed > listings ? Promise.reject(new Error("listing failed")) : target.listDueIssues(...args);
        }
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const application = createWorkspaceApplication(config, { ...database.repositories, issues: issuesRepository }, collaboration);
    cleanup.defer(() => application.close());
    await application.initialize();
    applications.push(application);
  }
  const [application] = applications;
  const server = createServer(application!.app);
  application!.attachWebSocket(server);
  cleanup.defer(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const owner = (await application!.identity.registerWithPassword({ username: "owner", displayName: "Owner", password: PASSWORD })).view.user.id;
  const { user } = await application!.identity.createAgent({ label: "worker", originIp: "203.0.113.9" });
  await claimAgent!(user.id, owner);
  const { id: team } = await application!.spaces.createTeamSpace(interactivePrincipal(owner), { name: "Team" });
  await application!.permissions.upsertTeamMember(interactivePrincipal(owner), team, user.id, { role: "viewer" });
  return { applications, owner, agent: user.id, team, origin, attempts };
}

async function login(origin: string, username: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/password/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PASSWORD }),
  });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function connect(origin: string, cookie: string): Promise<WebSocket> {
  const { ticket } = await (await fetch(`${origin}/universer-api/user/session-ticket`, { headers: { cookie } })).json() as { ticket: string };
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/worktree-events?sessionTicket=${encodeURIComponent(ticket)}`);
  const ready = nextMessage(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Change feed did not open")), { once: true });
  });
  expect(await ready).toEqual({ event: "worktreeChangeFeedReady" });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(JSON.parse(String(event.data)) as unknown), { once: true });
  });
}
