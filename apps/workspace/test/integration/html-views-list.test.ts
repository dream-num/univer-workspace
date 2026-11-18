import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProductTestApplication } from "../support/product-test-application.js";
import { createSqliteTestApplication, type SqliteTestApplication } from "../support/sqlite/test-application.js";

const applications: SqliteTestApplication[] = [];
afterEach(async () => {
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
  const member = await register("member");
  const outsider = await register("outsider");
  const space = (await app.spaces.list(owner)).spaces[0]!;
  const team = await app.spaces.createTeamSpace(owner, { name: "Supply" });
  const db = app.database.connection;
  const insertBlob = async (input: {
    actor: string;
    spaceId: string;
    name: string;
    filename: string;
    updatedAt: number;
    resourceId?: string;
  }) => {
    const node = await app.nodes.create(input.actor, {
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
    const newest = await insertBlob({
      actor: owner,
      spaceId: space.id,
      name: "看板",
      filename: "dashboard.univer.html",
      updatedAt: 30,
      resourceId: "res-newest",
    });
    const hidden = await insertBlob({
      actor: outsider,
      spaceId: (await app.spaces.list(outsider)).spaces[0]!.id,
      name: "Hidden",
      filename: "hidden.univer.html",
      updatedAt: 25,
      resourceId: "res-hidden",
    });
    const sameTimeB = await insertBlob({
      actor: owner,
      spaceId: space.id,
      name: "Board",
      filename: "Board.UNIVER.HTML",
      updatedAt: 20,
      resourceId: "res-b",
    });
    const sameTimeA = await insertBlob({
      actor: owner,
      spaceId: space.id,
      name: "Alpha",
      filename: "alpha.univer.html",
      updatedAt: 20,
      resourceId: "res-a",
    });
    const oldest = await insertBlob({
      actor: owner,
      spaceId: team.id,
      name: "库存",
      filename: "stock.univer.html",
      updatedAt: 10,
      resourceId: "res-oldest",
    });
    await insertBlob({
      actor: owner,
      spaceId: space.id,
      name: "Notes",
      filename: "notes.txt",
      updatedAt: 40,
    });
    await insertBlob({
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
    const first = await app.views.listHtmlViews(owner, page);
    expect(first.items.map((item) => item.resource.id)).toEqual([
      newest.resourceId,
      sameTimeA.resourceId,
    ]);
    expect(first.items[0]).toMatchObject({
      node: { id: newest.nodeId, name: "看板" },
      location: { space: { id: space.id } },
    });
    const second = await app.views.listHtmlViews(owner, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.resource.id)).toEqual([
      sameTimeB.resourceId,
      oldest.resourceId,
    ]);
    expect(second.nextCursor).toBeNull();
    expect(second.items.map((item) => item.resource.id)).not.toContain(hidden.resourceId);
    expect(
      (await app.views
        .listHtmlViews(owner, { limit: 10, cursor: undefined, spaceId: team.id }))
        .items.map((item) => item.resource.id),
    ).toEqual([oldest.resourceId]);

    expect((await app.views.listHtmlViews(member, page)).items).toEqual([]);
    await app.permissions.upsertTeamMember(owner, team.id, member, { role: "viewer" });
    expect((await app.views.listHtmlViews(member, page)).items.map((item) => item.resource.id)).toEqual([
      oldest.resourceId,
    ]);

    expect((await app.views.listHtmlViews(outsider, page)).items.map((item) => item.resource.id)).toEqual([
      hidden.resourceId,
    ]);
    await app.permissions.upsertNodeGrant(owner, newest.nodeId, outsider, { role: "viewer" });
    expect(
      (await app.views
        .listHtmlViews(outsider, { limit: 10, cursor: undefined }))
        .items.map((item) => item.resource.id),
    ).toEqual([newest.resourceId, hidden.resourceId]);

    await app.trash.trashNode(owner, sameTimeA.nodeId);
    expect(
      (await app.views
        .listHtmlViews(owner, { limit: 10, cursor: undefined }))
        .items.map((item) => item.resource.id),
    ).toEqual([newest.resourceId, sameTimeB.resourceId, oldest.resourceId]);
  });

  it("lists only HTML Views in the reader's own Spaces and granted subtrees", async ({ onTestFinished }) => {
    const root = await mkdtemp(join(tmpdir(), "workspace-html-views-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const app = await createProductTestApplication({
      productFilename: ":memory:", collaborationDatabaseFilename: ":memory:", blobDirectory: root, secureCookies: false,
    }, { unitStore: { createUnit: async ({ unitId }) => ({ unitId, headRevision: 1 }) } });
    onTestFinished(() => app.close());
    const register = async (username: string) => (await app.identity.registerWithPassword({
      username, displayName: username, password: "correct horse battery staple",
    })).view.user.id;
    const owner = await register("owner");
    const member = await register("member");
    const grantee = await register("grantee");
    const stranger = await register("stranger");
    const agent = (await app.identity.createAgent({ label: "Guest", originIp: "127.0.0.1" })).user.id;
    const personal = (await app.spaces.list(owner)).spaces[0]!.id;
    const team = (await app.spaces.createTeamSpace(owner, { name: "Supply" })).id;
    const gallery = (await app.spaces.createTeamSpace(owner, { name: "Gallery", publicRead: true })).id;
    await app.permissions.upsertTeamMember(owner, team, member, { role: "viewer" });
    const folder = async (name: string) =>
      (await app.nodes.create(owner, { spaceId: personal, parentNodeId: null, name })).id;
    const publish = async (name: string, spaceId: string, parentNodeId: string | null = null) => {
      const { draft } = await app.htmlViewDrafts.submit(owner, randomUUID(), {
        kind: "create", spaceId, parentNodeId, name,
        html: "<!doctype html><html><body><h1>Report</h1></body></html>",
      });
      return (await app.htmlViewDrafts.publish(owner, draft.id)).published!;
    };

    const grantedFolder = await folder("Shared with grantee");
    const grantedOld = await publish("Granted old", personal, grantedFolder);
    const linkFolder = await folder("Shared by link");
    const linkedChild = await publish("Linked child", personal, linkFolder);
    const linked = await publish("Linked", personal);
    const own = await publish("Own", personal);
    const teamView = await publish("Team", team);
    const publicView = await publish("Public", gallery);
    const trashed = await publish("Trashed", personal);
    const grantedNew = await publish("Granted new", personal, grantedFolder);
    await app.permissions.upsertNodeGrant(owner, grantedFolder, grantee, { role: "viewer" });
    await app.permissions.updateNodeLinkSharing(owner, linkFolder, { enabled: true, role: "editor" });
    await app.permissions.updateNodeLinkSharing(owner, linked.nodeId, { enabled: true, role: "viewer" });
    await app.trash.trashNode(owner, trashed.nodeId);

    const list = async (userId: string, spaceId?: string) => {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await app.views.listHtmlViews(userId, { limit: 1, cursor, ...(spaceId ? { spaceId } : {}) });
        ids.push(...page.items.map((item) => item.resource.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return ids.sort();
    };
    const ids = (...views: { readonly resourceId: string }[]) => views.map((view) => view.resourceId).sort();

    expect(await list(owner)).toEqual(ids(grantedOld, linkedChild, linked, own, teamView, publicView, grantedNew));
    expect(await list(owner, team)).toEqual(ids(teamView));
    expect(await list(member)).toEqual(ids(teamView));
    expect(await list(grantee)).toEqual(ids(grantedOld, grantedNew));
    expect(await list(grantee, personal)).toEqual(ids(grantedOld, grantedNew));
    for (const reader of [member, grantee, stranger, agent]) {
      expect(await list(reader, gallery)).toEqual(ids(publicView));
    }
    for (const reader of [stranger, agent]) {
      expect(await list(reader)).toEqual([]);
      expect(await list(reader, personal)).toEqual([]);
    }
  });
});
