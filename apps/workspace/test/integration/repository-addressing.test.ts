import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";

const applications: WorkspaceApplication[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("repository slugs", () => {
  it("generates, validates and resolves slugs", async () => {
    const application = createApplication();
    const owner = await register(application, "Owner");
    const other = await register(application, "other");

    const first = application.spaces.createTeamSpace(owner.id, { name: "My Docs!" });
    expect(first).toMatchObject({ slug: "my-docs", fullName: "Owner/my-docs" });
    // The same name gets a numeric suffix; a name without usable characters uses the Space ID.
    expect(application.spaces.createTeamSpace(owner.id, { name: "My Docs!" }).slug).toBe("my-docs-2");
    expect(application.spaces.createTeamSpace(owner.id, { name: "文档" }).slug).toMatch(/^repo-[0-9a-f]{8}$/);
    expect(application.spaces.createTeamSpace(owner.id, { name: "Personal" }).slug).toMatch(/^repo-/);
    // Another owner may reuse the slug.
    expect(application.spaces.createTeamSpace(other.id, { name: "My Docs" }).slug).toBe("my-docs");

    expect(application.spaces.createTeamSpace(owner.id, { name: "Explicit", slug: "Explicit.Repo_1" }).slug).toBe(
      "Explicit.Repo_1",
    );
    // Case-insensitive uniqueness, reserved word, format.
    expect(() => application.spaces.createTeamSpace(owner.id, { name: "x", slug: "EXPLICIT.repo_1" }))
      .toThrowError(expect.objectContaining({ code: "SPACE_SLUG_TAKEN", status: 409 }));
    for (const slug of ["Personal", "-lead", "a b", "a/b", "", "x".repeat(101), 7]) {
      expect(() => application.spaces.createTeamSpace(owner.id, { name: "x", slug })).toThrowError(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    }

    expect(application.spaces.lookup(owner.id, "owner", "MY-DOCS").id).toBe(first.id);
    const personal = application.spaces.list(owner.id).spaces.find((space) => space.type === "personal");
    expect(personal).toMatchObject({ slug: null, fullName: "Owner/personal" });
    expect(application.spaces.lookup(owner.id, "OWNER", "personal").id).toBe(personal?.id);
  });

  it("hides what the caller cannot discover and edits slugs like names", async () => {
    const application = createApplication();
    const owner = await register(application, "owner");
    const stranger = await register(application, "stranger");
    const team = application.spaces.createTeamSpace(owner.id, { name: "Private repo" });
    const missing = expect.objectContaining({ code: "NOT_FOUND", status: 404 });
    expect(() => application.spaces.lookup(stranger.id, "owner", team.slug)).toThrowError(missing);
    expect(() => application.spaces.lookup(stranger.id, "owner", "personal")).toThrowError(missing);
    expect(() => application.spaces.lookup(owner.id, "owner", "absent")).toThrowError(missing);

    expect(application.spaces.update(owner.id, team.id, { slug: "renamed" })).toMatchObject({
      slug: "renamed",
      fullName: "owner/renamed",
      name: "Private repo",
    });
    expect(() => application.spaces.lookup(owner.id, "owner", "private-repo")).toThrowError(missing);
    // Changing the name leaves the slug alone; a taken slug conflicts; a Personal Space has none.
    expect(application.spaces.update(owner.id, team.id, { name: "Other" }).slug).toBe("renamed");
    application.spaces.createTeamSpace(owner.id, { name: "b", slug: "taken" });
    expect(() => application.spaces.update(owner.id, team.id, { slug: "TAKEN" }))
      .toThrowError(expect.objectContaining({ code: "SPACE_SLUG_TAKEN" }));
    const personal = application.spaces.list(owner.id).spaces.find((space) => space.type === "personal");
    expect(() => application.spaces.update(owner.id, personal?.id ?? "", { slug: "mine" })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  it("gives the Space slug triggers the last word", async () => {
    const application = createApplication();
    const owner = await register(application, "owner");
    const personal = application.spaces.list(owner.id).spaces.find((space) => space.type === "personal");
    const team = application.spaces.createTeamSpace(owner.id, { name: "t" });
    const { connection } = application.database;
    expect(() => connection.prepare("UPDATE spaces SET slug = 'x' WHERE id = ?").run(personal?.id ?? "")).toThrow();
    expect(() => connection.prepare("UPDATE spaces SET slug = 'PERSONAL' WHERE id = ?").run(team.id)).toThrow();
  });
});

describe("shared Issue and Team Worktree numbering", () => {
  it("numbers Issues and Team Worktrees from one per-Space sequence", async () => {
    const application = createApplication();
    const owner = await register(application, "owner");
    const team = application.spaces.createTeamSpace(owner.id, { name: "Repo" });
    const otherTeam = application.spaces.createTeamSpace(owner.id, { name: "Other" });

    const issue1 = application.issues.create(owner.id, team.id, { title: "one" });
    const pr2 = await application.worktrees.create(owner.id, "number-pr-two-0001", {
      kind: "team", teamSpaceId: team.id, visibility: "space", name: "PR", summary: "body",
    });
    const issue3 = application.issues.create(owner.id, team.id, { title: "three" });
    const pr4 = await application.worktrees.create(owner.id, "number-pr-four-0001", {
      kind: "team", teamSpaceId: team.id, visibility: "private", name: "PR", summary: null,
    });
    const elsewhere = await application.worktrees.create(owner.id, "number-pr-other-0001", {
      kind: "team", teamSpaceId: otherTeam.id, visibility: "space", name: "PR", summary: null,
    });
    expect([issue1.number, pr2.body.number, issue3.number, pr4.body.number, elsewhere.body.number])
      .toEqual([1, 2, 3, 4, 1]);

    // An idempotent retry keeps its number.
    const retry = await application.worktrees.create(owner.id, "number-pr-two-0001", {
      kind: "team", teamSpaceId: team.id, visibility: "space", name: "PR", summary: "body",
    });
    expect(retry.body.id).toBe(pr2.body.id);
    expect(retry.body.number).toBe(2);

    const byNumber = await application.worktrees.getByNumber(owner.id, team.id, "2");
    expect(byNumber.worktree.id).toBe(pr2.body.id);
    await expect(application.worktrees.getByNumber(owner.id, team.id, "3")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(application.worktrees.getByNumber(owner.id, team.id, "0")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("numbers User Worktrees per creator and addresses them through the Personal Space", async () => {
    const application = createApplication();
    const alice = await register(application, "alice");
    const bob = await register(application, "bob");
    const make = (userId: string, key: string) =>
      application.worktrees.create(userId, `${key}-0000000001`, { kind: "user", name: key, summary: null });
    const a1 = await make(alice.id, "alice-task-1");
    const a2 = await make(alice.id, "alice-task-2");
    const b1 = await make(bob.id, "bob-task-1");
    expect([a1.body.number, a2.body.number, b1.body.number]).toEqual([1, 2, 1]);

    const personalOf = (userId: string) =>
      application.spaces.list(userId).spaces.find((space) => space.type === "personal")!;
    expect((await application.worktrees.getByNumber(alice.id, personalOf(alice.id).id, "2")).worktree.id)
      .toBe(a2.body.id);
    // Even a public Personal Space cannot address another creator's User Worktrees.
    application.spaces.update(alice.id, personalOf(alice.id).id, { publicRead: true });
    expect(application.spaces.get(bob.id, personalOf(alice.id).id).id).toBe(personalOf(alice.id).id);
    await expect(application.worktrees.getByNumber(bob.id, personalOf(alice.id).id, "1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(application.worktrees.getByNumber(bob.id, personalOf(bob.id).id, "2")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("uses the same HTTP authorization for numbered and ID-addressed private Team Worktrees", async () => {
    const application = createApplication();
    const owner = await register(application, "owner");
    const creator = await register(application, "creator");
    const admin = await register(application, "admin");
    const viewer = await register(application, "viewer");
    const stranger = await register(application, "stranger");
    const team = application.spaces.createTeamSpace(owner.id, { name: "Private repo" });
    for (const [user, role] of [[creator, "editor"], [admin, "admin"], [viewer, "viewer"]] as const) {
      application.permissions.upsertTeamMember(owner.id, team.id, user.id, { role });
    }
    const created = await application.worktrees.create(creator.id, "numbered-private-team-0001", {
      kind: "team", teamSpaceId: team.id, visibility: "private", name: "Private changes", summary: null,
    });
    const unit = await application.worktrees.addUnit(creator.id, created.body.id, "numbered-private-unit-0001", {
      source: "worktree", name: "Confidential document", unitType: "doc", targetSpaceId: team.id,
      targetParentNodeId: null,
    });
    const server = createServer(application.app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test address");
      const origin = `http://127.0.0.1:${address.port}`;
      const idPath = `/api/worktrees/${created.body.id}`;
      const numberPath = `/api/spaces/${team.id}/worktrees/${created.body.number}`;
      const get = (user: typeof owner, path: string) => fetch(`${origin}${path}`, {
        headers: { cookie: user.cookie },
      });
      const beforeRemoval = await get(creator, numberPath);
      expect(beforeRemoval.status).toBe(200);
      expect(await beforeRemoval.json()).toMatchObject({
        worktree: { units: [{ unitId: unit.body.unit.unitId }], capabilities: { review: true, editDraft: true } },
      });

      application.permissions.removeTeamMember(owner.id, team.id, creator.id);
      expect(() => application.spaces.get(creator.id, team.id)).toThrowError(
        expect.objectContaining({ code: "NOT_FOUND" }),
      );
      for (const user of [creator, owner, admin]) {
        const byId = await get(user, idPath);
        const byNumber = await get(user, numberPath);
        expect(byId.status).toBe(200);
        expect(byNumber.status).toBe(200);
        const detail = await byId.json();
        expect(await byNumber.json()).toEqual(detail);
        expect(detail).toMatchObject({
          worktree: {
            unitCount: 1, units: [],
            capabilities: { review: false, editDraft: false, addUnit: false, markReady: false },
          },
        });
        const open = await fetch(`${origin}${idPath}/units/${unit.body.unit.unitId}/open`, {
          method: "POST",
          headers: { cookie: user.cookie, origin, "content-type": "application/json" },
          body: JSON.stringify({ mode: "draft" }),
        });
        expect(open.status).toBe(404);
        for (const write of [false, true]) {
          expect(await application.worktrees.authorizeProtocol({
            userId: user.id, worktreeId: created.body.id, unitId: unit.body.unit.unitId, write,
          })).toBe(false);
        }
      }
      expect((await application.worktrees.list(creator.id, {})).items.map((item) => item.id))
        .toContain(created.body.id);
      for (const user of [viewer, stranger]) {
        for (const path of [idPath, numberPath]) {
          const response = await get(user, path);
          expect(response.status).toBe(404);
          expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
        }
      }
      for (const path of [
        `/api/spaces/${team.id}/worktrees/999`,
        `/api/spaces/missing/worktrees/${created.body.number}`,
      ]) {
        expect((await get(creator, path)).status).toBe(404);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("keeps old Worktrees unnumbered and filters lists by state before paging", async () => {
    const application = createApplication();
    const owner = await register(application, "owner");
    const team = application.spaces.createTeamSpace(owner.id, { name: "Repo" });
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const created = await application.worktrees.create(owner.id, `state-pr-${index}-0000000001`, {
        kind: "team", teamSpaceId: team.id, visibility: "space", name: `PR ${index}`, summary: null,
      });
      ids.push(created.body.id);
    }
    // Simulate a pre-numbering row.
    application.database.connection.prepare("UPDATE worktrees SET number = NULL WHERE id = ?").run(ids[0]!);
    expect((await application.worktrees.get(owner.id, ids[0]!)).worktree.number).toBeNull();

    await application.worktrees.discard(owner.id, ids[1]!, "state-discard-one-0001");
    await application.worktrees.discard(owner.id, ids[3]!, "state-discard-three-0001");
    const base = { scope: "all", teamSpaceId: team.id };
    const discarded = await application.worktrees.list(owner.id, { ...base, state: "discarded", limit: 1 });
    expect(discarded.items.map((item) => item.state)).toEqual(["discarded"]);
    expect(discarded.nextCursor).not.toBeNull();
    const next = await application.worktrees.list(owner.id, {
      ...base, state: "discarded", limit: 1, cursor: discarded.nextCursor,
    });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]!.id).not.toBe(discarded.items[0]!.id);
    // The scan cannot know that no later match exists, so the last page may be empty.
    const last = await application.worktrees.list(owner.id, {
      ...base, state: "discarded", limit: 1, cursor: next.nextCursor,
    });
    expect(last).toMatchObject({ items: [], nextCursor: null });
    const draft = await application.worktrees.list(owner.id, { ...base, state: ["draft", "ready"] });
    expect(draft.items.map((item) => item.id).sort()).toEqual([ids[0]!, ids[2]!].sort());
    await expect(application.worktrees.list(owner.id, { ...base, state: "open" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

function createApplication(): WorkspaceApplication {
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
  applications.push(application);
  return application;
}

async function register(application: WorkspaceApplication, username: string) {
  const issued = await application.identity.registerWithPassword({
    username,
    displayName: username,
    password: "correct horse battery staple",
  });
  return { ...issued.view.user, cookie: `${application.identity.cookieName}=${issued.cookieValue}` };
}
