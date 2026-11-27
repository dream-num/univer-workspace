import { interactivePrincipal } from "../fixtures/principal.js";
import { createSqliteRepositories } from "../../server/src/db/sqlite/open.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteTestApplication, type SqliteTestApplication } from "../support/sqlite/test-application.js";
import { ANONYMOUS_USER_ID } from "../../server/src/modules/identity/index.js";

const applications: SqliteTestApplication[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

async function setup() {
  const app = await createSqliteTestApplication(
    {
      host: "127.0.0.1",
      port: 0,
      database: { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
      secureCookies: false,
      sessionTtlMs: 60_000,
      oauthClients: null,
    },
    { unitStore: { createUnit: async ({ unitId }) => ({ unitId, headRevision: 1 }) } },
  );
  applications.push(app);
  const register = async (username: string) =>
    (
      await app.identity.registerWithPassword({
        username,
        displayName: username,
        password: "correct horse battery staple",
      })
    ).view.user.id;
  const owner = await register("owner");
  const reader = await register("reader");
  const space = (await app.spaces.list(owner)).spaces[0]!;
  const folder = await app.nodes.create(owner, { spaceId: space.id, parentNodeId: null, name: "Folder" });
  const create = async (spaceId = space.id, parentNodeId: string | null = folder.id) => {
    const result = await app.resources.create(owner, randomUUID(), {
      kind: "univer",
      spaceId,
      parentNodeId,
      name: "Document",
      unitType: "sheet",
    });
    if (result.status === 202 || !result.body.node.resource) throw new Error("Resource missing");
    return { node: result.body.node, resource: result.body.node.resource };
  };
  return { app, owner, reader, space, folder, create };
}

describe("access projections", () => {
  it("preserves Blob authorization and excludes missing content mappings", async () => {
    const { app, owner, reader, folder, space } = await setup();
    const node = await app.nodes.create(owner, {
      spaceId: space.id,
      parentNodeId: folder.id,
      name: "File",
    });
    const db = app.database.connection;
    db.prepare(
      "INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES (?, ?, 'blob', 1, 1)",
    ).run("blob-resource", node.id);
    expect(await app.access.resolveResourceContent(owner, "blob-resource")).toBeNull();
    expect((await app.access.resolveOwnedResources(owner, ["blob-resource"])).size).toBe(0);
    db.prepare(`INSERT INTO blob_resources
      (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, 'ready', 1, 1)`).run(
      "blob-resource",
      "object",
      "file.txt",
      "text/plain",
      "0".repeat(64),
      "etag",
    );
    const full = await app.access.resolveResource(owner, "blob-resource");
    expect((await app.access.resolveOwnedResources(owner, ["blob-resource"])).get("blob-resource")).toEqual(
      full,
    );
    expect(await app.access.resolveResourceContent(owner, "blob-resource")).toMatchObject({
      kind: "blob",
      role: "owner",
      capabilities: { openContent: true, editContent: true, downloadContent: true },
    });
    await app.permissions.upsertNodeGrant(interactivePrincipal(owner), folder.id, reader, { role: "viewer" });
    expect((await app.access.resolveResourceContent(reader, "blob-resource"))?.capabilities).toEqual(
      (await app.access.resolveResource(reader, "blob-resource"))?.capabilities,
    );
  });

  it("preserves inherited roles, anonymous read-only access, revocation and trash in content checks", async () => {
    const { app, owner, reader, space, folder, create } = await setup();
    const { resource, node } = await create();
    const fullLookup = vi.spyOn(app.repositories.access, "resolveNode");
    async function check(actor: string, role: string | null) {
      const full = await app.access.resolveResource(actor, resource.id);
      fullLookup.mockClear();
      const content = await app.access.resolveResourceContent(actor, resource.id);
      expect(fullLookup).not.toHaveBeenCalled();
      expect(content?.role ?? null).toBe(role);
      expect(content?.capabilities ?? null).toEqual(full?.capabilities ?? null);
      if (full?.kind === "univer") {
        expect(await app.access.resolveUnitContent(actor, full.unitId)).toEqual(content);
      }
    }
    await check(owner, "owner");
    await check(reader, null);
    await app.permissions.upsertNodeGrant(interactivePrincipal(owner), folder.id, reader, { role: "viewer" });
    await check(reader, "viewer");
    await app.permissions.updateNodeLinkSharing(interactivePrincipal(owner), folder.id, { enabled: true, role: "editor" });
    await check(reader, "editor");
    await check(ANONYMOUS_USER_ID, "viewer");
    await app.permissions.updateNodeLinkSharing(interactivePrincipal(owner), folder.id, { enabled: false, role: "editor" });
    await check(reader, "viewer");
    await check(ANONYMOUS_USER_ID, null);
    await app.permissions.removeNodeGrant(owner, folder.id, reader);
    await check(reader, null);
    await app.spaces.update(interactivePrincipal(owner), space.id, { publicRead: true });
    await check(reader, "viewer");
    await check(ANONYMOUS_USER_ID, "viewer");
    await app.trash.trashNode(owner, node.id);
    await check(owner, null);
    await check(reader, null);
    await check(ANONYMOUS_USER_ID, null);
  });

  it("checks team membership afresh and does not treat publicly readable content as owned", async () => {
    const { app, owner, reader, create } = await setup();
    const team = await app.spaces.createTeamSpace(interactivePrincipal(owner), { name: "Team", publicRead: true });
    const { resource } = await create(team.id, null);
    for (const role of ["viewer", "editor", "admin"] as const) {
      await app.permissions.upsertTeamMember(interactivePrincipal(owner), team.id, reader, { role });
      expect((await app.access.resolveResourceContent(reader, resource.id))?.role).toBe(role);
      expect((await app.access.resolveOwnedResources(reader, [resource.id])).size).toBe(0);
    }
    await app.permissions.removeTeamMember(owner, team.id, reader);
    expect((await app.access.resolveResourceContent(reader, resource.id))?.role).toBe("viewer");
    await app.spaces.update(interactivePrincipal(owner), team.id, { publicRead: false });
    expect(await app.access.resolveResourceContent(reader, resource.id)).toBeNull();
    expect((await app.access.resolveOwnedResources(ANONYMOUS_USER_ID, [resource.id])).size).toBe(0);
  });

  it("batches owned resources with identical directory data, filters trash, and keeps pagination stable", async () => {
    const { app, owner, reader, create } = await setup();
    const first = await create();
    const second = await create();
    await app.nodes.create(owner, {
      spaceId: first.node.spaceId,
      parentNodeId: first.node.id,
      name: "Child",
    });
    const expected = await Promise.all([first, second].map(async ({ resource }) =>
      app.access.resolveResource(owner, resource.id),
    ));
    const batch = await app.access.resolveOwnedResources(owner, [first.resource.id, second.resource.id]);
    expect([...batch.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      expected.sort((a, b) => a!.id.localeCompare(b!.id)),
    );
    expect((await app.access.resolveOwnedResources(reader, [first.resource.id])).size).toBe(0);
    const single = vi.spyOn(app.access, "resolveResource");
    const page1 = await app.views.listOwned(owner, { limit: 1, cursor: undefined });
    const page2 = await app.views.listOwned(owner, { limit: 1, cursor: page1.nextCursor });
    expect(single).not.toHaveBeenCalled();
    expect(new Set([...page1.items, ...page2.items].map((item) => item.resource.id))).toEqual(
      new Set([first.resource.id, second.resource.id]),
    );
    expect(page2.nextCursor).toBeNull();
    expect(page1.items[0]!.location.breadcrumbs).toHaveLength(1);
    await app.trash.trashNode(owner, first.node.id);
    expect(
      (await app.access.resolveOwnedResources(owner, [first.resource.id, second.resource.id])).size,
    ).toBe(1);
  });

  it("uses the existing space-prefixed child index and omits child queries from content authorization", async () => {
    const { app, owner, create } = await setup();
    const { node } = await create();
    // Start with a cold prepared-statement cache so the query plan is observable.
    const repository = createSqliteRepositories(app.database).access;
    const prepare = vi.spyOn(app.database.connection, "prepare");
    await repository.resolveNode(owner, node.id);
    const sql = prepare.mock.calls[0]![0];
    const plan = app.database.connection
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all({ nodeId: node.id, userId: owner });
    expect(
      plan.some((row) =>
        String(row.detail).includes(
          "SEARCH child USING COVERING INDEX nodes_parent (space_id=? AND parent_id=? AND trash_batch_id=?)",
        ),
      ),
    ).toBe(true);
    prepare.mockClear();
    await repository.resolveNodeAuthorization(owner, node.id);
    expect(prepare.mock.calls[0]![0]).not.toContain("FROM nodes AS child");
  });
});
