import { randomUUID } from "node:crypto";
import { UniverType } from "@univerjs/protocol";
import type { WorktreeData } from "@univerjs-pro/collaboration-worktree-service";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import type { WorktreeBackend } from "../../server/src/modules/worktrees/index.js";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];
const sessions: Client[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.end().catch(() => undefined)));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

/** Holds Worktree state in memory and lets a test act at the moment the SDK merge or a read is called. */
class HookedBackend implements WorktreeBackend {
  readonly worktrees = new Map<string, WorktreeData>();
  onRead: (() => Promise<void>) | null = null;
  onMerge: (() => Promise<void>) | null = null;
  failNextMerge = false;
  merged: { readonly unitID: string; readonly draftHeadRevision: number }[] | null = null;

  async createWorktree(id: string) {
    return this.set(id, { worktreeID: id, status: "draft", units: [] });
  }
  async getWorktree(id: string) {
    const hook = this.onRead;
    this.onRead = null;
    const value = this.require(id);
    await hook?.();
    return value;
  }
  async addUnit(id: string, unitId: string) {
    const value = this.require(id);
    return this.set(id, {
      ...value,
      units: [...value.units, { unitID: unitId, type: UniverType.UNIVER_SHEET, source: "trunk", baselineTrunkRevision: 1, draftHeadRevision: 1 }],
    });
  }
  async createUnit(input: Parameters<WorktreeBackend["createUnit"]>[0]) {
    const value = this.require(input.worktreeId);
    return this.set(input.worktreeId, {
      ...value,
      units: [...value.units, { unitID: input.unitId, type: UniverType.UNIVER_SHEET, source: "worktree", draftHeadRevision: 1 }],
    });
  }
  async markReady(id: string) {
    return this.setStatus(id, "ready");
  }
  async reopen(id: string) {
    return this.setStatus(id, "draft");
  }
  async setUnitRemoved(id: string, unitId: string, removed: boolean) {
    const value = this.require(id);
    return this.set(id, { ...value, units: value.units.map((unit) => (unit.unitID === unitId ? { ...unit, removed } : unit)) });
  }
  async merge(id: string) {
    if (this.failNextMerge) {
      this.failNextMerge = false;
      throw new Error("The SDK merge failed once.");
    }
    const hook = this.onMerge;
    this.onMerge = null;
    await hook?.();
    const value = this.require(id);
    this.merged = value.units.map(({ unitID, draftHeadRevision }) => ({ unitID, draftHeadRevision }));
    return this.set(id, {
      ...value,
      status: "merged",
      units: value.units.map((unit) => ({ ...unit, mergeResult: { status: "merged", trunkRevision: 2 } })),
    });
  }
  async discard(id: string) {
    return this.setStatus(id, "discarded");
  }
  async submitChangeset(id: string, changeset: Parameters<WorktreeBackend["submitChangeset"]>[1], userId: string) {
    const value = this.require(id);
    this.set(id, {
      ...value,
      units: value.units.map((unit) => (unit.unitID === changeset.unitID ? { ...unit, draftHeadRevision: changeset.revision } : unit)),
    });
    return { status: "committed" as const, changeset: { ...changeset, userID: userId, memberID: `product-api:${userId}` } };
  }
  setStatus(id: string, status: WorktreeData["status"]) {
    return this.set(id, { ...this.require(id), status });
  }
  private set(id: string, value: WorktreeData) {
    this.worktrees.set(id, value);
    return value;
  }
  private require(id: string) {
    const value = this.worktrees.get(id);
    if (!value) throw Object.assign(new Error("Worktree not found."), { code: "WORKTREE_NOT_FOUND" });
    return value;
  }
}

async function start(backend?: HookedBackend) {
  const application = await createProductTestApplication(
    {
      host: "127.0.0.1",
      port: 0,
      productFilename: ":memory:",
      collaborationDatabaseFilename: ":memory:",
      secureCookies: false,
      sessionTtlMs: 60_000,
    },
    backend && {
      unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) },
      worktreeBackend: backend,
    },
  );
  applications.push(application);
  return application;
}

/** A Team with an owner, an admin and an editor, and a ready Team pull request the editor created. */
async function readyTeamPull(application: ProductTestApplication, visibility: "space" | "private" = "space") {
  const register = async (name: string) =>
    (await application.identity.registerWithPassword({
      username: `${name}-${randomUUID().slice(0, 8)}`,
      displayName: name,
      password: "correct horse battery staple",
    })).view.user;
  const [owner, admin, member] = [await register("owner"), await register("admin"), await register("member")];
  const team = await application.spaces.createTeamSpace(owner.id, { name: "Team" });
  await application.permissions.upsertTeamMember(owner.id, team.id, admin.id, { role: "admin" });
  await application.permissions.upsertTeamMember(owner.id, team.id, member.id, { role: "editor" });
  const id = (await application.worktrees.create(member.id, randomUUID(), {
    kind: "team", teamSpaceId: team.id, visibility, name: "Budget", summary: null,
  })).body.id;
  const { unit } = (await application.worktrees.addUnit(member.id, id, randomUUID(), {
    source: "worktree", name: "Budget sheet", unitType: "sheet", targetSpaceId: team.id, targetParentNodeId: null,
  })).body;
  await application.worktrees.markReady(member.id, id);
  return { admin, member, id, unitId: unit.unitId };
}

