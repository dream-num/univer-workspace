import { createServer, type Server } from "node:http";
import type { WorktreeData } from "@univerjs-pro/collaboration-worktree-service";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import type { RepositoryActivity } from "../../server/src/modules/activity/activity.service.js";
import type { WorktreeBackend } from "../../server/src/modules/worktrees/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const states = new Map<string, WorktreeData>();
  const transition = async (id: string, status: WorktreeData["status"]): Promise<WorktreeData> => {
    const value = { worktreeID: id, status, units: [] };
    states.set(id, value);
    return value;
  };
  const getWorktree = vi.fn(async (id: string) => {
    const value = states.get(id);
    if (!value) throw new Error("Unavailable worktree");
    return value;
  });
  const unused = async (): Promise<never> => { throw new Error("Unused by activity tests"); };
  const backend: WorktreeBackend = {
    createWorktree: (id) => transition(id, "draft"), getWorktree,
    markReady: (id) => transition(id, "ready"), merge: (id) => transition(id, "merged"),
    discard: (id) => transition(id, "discarded"), reopen: (id) => transition(id, "draft"),
    addUnit: unused, createUnit: unused, setUnitRemoved: unused, submitChangeset: unused,
  };
  const application = createWorkspaceApplication({
    host: "127.0.0.1", port: 0, databaseFilename: ":memory:", collaborationDatabaseFilename: ":memory:",
    secureCookies: false, sessionTtlMs: 600_000,
  }, { unitStore: { async createUnit(input) { return { unitId: input.unitId, headRevision: 1 }; } }, worktreeBackend: backend });
  cleanups.push(() => application.close());
  const server: Server = createServer(application.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP test address");
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (path: string, cookie = "", body?: unknown, method = "POST") => fetch(`${origin}/api${path}`, {
    method: body === undefined ? "GET" : method,
    headers: { cookie, "content-type": "application/json", "idempotency-key": `activity-${crypto.randomUUID()}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const register = async (username: string) => {
    const issued = await application.identity.registerWithPassword({ username, displayName: username, password: "correct horse battery staple" });
    return { user: issued.view.user, cookie: `workspace_session=${issued.cookieValue}` };
  };
  const owner = await register("activity-owner");
  const team = application.spaces.createTeamSpace(owner.user.id, { name: "Activity" });
  const activity = async (spaceId = team.id, cookie = owner.cookie): Promise<RepositoryActivity> => {
    const response = await request(`/spaces/${spaceId}/activity?timeZone=Asia%2FShanghai`, cookie);
    expect(response.status).toBe(200);
    return response.json();
  };
  return { application, states, getWorktree, request, register, owner, team, activity };
}

async function createPull(application: WorkspaceApplication, userId: string, teamSpaceId?: string, visibility = "space") {
  return (await application.worktrees.create(userId, `activity-${crypto.randomUUID()}`, {
    kind: teamSpaceId ? "team" : "user", teamSpaceId, name: "Activity pull", summary: null, visibility,
  })).body;
}

describe("GET Space activity", () => {
  it("attributes browser Pull creation and CLI Issue creation in Shanghai days", async () => {
    const { application, request, owner, team, activity } = await setup();
    const browser = await request("/auth/password/login", "", { username: "activity-owner", password: "correct horse battery staple" });
    expect(browser.status).toBe(200);
    const browserCookie = browser.headers.get("set-cookie")?.split(";", 1)[0];
    if (!browserCookie) throw new Error("Missing browser cookie");
    const created = await request("/worktrees", browserCookie, { kind: "team", teamSpaceId: team.id, name: "Browser pull", summary: null, visibility: "space" });
    expect(created.status).toBe(201);
    const pull = await created.json();
    const login = await request("/auth/cli/password/login", "", { username: "activity-owner", password: "correct horse battery staple" });
    expect(login.status).toBe(200);
    const agentCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    if (!agentCookie) throw new Error("Missing CLI cookie");
    const issueResponse = await request(`/spaces/${team.id}/issues`, agentCookie, { title: "Agent issue" });
    expect(issueResponse.status).toBe(201);
    const issue = await issueResponse.json();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
    const midnight = Date.parse(`${day}T00:00:00+08:00`);
    application.database.connection.prepare("UPDATE worktrees SET created_at = ? WHERE id = ?").run(midnight, pull.id);
    application.database.connection.prepare("UPDATE issues SET created_at = ? WHERE id = ?").run(midnight - 1, issue.id);
    await request(`/spaces/${team.id}/issues/${issue.number}`, owner.cookie, { state: "closed" }, "PATCH");
    const result = await activity();
    expect(result.timeZone).toBe("Asia/Shanghai");
    expect(result.complete).toBe(true);
    expect(result.days).toHaveLength(14);
    expect(result.days.at(-1)).toEqual({ day, opened: { browser: 1, agent: 0, unknown: 0 }, merged: 0 });
    expect(result.days.at(-2)?.opened).toEqual({ browser: 0, agent: 1, unknown: 0 });
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "pull-opened", writeSource: "browser", actor: expect.objectContaining({ id: owner.user.id }), pull: expect.objectContaining({ id: pull.id }) }),
      expect.objectContaining({ kind: "issue-opened", writeSource: "agent", issue: expect.objectContaining({ number: issue.number }) }),
      expect.objectContaining({ kind: "issue-closed", writeSource: "unknown", actor: expect.objectContaining({ id: owner.user.id }) }),
    ]));
  });

  it("counts merges and excludes discarded Pulls from the merged lane", async () => {
    const { application, owner, team, activity } = await setup();
    const merged = await createPull(application, owner.user.id, team.id);
    const discarded = await createPull(application, owner.user.id, team.id);
    const old = Date.now() - 40 * 86_400_000;
    application.database.connection.prepare("UPDATE worktrees SET created_at = ? WHERE id IN (?, ?)").run(old, merged.id, discarded.id);
    const issue = application.issues.create(owner.user.id, team.id, { title: "Older issue" });
    application.database.connection.prepare("UPDATE issues SET created_at = ? WHERE id = ?").run(old, issue.id);
    application.issues.update(owner.user.id, team.id, issue.number, { state: "closed" });
    await application.worktrees.markReady(owner.user.id, merged.id);
    await application.worktrees.merge(owner.user.id, merged.id, "activity-merge-pull");
    await application.worktrees.discard(owner.user.id, discarded.id, "activity-discard-pull");
    const result = await activity();
    expect(result.days.reduce((sum, day) => sum + day.merged, 0)).toBe(1);
    expect(result.events.filter((event) => event.kind === "pull-merged")).toEqual([
      expect.objectContaining({ actor: null, writeSource: "unknown", pull: expect.objectContaining({ id: merged.id }) }),
    ]);
    expect(result.complete).toBe(true);
    expect(result.days.every((day) => Object.values(day.opened).every((count) => count === 0))).toBe(true);
    expect(result.events.map((event) => event.kind).sort()).toEqual(["issue-closed", "pull-merged"]);
  });

  it("preserves private Worktree visibility and public-reader visibility", async () => {
    const { application, register, owner, team, activity } = await setup();
    const member = await register("activity-member");
    const reader = await register("activity-reader");
    application.permissions.upsertTeamMember(owner.user.id, team.id, member.user.id, { role: "editor" });
    application.spaces.update(owner.user.id, team.id, { publicRead: true });
    await createPull(application, owner.user.id, team.id, "private");
    const shared = await createPull(application, owner.user.id, team.id);
    const result = await activity(team.id, member.cookie);
    expect(result.events).toEqual([expect.objectContaining({ pull: expect.objectContaining({ id: shared.id }) })]);
    expect(result.days.reduce((sum, day) => sum + day.opened.unknown, 0)).toBe(1);
    application.issues.create(owner.user.id, team.id, { title: "Public issue" });
    const publicResult = await activity(team.id, reader.cookie);
    expect(publicResult.events.map((event) => event.kind)).toEqual(["issue-opened"]);
  });

  it("returns only the owner's User Worktrees for personal Spaces, and hides them from others", async () => {
    const { application, request, register, owner, team, activity } = await setup();
    const other = await register("activity-other");
    const personal = application.spaces.list(owner.user.id).spaces.find((space) => space.type === "personal");
    if (!personal) throw new Error("Missing personal space");
    const own = await createPull(application, owner.user.id);
    await createPull(application, other.user.id);
    await createPull(application, owner.user.id, team.id);
    application.issues.create(owner.user.id, team.id, { title: "Team issue" });
    const result = await activity(personal.id);
    expect(result.complete).toBe(true);
    expect(result.events).toEqual([expect.objectContaining({ kind: "pull-opened", pull: expect.objectContaining({ id: own.id, spaceId: personal.id }) })]);
    expect((await request(`/spaces/${personal.id}/activity?timeZone=UTC`, other.cookie)).status).toBe(404);
    expect((await request("/spaces/missing/activity?timeZone=UTC", owner.cookie)).status).toBe(404);
  });

  it("caps merge lookups at the newest 200 and tolerates backend failures", async () => {
    const { application, states, getWorktree, owner, team, activity } = await setup();
    const at = Date.now() - 1000;
    const insert = application.database.connection.prepare(`INSERT INTO worktrees
      (id, name, creator_user_id, kind, team_space_id, visibility, processed_at, created_at, updated_at)
      VALUES (?, 'Processed', ?, 'team', ?, 'space', ?, ?, ?)`);
    for (let index = 0; index < 201; index++) {
      const id = `processed-${index}`;
      insert.run(id, owner.user.id, team.id, at + index, at, at);
      states.set(id, { worktreeID: id, status: "merged", units: [] });
    }
    const result = await activity();
    expect(result.complete).toBe(false);
    expect(result.days.reduce((sum, day) => sum + day.merged, 0)).toBe(200);
    expect(getWorktree.mock.calls.map(([id]) => id)).toEqual(Array.from({ length: 200 }, (_, index) => `processed-${200 - index}`));
    getWorktree.mockClear();
    states.delete("processed-200");
    const partial = await activity();
    expect(partial.complete).toBe(false);
    expect(getWorktree).toHaveBeenCalledTimes(200);
    expect(partial.days.reduce((sum, day) => sum + day.merged, 0)).toBe(199);
    expect(partial.days.reduce((sum, day) => sum + day.opened.unknown, 0)).toBe(201);
    application.database.connection.prepare("DELETE FROM worktrees WHERE id = ?").run("processed-0");
    const failed = await activity();
    expect(failed.complete).toBe(false);
    expect(failed.days.reduce((sum, day) => sum + day.merged, 0)).toBe(199);
  });

  it.each(["worktrees", "issues"] as const)("returns partial data when %s exceed 1000 rows", async (source) => {
    const { application, owner, team, activity } = await setup();
    const at = Date.now();
    const insert = source === "worktrees"
      ? application.database.connection.prepare(`INSERT INTO worktrees
          (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at)
          VALUES (?, 'Pull', ?, 'team', ?, 'space', ?, ?)`)
      : application.database.connection.prepare(`INSERT INTO issues
          (id, author_user_id, space_id, created_at, updated_at, number, title, state)
          VALUES (?, ?, ?, ?, ?, ?, 'Issue', 'open')`);
    for (let index = 0; index < 1001; index++) {
      const values = [`row-${index}`, owner.user.id, team.id, at, at];
      if (source === "issues") insert.run(...values, index + 1);
      else insert.run(...values);
    }
    const result = await activity();
    expect(result.complete).toBe(false);
    expect(result.days.reduce((sum, day) => sum + day.opened.unknown, 0)).toBe(1000);
    expect(result.events).toHaveLength(20);
  });

  it("requires a session and a valid, single timeZone", async () => {
    const { request, owner, team } = await setup();
    for (const query of ["", "?timeZone=Bad%2FZone", "?timeZone=%2B01%3A00", "?timeZone=UTC&timeZone=Asia%2FShanghai"]) {
      const response = await request(`/spaces/${team.id}/activity${query}`, owner.cookie);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT", field: "timeZone" } });
    }
    expect((await request(`/spaces/${team.id}/activity?timeZone=UTC`)).status).toBe(401);
  });
});
