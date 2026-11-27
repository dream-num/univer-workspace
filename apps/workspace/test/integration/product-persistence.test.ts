import { interactivePrincipal } from "../fixtures/principal.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createProductTestApplication } from "../support/product-test-application.js";
import { createAccessTokenService } from "../../server/src/modules/identity/access-tokens.js";

it("publishes drafts and retains the published HTML and Skill files in the catalog", async ({ onTestFinished }) => {
  const { app, owner, space } = await setup(onTestFinished);
  const html = await app.htmlViewDrafts.submit(owner, randomUUID(), {
    kind: "create", name: "Weekly", spaceId: space,
    html: "<!doctype html><html><body><h1>Report</h1></body></html>",
  });
  const published = await app.htmlViewDrafts.publish(owner, html.draft.id);
  expect(published.state).toBe("published");
  expect(await app.repositories.views.listHtmlViews(owner, null, 10, space)).toHaveLength(1);

  const skill = await app.skillDrafts.submit(owner, randomUUID(), {
    name: "weekly-report", spaceId: space, replace: false, keep: [], review: [],
    files: [{ path: "SKILL.md", text: "---\nname: weekly-report\ndescription: Build weekly reports.\n---\nUse Workspace." }],
  });
  expect((await app.skillDrafts.publish(owner, skill.draft.id)).state).toBe("published");
  const target = await app.repositories.skillDrafts.target(space, "weekly-report");
  expect(target.files.map(file => file.path)).toEqual(["SKILL.md"]);
});

it("checks live content access for collaborators and persists embedded assets", async ({ onTestFinished }) => {
  const { app, owner, space } = await setup(onTestFinished);
  const stranger = (await app.identity.registerWithPassword({
    username: "stranger", displayName: "Stranger", password: "another test password",
  })).view.user.id;
  const created = await app.resources.create(owner, randomUUID(), {
    kind: "univer", spaceId: space, parentNodeId: null, name: "Sheet", unitType: "sheet",
  });
  if (created.status === 202 || !created.body.node.resource) throw new Error("Expected a created resource");
  const { resource } = await app.resources.open(owner, created.body.node.resource.id);
  if (resource.kind !== "univer") throw new Error("Expected a Univer Unit");
  const { unitId } = resource;
  const permissions = app.repositories.contentPermissions;
  const object = {
    id: randomUUID(), unitId, creatorUserId: owner, name: "Range", objectType: 1,
    strategies: [], readScope: 0, editScope: 0, collaborators: [{ userId: stranger, role: 0 }],
  };
  expect(await permissions.create(object, "sheet")).toBe("invalid-collaborator");
  expect(await permissions.get(unitId, object.id)).toBeNull();
  expect(await permissions.create({ ...object, collaborators: [] }, "sheet")).toBe("saved");
  const patch = { name: null, scope: null, strategies: null, collaborators: object.collaborators };
  expect(await permissions.update(owner, unitId, object.id, patch)).toBe("invalid-collaborator");
  await app.permissions.upsertNodeGrant(interactivePrincipal(owner), created.body.node.id, stranger, { role: "viewer" });
  expect(await permissions.update(owner, unitId, object.id, patch)).toBe("saved");
  expect(await permissions.get(unitId, object.id)).toEqual(object);

  const assets = app.repositories.univerAssets;
  const now = Date.now();
  const upload = await assets.reserveUpload({
    actorUserId: owner, unitId, worktreeId: null, originalFilename: "image.png",
    declaredMediaType: "image/png", expectedSize: 3, createdAt: now, expiresAt: now + 60_000,
  });
  await assets.markStored({ uploadId: upload.id, updatedAt: now, receivedSize: 3, sha256: "a".repeat(64), etag: "image" });
  const asset = await assets.publishStored(upload.id);
  expect(await assets.findAsset(asset.id)).toMatchObject({ unit_id: unitId, object_key: upload.objectKey, byte_size: 3 });
});

it("revokes the downstream session when its personal access token is revoked", async ({ onTestFinished }) => {
  const { app, owner, user } = await setup(onTestFinished);
  const tokens = createAccessTokenService({ repository: app.repositories.accessTokens, now: Date.now });
  const { record } = await tokens.createPersonalToken({ userId: owner, name: "Local" });
  const session = await app.identity.issueSession(user, "agent", { issuedFor: { kind: "pat", id: record.id } });
  const cookie = `${app.identity.cookieName}=${session.cookieValue}`;
  expect((await app.identity.requireSession(cookie)).user.id).toBe(owner);
  expect(await tokens.revokePersonalToken(owner, record.id)).toBe(true);
  await expect(app.identity.requireSession(cookie)).rejects.toThrow();
});

it("enforces the OAuth client limit and rotates a refresh token once under concurrent requests", async ({ onTestFinished }) => {
  const { app, owner } = await setup(onTestFinished);
  const tokens = createAccessTokenService({ repository: app.repositories.accessTokens, now: Date.now });
  const clients = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    tokens.registerClient({ clientName: `client-${index}`, redirectUris: ["https://client.example/callback"] }, 1)));
  expect(clients.filter(Boolean)).toHaveLength(1);
  const clientId = clients.find(client => client !== null)!.clientId;
  const resource = "https://workspace.example/mcp";
  const grant = await tokens.issueGrant({ userId: owner, clientId, scopes: ["read"], resource });
  const refresh = () => tokens.refreshGrant({ refreshToken: grant.refreshToken, clientId, resource });
  const outcomes = await Promise.all([refresh(), refresh()]);
  expect(outcomes.filter(result => result.ok)).toHaveLength(1);
  expect(outcomes).toContainEqual({ ok: false, reason: "retired" });
});

async function setup(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const root = await mkdtemp(join(tmpdir(), "workspace-product-contract-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const app = await createProductTestApplication({
    productFilename: ":memory:", collaborationDatabaseFilename: ":memory:", blobDirectory: root, secureCookies: false,
  }, { unitStore: { createUnit: async ({ unitId }) => ({ unitId, headRevision: 1 }) } });
  onTestFinished(() => app.close());
  const { view: { user } } = await app.identity.registerWithPassword({
    username: "owner", displayName: "Owner", password: "contract test password",
  });
  const space = (await app.spaces.list(user.id)).spaces[0]!.id;
  return { app, owner: user.id, space, user };
}