const viewed = async (application: ProductTestApplication, userId: string, id: string) =>
  (await application.worktrees.get(userId, id)).worktree;

describe("merging the revision a reviewer viewed", () => {
  it("refuses a Team admin's missing or outdated revision and merges the current one", async () => {
    const application = await start();
    const { admin, member, id } = await readyTeamPull(application);
    const reviewed = (await viewed(application, admin.id, id)).revision;
    await application.worktrees.reopen(member.id, id);
    await application.worktrees.update(member.id, id, { name: "Budget, second pass" });
    await application.worktrees.markReady(member.id, id);

    for (const input of [{ revision: reviewed }, undefined]) {
      await expect(application.worktrees.merge(admin.id, id, randomUUID(), input)).rejects.toMatchObject({
        status: 412, code: "PRECONDITION_FAILED",
      });
    }
    await expect(application.worktrees.merge(admin.id, id, randomUUID(), { revision: reviewed, note: 1 })).rejects.toMatchObject({
      status: 400, code: "INVALID_INPUT",
    });
    expect(await viewed(application, admin.id, id)).toMatchObject({ state: "ready", units: [{ mergeResult: "pending" }] });

    const current = (await viewed(application, admin.id, id)).revision;
    await expect(application.worktrees.merge(admin.id, id, randomUUID(), { revision: current })).resolves.toMatchObject({
      worktree: { state: "merged" },
    });
    expect(await viewed(application, admin.id, id)).toMatchObject({ units: [{ mergeResult: "merged" }] });
  });

  it("leaves merging a private Team pull request to the people who can review it", async () => {
    const application = await start(new HookedBackend());
    const { admin, member, id } = await readyTeamPull(application, "private");
    const shown = await viewed(application, admin.id, id);
    expect(shown).toMatchObject({ units: [], capabilities: { review: false, merge: false, reopen: true, discard: true } });
    expect(shown).not.toHaveProperty("revision");
    await expect(application.worktrees.merge(admin.id, id, randomUUID())).rejects.toMatchObject({
      status: 403,
      code: "REVIEW_REQUIRED",
      message: expect.stringContaining("Change its visibility to Space, review it, then merge."),
    });
    expect(await viewed(application, member.id, id)).toMatchObject({ capabilities: { review: true, merge: true } });

    await application.worktrees.update(admin.id, id, { visibility: "space" });
    const reviewed = await viewed(application, admin.id, id);
    expect(reviewed).toMatchObject({ capabilities: { review: true, merge: true }, revision: expect.any(String) });
    await expect(application.worktrees.merge(admin.id, id, randomUUID(), { revision: reviewed.revision })).resolves.toMatchObject({
      worktree: { state: "merged" },
    });
  });

  it("refuses title, summary, reopen and ready while a merge runs and merges what was viewed", async () => {
    const backend = new HookedBackend();
    const application = await start(backend);
    const { admin, member, id, unitId } = await readyTeamPull(application);
    const reviewed = (await viewed(application, admin.id, id)).revision;
    const during: Record<string, unknown> = {};
    const outcome = (promise: Promise<unknown>) =>
      promise.then(() => "applied", (error: { status?: number }) => error.status);
    backend.onMerge = async () => {
      during.title = await outcome(application.worktrees.update(member.id, id, { name: "Renamed" }));
      during.summary = await outcome(application.worktrees.update(member.id, id, { summary: "Rewritten" }));
      during.visibility = await outcome(application.worktrees.update(member.id, id, { visibility: "space" }));
      during.reopen = await outcome(application.worktrees.reopen(member.id, id));
      backend.setStatus(id, "draft");
      during.ready = await outcome(application.worktrees.markReady(member.id, id));
      backend.setStatus(id, "ready");
    };

    await expect(application.worktrees.merge(admin.id, id, randomUUID(), { revision: reviewed })).resolves.toMatchObject({
      worktree: { state: "merged", name: "Budget" },
    });
    expect(during).toEqual({ title: 409, summary: 409, visibility: "applied", reopen: 409, ready: 409 });
    expect(backend.merged).toEqual([{ unitID: unitId, draftHeadRevision: 1 }]);
  });

  it("checks the revision again right before the SDK merge", async () => {
    const backend = new HookedBackend();
    const application = await start(backend);
    const { admin, member, id } = await readyTeamPull(application);
    const reviewed = (await viewed(application, admin.id, id)).revision;
    const operationId = randomUUID();
    backend.onRead = async () => {
      await application.worktrees.update(member.id, id, { name: "Renamed after the first check" });
    };

    await expect(application.worktrees.merge(admin.id, id, operationId, { revision: reviewed })).rejects.toMatchObject({
      status: 412, code: "PRECONDITION_FAILED",
    });
    expect(backend.merged).toBeNull();
    expect(await application.operations.get(admin.id, operationId)).toMatchObject({
      state: "failed", error: { code: "PRECONDITION_FAILED" },
    });
    await expect(application.worktrees.reopen(member.id, id)).resolves.toMatchObject({ worktree: { state: "draft" } });
  });

  it("retries a failed merge Operation with the revision it named", async () => {
    const backend = new HookedBackend();
    const application = await start(backend);
    const first = await readyTeamPull(application);
    const second = await readyTeamPull(application);
    const fail = async ({ admin, id }: typeof first) => {
      const operationId = randomUUID();
      backend.failNextMerge = true;
      await expect(
        application.worktrees.merge(admin.id, id, operationId, { revision: (await viewed(application, admin.id, id)).revision }),
      ).rejects.toThrow();
      return operationId;
    };

    const retried = await fail(first);
    await expect(application.operations.retry(first.admin.id, retried)).resolves.toMatchObject({ state: "completed" });
    expect(await viewed(application, first.admin.id, first.id)).toMatchObject({ state: "merged" });

    const changed = await fail(second);
    await application.worktrees.update(second.member.id, second.id, { summary: "Changed before the retry" });
    await expect(application.operations.retry(second.admin.id, changed)).rejects.toMatchObject({ status: 412 });
    expect(await viewed(application, second.admin.id, second.id)).toMatchObject({ state: "ready" });
  });
});

