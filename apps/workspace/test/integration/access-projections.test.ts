import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import { ANONYMOUS_USER_ID } from "../../server/src/modules/identity/index.js";
import { AccessRepository } from "../../server/src/modules/access/access.repository.js";

const applications: WorkspaceApplication[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

async function setup() {
  const app = createWorkspaceApplication(
    {
      host: "127.0.0.1",
      port: 0,
      databaseFilename: ":memory:",
      collaborationDatabaseFilename: ":memory:",
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
  const space = app.spaces.list(owner).spaces[0]!;
  const folder = app.nodes.create(owner, { spaceId: space.id, parentNodeId: null, name: "Folder" });
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
    const node = app.nodes.create(owner, {
      spaceId: space.id,
      parentNodeId: folder.id,
      name: "File",
    });
    const db = app.database.connection;
    db.prepare(
      "INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES (?, ?, 'blob', 1, 1)",
    ).run("blob-resource", node.id);
    expect(app.access.resolveResourceContent(owner, "blob-resource")).toBeNull();
    expect(app.access.resolveOwnedResources(owner, ["blob-resource"]).size).toBe(0);
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
    const full = app.access.resolveResource(owner, "blob-resource");
    expect(app.access.resolveOwnedResources(owner, ["blob-resource"]).get("blob-resource")).toEqual(
      full,
    );
    expect(app.access.resolveResourceContent(owner, "blob-resource")).toMatchObject({
      kind: "blob",
      role: "owner",
      capabilities: { openContent: true, editContent: true, downloadContent: true },
    });
    app.permissions.upsertNodeGrant(owner, folder.id, reader, { role: "viewer" });
    expect(app.access.resolveResourceContent(reader, "blob-resource")?.capabilities).toEqual(
      app.access.resolveResource(reader, "blob-resource")?.capabilities,
    );
  });

  it("preserves inherited roles, anonymous read-only access, revocation and trash in content checks", async () => {
    const { app, owner, reader, space, folder, create } = await setup();
    const { resource, node } = await create();
    const fullLookup = vi.spyOn(AccessRepository.prototype, "resolveNode");
    function check(actor: string, role: string | null) {
      const full = app.access.resolveResource(actor, resource.id);
      fullLookup.mockClear();
      const content = app.access.resolveResourceContent(actor, resource.id);
      expect(fullLookup).not.toHaveBeenCalled();
      expect(content?.role ?? null).toBe(role);
      expect(content?.capabilities ?? null).toEqual(full?.capabilities ?? null);
      if (full?.kind === "univer") {
        expect(app.access.resolveUnitContent(actor, full.unitId)).toEqual(content);
      }
    }
    check(owner, "owner");
    check(reader, null);
    app.permissions.upsertNodeGrant(owner, folder.id, reader, { role: "viewer" });
    check(reader, "viewer");
    app.permissions.updateNodeLinkSharing(owner, folder.id, { enabled: true, role: "editor" });
    check(reader, "editor");
    check(ANONYMOUS_USER_ID, "viewer");
    app.permissions.updateNodeLinkSharing(owner, folder.id, { enabled: false, role: "editor" });
    check(reader, "viewer");
    check(ANONYMOUS_USER_ID, null);
    app.permissions.removeNodeGrant(owner, folder.id, reader);
    check(reader, null);
    app.spaces.update(owner, space.id, { publicRead: true });
    check(reader, "viewer");
    check(ANONYMOUS_USER_ID, "viewer");
    app.trash.trashNode(owner, node.id);
    check(owner, null);
    check(reader, null);
    check(ANONYMOUS_USER_ID, null);
  });

  it("checks team membership afresh and does not treat publicly readable content as owned", async () => {
    const { app, owner, reader, create } = await setup();
    const team = app.spaces.createTeamSpace(owner, { name: "Team", publicRead: true });
    const { resource } = await create(team.id, null);
    for (const role of ["viewer", "editor", "admin"] as const) {
      app.permissions.upsertTeamMember(owner, team.id, reader, { role });
      expect(app.access.resolveResourceContent(reader, resource.id)?.role).toBe(role);
      expect(app.access.resolveOwnedResources(reader, [resource.id]).size).toBe(0);
    }
    app.permissions.removeTeamMember(owner, team.id, reader);
    expect(app.access.resolveResourceContent(reader, resource.id)?.role).toBe("viewer");
    app.spaces.update(owner, team.id, { publicRead: false });
    expect(app.access.resolveResourceContent(reader, resource.id)).toBeNull();
    expect(app.access.resolveOwnedResources(ANONYMOUS_USER_ID, [resource.id]).size).toBe(0);
  });

  it("batches owned resources with identical directory data, filters trash, and keeps pagination stable", async () => {
    const { app, owner, reader, create } = await setup();
    const first = await create();
    const second = await create();
    app.nodes.create(owner, {
      spaceId: first.node.spaceId,
      parentNodeId: first.node.id,
      name: "Child",
    });
    const expected = [first, second].map(({ resource }) =>
      app.access.resolveResource(owner, resource.id),
    );
    const batch = app.access.resolveOwnedResources(owner, [first.resource.id, second.resource.id]);
    expect([...batch.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      expected.sort((a, b) => a!.id.localeCompare(b!.id)),
    );
    expect(app.access.resolveOwnedResources(reader, [first.resource.id]).size).toBe(0);
    const single = vi.spyOn(app.access, "resolveResource");
    const page1 = app.views.listOwned(owner, { limit: 1, cursor: undefined });
    const page2 = app.views.listOwned(owner, { limit: 1, cursor: page1.nextCursor });
    expect(single).not.toHaveBeenCalled();
    expect(new Set([...page1.items, ...page2.items].map((item) => item.resource.id))).toEqual(
      new Set([first.resource.id, second.resource.id]),
    );
    expect(page2.nextCursor).toBeNull();
    expect(page1.items[0]!.location.breadcrumbs).toHaveLength(1);
    app.trash.trashNode(owner, first.node.id);
    expect(
      app.access.resolveOwnedResources(owner, [first.resource.id, second.resource.id]).size,
    ).toBe(1);
  });

  it("uses the existing space-prefixed child index and omits child queries from content authorization", async () => {
    const { app, owner, create } = await setup();
    const { node } = await create();
    const repository = new AccessRepository(app.database);
    const prepare = vi.spyOn(app.database.connection, "prepare");
    repository.resolveNode(owner, node.id);
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
    repository.resolveNodeAuthorization(owner, node.id);
    expect(prepare.mock.calls[0]![0]).not.toContain("FROM nodes AS child");
  });
});
