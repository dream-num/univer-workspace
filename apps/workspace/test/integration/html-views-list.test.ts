import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";

const applications: WorkspaceApplication[] = [];
afterEach(async () => {
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
  const member = await register("member");
  const outsider = await register("outsider");
  const space = app.spaces.list(owner).spaces[0]!;
  const team = app.spaces.createTeamSpace(owner, { name: "Supply" });
  const db = app.database.connection;
  const insertBlob = (input: {
    actor: string;
    spaceId: string;
    name: string;
    filename: string;
    updatedAt: number;
    resourceId?: string;
  }) => {
    const node = app.nodes.create(input.actor, {
      spaceId: input.spaceId,
      parentNodeId: null,
      name: input.name,
    });
    const resourceId = input.resourceId ?? randomUUID();
    db.prepare(
      "INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES (?, ?, 'blob', ?, ?)",
    ).run(resourceId, node.id, input.updatedAt, input.updatedAt);
    db.prepare(
      `INSERT INTO blob_resources
        (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at)
       VALUES (?, ?, ?, 'text/html', 1, ?, ?, 'ready', ?, ?)`,
    ).run(
      resourceId,
      randomUUID(),
      input.filename,
      "ab".repeat(32),
      `etag-${resourceId}`,
      input.updatedAt,
      input.updatedAt,
    );
    db.prepare("UPDATE nodes SET updated_at = ? WHERE id = ?").run(input.updatedAt, node.id);
    return { nodeId: node.id, resourceId };
  };
  return { app, owner, member, outsider, space, team, insertBlob };
}

describe("html view list", () => {
  it("lists accessible html blobs and skips hidden rows without breaking pagination", async () => {
    const { app, owner, member, outsider, space, team, insertBlob } = await setup();
    const newest = insertBlob({
      actor: owner,
      spaceId: space.id,
      name: "看板",
      filename: "dashboard.univer.html",
      updatedAt: 30,
      resourceId: "res-newest",
    });
    const hidden = insertBlob({
      actor: outsider,
      spaceId: app.spaces.list(outsider).spaces[0]!.id,
      name: "Hidden",
      filename: "hidden.univer.html",
      updatedAt: 25,
      resourceId: "res-hidden",
    });
    const sameTimeB = insertBlob({
      actor: owner,
      spaceId: space.id,
      name: "Board",
      filename: "Board.UNIVER.HTML",
      updatedAt: 20,
      resourceId: "res-b",
    });
    const sameTimeA = insertBlob({
      actor: owner,
      spaceId: space.id,
      name: "Alpha",
      filename: "alpha.univer.html",
      updatedAt: 20,
      resourceId: "res-a",
    });
    const oldest = insertBlob({
      actor: owner,
      spaceId: team.id,
      name: "库存",
      filename: "stock.univer.html",
      updatedAt: 10,
      resourceId: "res-oldest",
    });
    insertBlob({
      actor: owner,
      spaceId: space.id,
      name: "Notes",
      filename: "notes.txt",
      updatedAt: 40,
    });
    insertBlob({
      actor: owner,
      spaceId: space.id,
      name: "Almost",
      filename: "notes.univer.html.txt",
      updatedAt: 35,
    });
    await app.resources.create(owner, randomUUID(), {
      kind: "univer",
      spaceId: space.id,
      parentNodeId: null,
      name: "Sheet",
      unitType: "sheet",
    });

    const page = { limit: 2, cursor: undefined as unknown };
    const first = app.views.listHtmlViews(owner, page);
    expect(first.items.map((item) => item.resource.id)).toEqual([
      newest.resourceId,
      sameTimeA.resourceId,
    ]);
    expect(first.items[0]).toMatchObject({
      node: { id: newest.nodeId, name: "看板" },
      location: { space: { id: space.id } },
    });
    const second = app.views.listHtmlViews(owner, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.resource.id)).toEqual([
      sameTimeB.resourceId,
      oldest.resourceId,
    ]);
    expect(second.nextCursor).toBeNull();
    expect(second.items.map((item) => item.resource.id)).not.toContain(hidden.resourceId);

    expect(app.views.listHtmlViews(member, page).items).toEqual([]);
    app.permissions.upsertTeamMember(owner, team.id, member, { role: "viewer" });
    expect(app.views.listHtmlViews(member, page).items.map((item) => item.resource.id)).toEqual([
      oldest.resourceId,
    ]);

    expect(app.views.listHtmlViews(outsider, page).items.map((item) => item.resource.id)).toEqual([
      hidden.resourceId,
    ]);
    app.permissions.upsertNodeGrant(owner, newest.nodeId, outsider, { role: "viewer" });
    expect(
      app.views
        .listHtmlViews(outsider, { limit: 10, cursor: undefined })
        .items.map((item) => item.resource.id),
    ).toEqual([newest.resourceId, hidden.resourceId]);

    app.trash.trashNode(owner, sameTimeA.nodeId);
    expect(
      app.views
        .listHtmlViews(owner, { limit: 10, cursor: undefined })
        .items.map((item) => item.resource.id),
    ).toEqual([newest.resourceId, sameTimeB.resourceId, oldest.resourceId]);
  });
});
