import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import { ReviewCommitCoordinator } from "../../server/src/integrations/univer/review-commit.js";

const apps: WorkspaceApplication[] = [],
  servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  for (const app of apps.splice(0)) await app.close();
});
async function fixture() {
  const app = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
  apps.push(app);
  const a = await app.identity.registerWithPassword({
    username: "review-owner",
    displayName: "A",
    password: "review-test-password",
  });
  const b = await app.identity.registerWithPassword({
    username: "review-editor",
    displayName: "B",
    password: "review-test-password",
  });
  const space = app.spaces.createTeamSpace(a.view.user.id, { name: "Review test" });
  app.permissions.upsertTeamMember(a.view.user.id, space.id, b.view.user.id, { role: "editor" });
  const created = await app.resources.create(a.view.user.id, crypto.randomUUID(), {
    kind: "univer",
    spaceId: space.id,
    parentNodeId: null,
    name: "Shared Sheet",
    unitType: "sheet",
  });
  if (created.status !== 201 || !created.body.node.resource) throw new Error("Resource pending");
  const resourceId = created.body.node.resource.id;
  const server = createServer(app.app);
  servers.push(server);
  app.attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No address");
  const origin = `http://127.0.0.1:${addr.port}`;
  const cookie = (actor = a) => `${app.identity.cookieName}=${actor.cookieValue}`;
  async function http(path: string, body?: unknown, actor = a, key?: string) {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: cookie(actor),
        "content-type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }
  async function draft(value: string, column = 0, actor = a) {
    const tree = await app.worktrees.create(actor.view.user.id, crypto.randomUUID(), {
      kind: "user",
      name: value,
      summary: null,
    });
    const id = tree.body.id;
    const added = await app.worktrees.addUnit(actor.view.user.id, id, crypto.randomUUID(), {
      source: "trunk",
      resourceId,
    });
    const unit = added.body.unit.unitId;
    const comparison = await http(
      `/universer-api/worktrees/${id}/units/${unit}/comparison`,
      undefined,
      actor,
    );
    expect(comparison.status).toBe(200);
    const sheet = comparison.body.right.unitData.sheetOrder[0] as string;
    const revision = comparison.body.right.revision as number;
    const result = await app.worktrees.submitChangeset(actor.view.user.id, id, unit, {
      changeset: {
        unitID: unit,
        type: 2,
        baseRev: revision,
        revision: revision + 1,
        sid: crypto.randomUUID(),
        reqId: 1,
        mutations: [
          {
            id: "sheet.mutation.set-range-values",
            data: JSON.stringify({
              unitId: unit,
              subUnitId: sheet,
              cellValue: { 0: { [column]: { v: value, t: 1 } } },
            }),
          },
        ],
      },
    });
    expect(result.status).toBe("committed");
    await app.worktrees.markReady(actor.view.user.id, id);
    return { id, unit, sheet, actor };
  }
  async function review(tree: Awaited<ReturnType<typeof draft>>) {
    const result = await http(`/universer-api/worktrees/${tree.id}/review`, {}, tree.actor);
    expect(result.status).toBe(200);
    return result.body;
  }
  async function merge(
    tree: Awaited<ReturnType<typeof draft>>,
    reviewToken: string,
    key = crypto.randomUUID(),
  ) {
    return http(`/api/worktrees/${tree.id}/merge`, { reviewToken }, tree.actor, key);
  }
  return { app, a, b, space, http, draft, review, merge };
}

describe("version-bound Worktree Review commit", { timeout: 30_000 }, () => {
  it("rejects missing reviews and changed drafts, then applies only a fresh exact review and keeps retries idempotent", async () => {
    const f = await fixture(),
      tree = await f.draft("first");
    expect(
      (await f.http(`/api/worktrees/${tree.id}/merge`, {}, tree.actor, crypto.randomUUID())).status,
    ).toBe(409);
    const old = await f.review(tree);
    await f.app.worktrees.reopen(f.a.view.user.id, tree.id);
    const revision = old.comparisons[0].comparison.right.revision;
    await f.app.worktrees.submitChangeset(f.a.view.user.id, tree.id, tree.unit, {
      changeset: {
        unitID: tree.unit,
        type: 2,
        baseRev: revision,
        revision: revision + 1,
        sid: crypto.randomUUID(),
        reqId: 1,
        mutations: [
          {
            id: "sheet.mutation.set-range-values",
            data: JSON.stringify({
              unitId: tree.unit,
              subUnitId: tree.sheet,
              cellValue: { 0: { 0: { v: "unreviewed", t: 1 } } },
            }),
          },
        ],
      },
    });
    await f.app.worktrees.markReady(f.a.view.user.id, tree.id);
    const stale = await f.merge(tree, old.reviewToken);
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toContain("Review");
    const fresh = await f.review(tree);
    expect(
      fresh.comparisons[0].comparison.left.unitData.sheets[tree.sheet].cellData[0]?.[0],
    ).toBeUndefined();
    expect(fresh.comparisons[0].comparison.right.unitData.sheets[tree.sheet].cellData[0][0].v).toBe(
      "unreviewed",
    );
    const key = crypto.randomUUID();
    expect((await f.merge(tree, fresh.reviewToken, key)).status).toBe(200);
    expect((await f.merge(tree, fresh.reviewToken, key)).status).toBe(200);
    expect((await f.app.worktrees.get(f.a.view.user.id, tree.id)).worktree.state).toBe("merged");
  });
  it("serializes racing merges of the same shared Unit; the losing old review cannot publish", async () => {
    const f = await fixture(),
      one = await f.draft("one"),
      two = await f.draft("two");
    const r1 = await f.review(one),
      r2 = await f.review(two);
    const results = await Promise.all([f.merge(one, r1.reviewToken), f.merge(two, r2.reviewToken)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const loser = results[0]!.status === 409 ? one : two;
    const rereview = await f.review(loser);
    const winningValue = results[0]!.status === 200 ? "one" : "two";
    expect(
      rereview.comparisons[0].comparison.left.unitData.sheets[loser.sheet].cellData[0][0].v,
    ).toBe(winningValue);
    // SDK conflict/transform rules remain authoritative for a new preview.
    expect((await f.merge(loser, rereview.reviewToken)).status).toBe(200);
  });
  it("preserves independent shared edits in the freshly reviewed SDK merge candidate", async () => {
    const f = await fixture(),
      one = await f.draft("proposal", 0),
      two = await f.draft("human-equivalent", 1, f.b);
    const old = await f.review(one),
      other = await f.review(two);
    expect((await f.merge(two, other.reviewToken)).status).toBe(200);
    expect((await f.merge(one, old.reviewToken)).status).toBe(409);
    const fresh = await f.review(one),
      cells = fresh.comparisons[0].comparison.right.unitData.sheets[one.sheet].cellData[0];
    expect(cells[0].v).toBe("proposal");
    expect(cells[1].v).toBe("human-equivalent");
    expect((await f.merge(one, fresh.reviewToken)).status).toBe(200);
  });
  it("rechecks live membership and refuses tokens from another target or Server lifetime", async () => {
    const f = await fixture(),
      one = await f.draft("editor proposal", 0, f.b),
      two = await f.draft("another", 1, f.b);
    const first = await f.review(one),
      second = await f.review(two);
    expect((await f.merge(one, second.reviewToken)).status).toBe(409);
    expect((await f.merge(one, crypto.randomUUID())).status).toBe(409);
    f.app.permissions.removeTeamMember(f.a.view.user.id, f.space.id, f.b.view.user.id);
    expect([403, 404]).toContain((await f.merge(one, first.reviewToken)).status);
    expect((await f.app.worktrees.get(f.b.view.user.id, one.id)).worktree.capabilities.merge).toBe(
      false,
    );
  });
  it("a queued mutation cannot enter while version validation and commit own the lease, including nested SDK calls", async () => {
    const gate = new ReviewCommitCoordinator(),
      order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const merge = gate.run(async () => {
      order.push("validate");
      await gate.run(async () => {
        order.push("nested SDK");
      });
      await held;
      order.push("commit");
    });
    const other = gate.run(async () => {
      order.push("other mutation");
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["validate", "nested SDK"]);
    release();
    await Promise.all([merge, other]);
    expect(order).toEqual(["validate", "nested SDK", "commit", "other mutation"]);
    const token = gate.issue("a", "w", "v");
    expect(() => gate.validate(token, "b", "w", "v")).toThrow();
    expect(() => new ReviewCommitCoordinator().validate(token, "a", "w", "v")).toThrow();
  });
});