/** A second PostgreSQL session holding the Worktree's row, as a concurrent merge reservation or rename does. */
async function holdRow(application: ProductTestApplication, worktreeId: string) {
  const session = new Client({ connectionString: application.postgresUrl });
  const observer = new Client({ connectionString: application.postgresUrl });
  sessions.push(session, observer);
  await Promise.all([session.connect(), observer.connect()]);
  await session.query("BEGIN");
  await session.query("SELECT id FROM worktrees WHERE id = $1 FOR UPDATE", [worktreeId]);
  return {
    query: (text: string, values: unknown[]) => session.query(text, values),
    async waiter() {
      for (let attempt = 0; attempt < 300; attempt++) {
        const { rows } = await observer.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        if (rows.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Nothing waited for the Worktree row.");
    },
    end: () => session.query("COMMIT"),
  };
}

const settled = (promise: Promise<unknown>) =>
  promise.then(() => "applied", (error: { status?: number; code?: string }) => ({ status: error.status, code: error.code }));

describe.skipIf(!process.env.WORKSPACE_TEST_POSTGRES_URL)("a merge and a title change at the same moment on PostgreSQL", () => {
  it("refuses a title change that waited for a merge being reserved", async () => {
    const application = await start(new HookedBackend());
    const { admin, member, id } = await readyTeamPull(application);
    const merge = await holdRow(application, id);
    const renamed = settled(application.worktrees.update(member.id, id, { name: "Renamed" }));
    await merge.waiter();
    const now = Date.now();
    await merge.query(
      `INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at,
         lease_owner, lease_expires_at, created_at, updated_at)
       VALUES ($1, 'merge_worktree', $2, 'reserved', 'pending', $3, 0, $4, 'product-api', $5, $4, $4)`,
      [randomUUID(), admin.id, JSON.stringify({ worktreeId: id }), now, now + 60_000],
    );
    await merge.end();

    expect(await renamed).toEqual({ status: 409, code: "CONFLICT" });
    expect(await viewed(application, admin.id, id)).toMatchObject({ name: "Budget" });
  });

  it("refuses a merge whose reservation waited for a title change", async () => {
    const backend = new HookedBackend();
    const application = await start(backend);
    const { admin, id } = await readyTeamPull(application);
    const reviewed = (await viewed(application, admin.id, id)).revision;
    const rename = await holdRow(application, id);
    await rename.query("UPDATE worktrees SET name = 'Renamed' WHERE id = $1", [id]);
    const merged = settled(application.worktrees.merge(admin.id, id, randomUUID(), { revision: reviewed }));
    await rename.waiter();
    await rename.end();

    expect(await merged).toEqual({ status: 412, code: "PRECONDITION_FAILED" });
    expect(backend.merged).toBeNull();
  });
});
