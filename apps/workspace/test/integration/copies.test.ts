import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  transformSnapshotToDocumentData,
  transformSnapshotToSlideData,
  transformSnapshotToWorkbookData,
} from "@univerjs-pro/collaboration";
import { getSlidesEmptySnapshot, PageElementTypeEnum } from "@univerjs-pro/slides";
import {
  DocumentFlavor,
  DrawingTypeEnum,
  getDocsEmptySnapshot,
  ImageSourceType,
  LocaleType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
  type IWorkbookData,
} from "@univerjs/core";
import { UniverType } from "@univerjs/protocol";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { createBlobStore } from "../../server/src/integrations/blob/create-blob-store.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import {
  blankUnitData,
  collaborationCallOptions,
  createCollaborationRuntime,
  UnitStoreError,
} from "../../server/src/integrations/univer/unit-store.js";
import { createWorktreeBackend } from "../../server/src/integrations/univer/worktree-store.js";
import type { CopyPayload } from "../../server/src/modules/copies/copies.types.js";
import type { Principal } from "../../server/src/modules/identity/index.js";
import type { NodeSummary } from "../../server/src/modules/nodes/index.js";
import type { WorktreeUnit } from "../../server/src/modules/worktrees/index.js";
import { interactivePrincipal } from "../fixtures/principal.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
type CopyType = "sheet" | "doc" | "slide";
type Harness = Awaited<ReturnType<typeof start>>;
const cleanups: (() => Promise<void>)[] = [];
const never = () => new Promise<never>(() => undefined);
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// The copy module reads the clock it finds when the application is created.
beforeAll(() => void vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }));
afterAll(() => void vi.useRealTimers());
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start() {
  const directory = mkdtempSync(join(tmpdir(), "workspace-copies-"));
  const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
  const postgres = url ? await createPostgresTestDatabase(url) : undefined;
  const cleanup = new AsyncDisposableStack();
  cleanups.push(() => cleanup.disposeAsync());
  cleanup.defer(() => rmSync(directory, { recursive: true, force: true }));
  if (postgres) cleanup.defer(postgres.close);
  const config: WorkspaceConfig = {
    ...loadConfig({}),
    host: "127.0.0.1",
    port: 0,
    secureCookies: false,
    sessionTtlMs: 3_600_000,
    blobDirectory: join(directory, "objects"),
    ...(postgres && { s3BlobStore: await createTestBucket(cleanup) }),
    database: postgres
      ? { provider: "postgres", connectionString: postgres.connectionString }
      : { provider: "sqlite", filename: join(directory, "product.sqlite"), collaborationFilename: join(directory, "collaboration.sqlite") },
  };
  const database = await openProductDatabase(config.database);
  cleanup.defer(() => database.close());
  const collaboration = await openCollaborationDatabase(config, database.unitCreationFacts);
  cleanup.defer(() => collaboration.close());
  const runtime = createCollaborationRuntime(collaboration);
  cleanup.defer(() => runtime.dispose());
  const store = createBlobStore(config);
  cleanup.defer(async () => void (await store.dispose?.()));
  const worktreeBackend = createWorktreeBackend(runtime.worktreeService, runtime.service);
  const application = createWorkspaceApplication(config, database.repositories, collaboration, {
    unitStore: runtime.unitStore,
    unitSnapshotStore: runtime.unitSnapshotStore,
    worktreeBackend,
    blobStore: store,
  });
  cleanup.defer(() => application.close());
  await application.initialize();

  const personal = async (userId: string) =>
    (await application.spaces.list(userId)).spaces.find((space) => space.type === "personal" && space.accessRole === "owner")!.id;
  return {
    application,
    repositories: database.repositories,
    runtime,
    store,
    worktreeBackend,
    async stored(operationId: string) {
      const { content } = JSON.parse((await database.repositories.copies.find(operationId))!.payload_json) as CopyPayload;
      const objects = content.kind === "blob" ? [content.object] : content.assets;
      return Promise.all(objects.map(async ({ objectKey }) => (await store.head(objectKey)) !== null));
    },
    personal,
    async human(username: string) {
      const issued = await application.identity.registerWithPassword({ username, displayName: username, password: "correct horse battery staple" });
      const id = issued.view.user.id;
      return { id, principal: interactivePrincipal(id), spaceId: await personal(id), cookie: `${application.identity.cookieName}=${issued.cookieValue}` };
    },
    async guestAgent() {
      const { user } = await application.identity.createAgent({ label: "guest", originIp: undefined });
      const principal: Principal = { user: { ...user, kind: "agent", claimed: false }, writeSource: null, tokenIssued: true };
      return { id: user.id, principal, spaceId: await personal(user.id) };
    },
    async rootNodes(userId: string) {
      return (await application.nodes.listSpaceRoot(userId, await personal(userId), { cursor: undefined, limit: undefined })).nodes;
    },
  };
}

async function readUnit(h: Harness, unitId: string, unitType: CopyType) {
  const { snapshot, sheetBlocks } = await h.runtime.unitSnapshotStore.materialize({ unitId, unitType, userId: "reader" });
  const data =
    unitType === "sheet" ? await transformSnapshotToWorkbookData(snapshot, structuredClone(sheetBlocks))
    : unitType === "doc" ? transformSnapshotToDocumentData(snapshot)
    : transformSnapshotToSlideData(snapshot);
  return data as unknown as Record<string, unknown>;
}

/** Creates a Unit the way an Office import does: content first, then the image it references. */
async function createUnit(h: Harness, owner: { id: string; spaceId: string }, unitType: CopyType, name: string,
  build: (unitId: string, assetId: string) => unknown) {
  const unitId = randomUUID();
  const assetId = randomUUID();
  const created = await h.application.resources.create(owner.id, randomUUID(), {
    kind: "univer", spaceId: owner.spaceId, parentNodeId: null, name, unitType, initialData: build(unitId, assetId),
  }, { unitId });
  if (created.status === 202) throw new Error("The source Unit was not created.");
  await h.application.univerAssets.storeImported({ actorUserId: owner.id, unitId, files: [{ assetId, filename: "image.png", mediaType: "image/png", bytes: PNG }] });
  return { unitId, assetId, nodeId: created.body.node.id };
}

async function createSheet(h: Harness, owner: { id: string; spaceId: string }) {
  let sheetId = "";
  const source = await createUnit(h, owner, "sheet", "Budget", (unitId, assetId) => {
    const data = blankUnitData({ unitId, unitType: "sheet", name: "Budget" }).data as IWorkbookData;
    sheetId = data.sheetOrder[0]!;
    const sheet = data.sheets[sheetId]!;
    sheet.cellData = { 0: { 0: { v: 10 }, 1: { f: "=A1*3" } } };
    sheet.mergeData = [{ startRow: 5, endRow: 6, startColumn: 0, endColumn: 1 }];
    const position = { from: { column: 3, columnOffset: 0, row: 1, rowOffset: 0 }, to: { column: 5, columnOffset: 0, row: 5, rowOffset: 0 } };
    data.resources = [{
      name: "SHEET_DRAWING_PLUGIN",
      data: JSON.stringify({ [sheetId]: { data: { image: {
        unitId, subUnitId: sheetId, drawingId: "image", drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        imageSourceType: ImageSourceType.UUID, source: assetId,
        sheetTransform: position, axisAlignSheetTransform: position,
        transform: { left: 200, top: 40, width: 120, height: 80 },
      } }, order: ["image"] } }),
    }];
    return data;
  });
  return { ...source, sheetId };
}

function sheetFacts(data: Record<string, unknown>, sheetId: string) {
  const workbook = data as unknown as IWorkbookData;
  const sheet = workbook.sheets[sheetId]!;
  const drawing = JSON.parse(workbook.resources!.find((resource) => resource.name === "SHEET_DRAWING_PLUGIN")!.data)[sheetId].data.image;
  return {
    value: sheet.cellData?.[0]?.[0]?.v,
    formula: sheet.cellData?.[0]?.[1]?.f,
    merges: sheet.mergeData,
    imageUnitId: drawing.unitId as string,
    imageAssetId: drawing.source as string,
  };
}

async function editSourceCell(h: Harness, source: { unitId: string; sheetId: string }, userId: string, value: number) {
  const options = collaborationCallOptions(userId);
  const { targetRevision } = await h.runtime.service.getUnitLoadData({ unitID: source.unitId, type: UniverType.UNIVER_SHEET, revision: 0 }, options);
  const result = await h.runtime.service.submitChangeset({
    changeset: {
      unitID: source.unitId, type: UniverType.UNIVER_SHEET, baseRev: targetRevision, revision: 0, userID: userId,
      memberID: options.memberID, sid: randomUUID(), reqId: 1,
      mutations: [{ id: "sheet.mutation.set-range-values", data: JSON.stringify({ unitId: source.unitId, subUnitId: source.sheetId, cellValue: { 0: { 0: { v: value } } } }) }],
    },
  }, options);
  expect(result.status).toBe("committed");
}

async function assetBytes(h: Harness, userId: string, assetId: string): Promise<Buffer> {
  const opened = await h.application.univerAssets.openContent(userId, { kind: "trunk" }, assetId, undefined);
  return Buffer.concat(await opened.stream.toArray());
}

async function uploadBlob(h: Harness, owner: { id: string; principal: Principal; spaceId: string }, name: string, content: Buffer) {
  const reserved = await h.application.blobs.createUpload(owner.principal, randomUUID(), {
    spaceId: owner.spaceId, parentNodeId: null, name, originalFilename: name, byteSize: content.length,
  });
  await h.application.blobs.upload(owner.id, reserved.body.upload.id, String(content.length), Readable.from([content]));
  return (await h.application.blobs.complete(owner.principal, reserved.body.upload.id)).body.node;
}

async function listen(h: Harness): Promise<string> {
  const server = createServer(h.application.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (origin: string, path: string, cookie: string | null, body: unknown, key: string | null = randomUUID()) =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(key ? { "idempotency-key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const toPersonalSpace = { target: { kind: "personalSpace" } };
const shareByLink = (h: Harness, ownerId: string, nodeId: string, enabled = true) =>
  h.application.permissions.updateNodeLinkSharing(ownerId, nodeId, { enabled, role: "viewer" });
const copiedNode = (result: { readonly status: number; readonly body: object }) => {
  expect(result.status).toBe(201);
  return (result.body as { readonly node: NodeSummary }).node;
};
/** Lets a held lease and any retry delay run out. */
const later = () => vi.setSystemTime(Date.now() + 61_000);

describe("copying a file", () => {
  it("copies a link-shared Sheet into an unclaimed agent's Personal Space and records its source", async () => {
    const h = await start();
    const owner = await h.human("copy-owner");
    const agent = await h.guestAgent();
    const source = await createSheet(h, owner);
    await shareByLink(h, owner.id, source.nodeId);
    const before = await readUnit(h, source.unitId, "sheet");

    const key = randomUUID();
    const node = copiedNode(await h.application.copies.copy(agent.principal, source.nodeId, key, toPersonalSpace));

    expect(node).toMatchObject({ spaceId: agent.spaceId, parentNodeId: null, name: "Budget", accessRole: "owner" });
    expect(await h.application.nodes.get(agent.id, node.id)).toMatchObject({ copiedFromNodeId: source.nodeId, copyCount: 0 });
    expect(await h.application.nodes.get(owner.id, source.nodeId)).toMatchObject({ copiedFromNodeId: null, copyCount: 1 });
    const unitId = (node.resource as { unitId: string }).unitId;
    const copy = await readUnit(h, unitId, "sheet");
    const facts = sheetFacts(copy, source.sheetId);
    expect(facts).toMatchObject({
      value: 10,
      formula: "=A1*3",
      merges: [expect.objectContaining({ startRow: 5, endRow: 6, startColumn: 0, endColumn: 1 })],
      imageUnitId: unitId,
    });
    expect(facts.imageAssetId).not.toBe(source.assetId);
    expect(JSON.stringify(copy)).not.toContain(source.unitId);
    expect(copy.rev).toBe(1);
    expect((await h.repositories.copies.find(key))!.payload_json).not.toContain("=A1*3");

    expect(await readUnit(h, source.unitId, "sheet")).toEqual(before);
    expect((await h.repositories.univerAssets.findAsset(source.assetId))!.unit_id).toBe(source.unitId);
    await editSourceCell(h, source, owner.id, 999);
    expect(sheetFacts(await readUnit(h, unitId, "sheet"), source.sheetId).value).toBe(10);

    const replay = await h.application.copies.copy(agent.principal, source.nodeId, key, toPersonalSpace);
    expect(replay).toMatchObject({ status: 200, body: { node: { id: node.id }, operation: { kind: "copyNode", state: "completed" } } });
    await expect(h.application.copies.copy(agent.principal, source.nodeId, key, { ...toPersonalSpace, name: "Other" }))
      .rejects.toMatchObject({ status: 409 });
    await expect(h.application.copies.copy(owner.principal, source.nodeId, key, toPersonalSpace))
      .rejects.toMatchObject({ status: 409 });
    expect(await h.rootNodes(agent.id)).toHaveLength(1);

    await shareByLink(h, owner.id, source.nodeId, false);
    await expect(h.application.nodes.get(agent.id, source.nodeId)).rejects.toMatchObject({ status: 404 });
    await expect(assetBytes(h, agent.id, source.assetId)).rejects.toMatchObject({ status: 404 });
    expect(await assetBytes(h, agent.id, facts.imageAssetId)).toEqual(PNG);
    await expect(h.application.copies.copy(agent.principal, source.nodeId, randomUUID(), toPersonalSpace))
      .rejects.toMatchObject({ status: 404 });

    const batch = await h.application.trash.trashNode(owner.id, source.nodeId);
    expect((await h.application.nodes.get(agent.id, node.id)).copiedFromNodeId).toBe(source.nodeId);
    await h.application.trash.removePermanently(owner.id, batch.id);
    expect((await h.application.nodes.get(agent.id, node.id)).copiedFromNodeId).toBeNull();
  }, 120_000);

  it("copies into a draft pull request and carries the source through the merge", async () => {
    const h = await start();
    const owner = await h.human("pr-owner");
    const agent = await h.guestAgent();
    const stranger = await h.human("pr-stranger");
    const source = await createSheet(h, owner);
    await shareByLink(h, owner.id, source.nodeId);
    const worktreeId = (await h.application.worktrees.create(agent.id, randomUUID(), { kind: "user", name: "Remix", summary: null })).body.id;
    const target = { kind: "worktree", worktreeId, spaceId: agent.spaceId, parentNodeId: null };

    const key = randomUUID();
    const result = await h.application.copies.copy(agent.principal, source.nodeId, key, { target, name: "My budget" });

    expect(result.status).toBe(201);
    const unit = (result.body as { readonly unit: WorktreeUnit }).unit;
    expect(unit).toMatchObject({ source: "worktree", name: "My budget", unitType: "sheet", target: { spaceId: agent.spaceId, parentNodeId: null } });
    expect(await h.rootNodes(agent.id)).toHaveLength(0);
    expect((await h.application.nodes.get(owner.id, source.nodeId)).copyCount).toBe(0);
    expect(await h.application.copies.copy(agent.principal, source.nodeId, key, { target, name: "My budget" }))
      .toMatchObject({ status: 200, body: { unit: { unitId: unit.unitId } } });

    await expect(h.application.copies.copy(stranger.principal, source.nodeId, randomUUID(), { target }))
      .rejects.toMatchObject({ status: 404 });
    await expect(h.application.copies.copy(agent.principal, source.nodeId, randomUUID(), { target: { ...target, spaceId: owner.spaceId } }))
      .rejects.toMatchObject({ status: 404 });

    await h.application.worktrees.markReady(agent.id, worktreeId);
    await h.application.worktrees.merge(agent.id, worktreeId, randomUUID());

    const [node] = await h.rootNodes(agent.id);
    expect(node).toMatchObject({ id: unit.nodeId, name: "My budget" });
    expect((await h.application.nodes.get(agent.id, node!.id)).copiedFromNodeId).toBe(source.nodeId);
    expect((await h.application.nodes.get(owner.id, source.nodeId)).copyCount).toBe(1);
    const facts = sheetFacts(await readUnit(h, unit.unitId, "sheet"), source.sheetId);
    expect(facts).toMatchObject({ value: 10, formula: "=A1*3", imageUnitId: unit.unitId });
    await shareByLink(h, owner.id, source.nodeId, false);
    expect(await assetBytes(h, agent.id, facts.imageAssetId)).toEqual(PNG);
  }, 120_000);

  it("copies a Doc, a Slide and a Blob file", async () => {
    const h = await start();
    const owner = await h.human("kinds-owner");
    const reader = await h.human("kinds-reader");
    const doc = await createUnit(h, owner, "doc", "Memo", (unitId, assetId) => {
      const data = getDocsEmptySnapshot(unitId, LocaleType.EN_US, "Memo", DocumentFlavor.MODERN);
      data.body = {
        dataStream: "Hello\b\r\n",
        textRuns: [], paragraphs: [{ startIndex: 6, paragraphId: "paragraph" }], sectionBreaks: [{ startIndex: 7, sectionId: "section" }],
        customBlocks: [{ startIndex: 5, blockId: "pic" }],
      };
      data.drawings = {
        pic: {
          unitId, subUnitId: unitId, drawingId: "pic", drawingType: DrawingTypeEnum.DRAWING_IMAGE,
          imageSourceType: ImageSourceType.UUID, source: assetId, title: "", description: "",
          layoutType: PositionedObjectLayoutType.INLINE,
          docTransform: { size: { width: 40, height: 40 }, angle: 0,
            positionH: { relativeFrom: ObjectRelativeFromH.COLUMN, posOffset: 0 },
            positionV: { relativeFrom: ObjectRelativeFromV.PARAGRAPH, posOffset: 0 } },
        } as never,
      };
      data.drawingsOrder = ["pic"];
      return data;
    });
    const slide = await createUnit(h, owner, "slide", "Deck", (unitId, assetId) => {
      const data = getSlidesEmptySnapshot(unitId, undefined, "Deck");
      const page = data.slides[data.slideOrder[0]!]!;
      page.elements.image = { id: "image", type: PageElementTypeEnum.Image, imageSourceType: ImageSourceType.UUID, source: assetId,
        transform: { left: 20, top: 20, width: 100, height: 100, rotation: 0 } } as never;
      page.elementOrder.push("image");
      return data;
    });

    for (const [unitType, source] of [["doc", doc], ["slide", slide]] as const) {
      await shareByLink(h, owner.id, source.nodeId);
      const node = copiedNode(await h.application.copies.copy(reader.principal, source.nodeId, randomUUID(), toPersonalSpace));
      const unitId = (node.resource as { unitId: string }).unitId;
      const text = JSON.stringify(await readUnit(h, unitId, unitType));
      expect(text).not.toContain(source.unitId);
      expect(text).not.toContain(source.assetId);
      if (unitType === "doc") expect(text).toContain("Hello");
      const [asset] = (await h.repositories.copies.findTrunkAssets([...text.matchAll(/[0-9a-f-]{36}/g)].map(([id]) => id)));
      expect(asset).toMatchObject({ unit_id: unitId, created_by: reader.id });
      await shareByLink(h, owner.id, source.nodeId, false);
      expect(await assetBytes(h, reader.id, asset!.id)).toEqual(PNG);
    }

    const content = Buffer.from("quarterly numbers\n");
    const blob = await uploadBlob(h, owner, "notes.txt", content);
    await shareByLink(h, owner.id, blob.id);
    const node = copiedNode(await h.application.copies.copy(reader.principal, blob.id, randomUUID(), toPersonalSpace));
    expect(node).toMatchObject({ spaceId: reader.spaceId, name: "notes.txt", resource: { kind: "blob", byteSize: content.length } });
    expect(node.resource!.id).not.toBe(blob.resource!.id);
    expect((await h.application.nodes.get(reader.id, node.id)).copiedFromNodeId).toBe(blob.id);
    await shareByLink(h, owner.id, blob.id, false);
    const opened = await h.application.blobs.openContent(reader.id, node.resource!.id, undefined);
    expect(Buffer.concat(await opened.stream.toArray())).toEqual(content);

    await shareByLink(h, owner.id, blob.id);
    const worktreeId = (await h.application.worktrees.create(reader.id, randomUUID(), { kind: "user", name: "Draft", summary: null })).body.id;
    await expect(h.application.copies.copy(reader.principal, blob.id, randomUUID(), {
      target: { kind: "worktree", worktreeId, spaceId: reader.spaceId, parentNodeId: null },
    })).rejects.toMatchObject({ status: 400 });
  }, 180_000);

  it("holds an agent's copy to the ceilings of an upload", async () => {
    const h = await start();
    const owner = await h.human("ceiling-owner");
    const agent = await h.guestAgent();
    const page = await uploadBlob(h, owner, "report.univer.html", Buffer.from("<html></html>"));
    const large = await uploadBlob(h, owner, "large.bin", Buffer.alloc(10 * 1024 * 1024 + 1));
    const small = await uploadBlob(h, owner, "small.txt", Buffer.from("x"));
    for (const node of [page, large, small]) await shareByLink(h, owner.id, node.id);

    await expect(h.application.copies.copy(agent.principal, page.id, randomUUID(), toPersonalSpace))
      .rejects.toMatchObject({ status: 403, code: "HTML_VIEW_DRAFT_REQUIRED" });
    await expect(h.application.copies.copy(agent.principal, large.id, randomUUID(), toPersonalSpace))
      .rejects.toMatchObject({ status: 403, code: "AGENT_QUOTA_EXCEEDED" });
    for (let held = 0; held < 20; held += 1) {
      copiedNode(await h.application.copies.copy(agent.principal, small.id, randomUUID(), toPersonalSpace));
    }
    await expect(h.application.copies.copy(agent.principal, small.id, randomUUID(), toPersonalSpace))
      .rejects.toMatchObject({ status: 403, code: "AGENT_QUOTA_EXCEEDED" });
    expect(await h.rootNodes(agent.id)).toHaveLength(20);
  }, 120_000);

  it("answers over HTTP, and refuses an unreadable source with the 404 of reading it", async () => {
    const h = await start();
    const owner = await h.human("http-owner");
    const reader = await h.human("http-reader");
    const source = await createSheet(h, owner);
    const folder = await h.application.nodes.create(owner.id, { spaceId: owner.spaceId, parentNodeId: null, name: "Folder" });
    const origin = await listen(h);
    const copy = (nodeId: string, cookie: string | null, key: string | null = randomUUID(), body: unknown = toPersonalSpace) =>
      post(origin, `/api/nodes/${nodeId}/copies`, cookie, body, key);

    const reading = await fetch(`${origin}/api/nodes/${source.nodeId}`, { headers: { cookie: reader.cookie } });
    const refused = await copy(source.nodeId, reader.cookie);
    expect(refused.status).toBe(404);
    expect(reading.status).toBe(404);
    expect(await refused.json()).toEqual(await reading.json());
    expect((await copy(randomUUID(), reader.cookie)).status).toBe(404);
    expect((await copy(source.nodeId, null)).status).toBe(401);

    await shareByLink(h, owner.id, source.nodeId);
    await shareByLink(h, owner.id, folder.id);
    expect((await copy(source.nodeId, null)).status).toBe(401);
    expect((await copy(folder.id, reader.cookie)).status).toBe(400);
    expect((await copy(source.nodeId, reader.cookie, null)).status).toBe(400);
    expect((await copy(source.nodeId, reader.cookie, randomUUID(), { target: { kind: "space" } })).status).toBe(400);

    const key = randomUUID();
    const created = await copy(source.nodeId, reader.cookie, key);
    expect(created.status).toBe(201);
    const { node, operation } = await created.json() as { node: NodeSummary; operation: { id: string } };
    expect(operation.id).toBe(key);
    expect((await copy(source.nodeId, reader.cookie, key)).status).toBe(200);
    const fetched = await fetch(`${origin}/api/nodes/${node.id}`, { headers: { cookie: reader.cookie } });
    expect(await fetched.json()).toMatchObject({ node: { id: node.id, spaceId: reader.spaceId }, copiedFromNodeId: source.nodeId });
    const provenance = async (cookie?: string) =>
      ((await (await fetch(`${origin}/api/nodes/${node.id}`, { headers: cookie ? { cookie } : {} })).json()) as { copiedFromNodeId: unknown }).copiedFromNodeId;
    await shareByLink(h, reader.id, node.id);
    expect(await provenance()).toBeNull();
    expect(await provenance(owner.cookie)).toBeNull();
    await h.application.permissions.upsertNodeGrant(reader.id, node.id, owner.id, { role: "editor" });
    expect(await provenance(owner.cookie)).toBe(source.nodeId);
    const stored = await fetch(`${origin}/api/operations/${key}`, { headers: { cookie: reader.cookie } });
    expect(await stored.json()).toMatchObject({ kind: "copyNode", state: "completed", result: { nodeId: node.id } });
  }, 120_000);

  it("lets a human copy from the Space of an agent they claimed and stopped, and refuses the stopped agent", async () => {
    const h = await start();
    const origin = await listen(h);
    const guest = await post(origin, "/api/auth/guest", null, {});
    const agentCookie = guest.headers.get("set-cookie")!.split(";")[0]!;
    const agentId = ((await guest.json()) as { agent: { id: string } }).agent.id;
    const claimer = await h.human("claimer");
    const stranger = await h.human("claimer-stranger");
    const source = await createSheet(h, { id: agentId, spaceId: await h.personal(agentId) });
    await shareByLink(h, agentId, source.nodeId);
    const { code } = (await (await post(origin, "/api/agents/claim-codes", agentCookie, undefined)).json()) as { code: string };
    expect((await post(origin, "/api/agents/claim", claimer.cookie, { code })).status).toBe(200);
    expect((await post(origin, `/api/agents/${agentId}/stop`, claimer.cookie, undefined)).status).toBe(204);

    expect((await post(origin, `/api/nodes/${source.nodeId}/copies`, agentCookie, toPersonalSpace)).status).toBe(401);
    expect((await post(origin, `/api/nodes/${source.nodeId}/copies`, stranger.cookie, toPersonalSpace)).status).toBe(404);
    const copied = await post(origin, `/api/nodes/${source.nodeId}/copies`, claimer.cookie, toPersonalSpace);
    expect(copied.status).toBe(201);
    const { node } = (await copied.json()) as { node: NodeSummary };
    expect(node).toMatchObject({ spaceId: claimer.spaceId, accessRole: "owner" });
    expect((await h.application.nodes.get(claimer.id, node.id)).copiedFromNodeId).toBe(source.nodeId);
    expect(sheetFacts(await readUnit(h, (node.resource as { unitId: string }).unitId, "sheet"), source.sheetId).value).toBe(10);
  }, 120_000);

  it("finishes a copy whose process died at any step, at the revision it started from", async () => {
    const h = await start();
    const owner = await h.human("crash-owner");
    const reader = await h.human("crash-reader");
    const source = await createSheet(h, owner);
    await shareByLink(h, owner.id, source.nodeId);
    const createUnitOnce = h.runtime.unitStore.createUnit.bind(h.runtime.unitStore);
    const createDraftOnce = h.worktreeBackend.createUnit.bind(h.worktreeBackend);
    const worktreeId = (await h.application.worktrees.create(reader.id, randomUUID(), { kind: "user", name: "Draft", summary: null })).body.id;

    const copyingObjects = signal();
    vi.spyOn(h.store, "put").mockImplementationOnce(() => {
      copyingObjects.resolve();
      return never();
    });
    const whileCopying = randomUUID();
    void h.application.copies.copy(reader.principal, source.nodeId, whileCopying, toPersonalSpace);
    await copyingObjects.promise;
    await editSourceCell(h, source, owner.id, 999);
    expect(await h.application.copies.copy(reader.principal, source.nodeId, whileCopying, toPersonalSpace))
      .toMatchObject({ status: 202, body: { operation: { state: "pending" } } });
    expect(await h.application.copies.resumeDue("worker")).toBe(0);

    const unitCreated = signal();
    vi.spyOn(h.runtime.unitStore, "createUnit").mockImplementationOnce(async (input) => {
      await createUnitOnce(input);
      unitCreated.resolve();
      return never();
    });
    const afterUnit = randomUUID();
    void h.application.copies.copy(reader.principal, source.nodeId, afterUnit, toPersonalSpace);
    const draftCreated = signal();
    vi.spyOn(h.worktreeBackend, "createUnit").mockImplementationOnce(async (input, userId) => {
      await createDraftOnce(input, userId);
      draftCreated.resolve();
      return never();
    });
    const afterDraft = randomUUID();
    void h.application.copies.copy(reader.principal, source.nodeId, afterDraft, {
      target: { kind: "worktree", worktreeId, spaceId: reader.spaceId, parentNodeId: null },
    });
    await Promise.all([unitCreated.promise, draftCreated.promise]);
    expect(await h.rootNodes(reader.id)).toHaveLength(0);

    later();
    expect(await h.application.copies.resumeDue("worker")).toBe(3);

    for (const key of [whileCopying, afterUnit, afterDraft]) {
      expect(await h.application.operations.get(reader.id, key)).toMatchObject({ state: "completed", error: null });
    }
    expect(await h.rootNodes(reader.id)).toHaveLength(2);
    expect((await h.application.worktrees.get(reader.id, worktreeId)).worktree.units).toHaveLength(1);
    const valueOf = async (key: string) => {
      const { result } = await h.application.operations.get(reader.id, key);
      return sheetFacts(await readUnit(h, result!.unitId as string, "sheet"), source.sheetId).value;
    };
    // The copy that started before the owner's edit holds the old value; the later one holds the new.
    expect(await valueOf(whileCopying)).toBe(10);
    expect(await valueOf(afterUnit)).toBe(999);
    for (const key of [whileCopying, afterUnit, afterDraft]) expect(await h.stored(key)).toEqual([true]);
    expect(await h.application.copies.resumeDue("worker")).toBe(0);
  }, 180_000);

  it("retries a failure, and removes what it created when it cannot finish", async () => {
    const h = await start();
    const owner = await h.human("failure-owner");
    const reader = await h.human("failure-reader");
    const source = await createSheet(h, owner);
    await shareByLink(h, owner.id, source.nodeId);
    const createUnitOnce = h.runtime.unitStore.createUnit.bind(h.runtime.unitStore);

    vi.spyOn(h.store, "put").mockRejectedValueOnce(new Error("The object store is down."));
    const retried = randomUUID();
    expect(await h.application.copies.copy(reader.principal, source.nodeId, retried, toPersonalSpace)).toMatchObject({
      status: 202,
      body: { operation: { state: "pending", error: { message: "The object store is down." } } },
    });
    later();
    expect(await h.application.copies.resumeDue("worker")).toBe(1);
    expect(await h.application.operations.get(reader.id, retried)).toMatchObject({ state: "completed" });
    expect(await h.rootNodes(reader.id)).toHaveLength(1);
    expect(await h.stored(retried)).toEqual([true]);

    let unitId = "";
    vi.spyOn(h.runtime.unitStore, "createUnit").mockImplementationOnce(async (input) => {
      unitId = (await createUnitOnce(input)).unitId;
      throw new UnitStoreError("LICENSE_INVALID", "The license does not allow this Unit.", false);
    });
    const refused = randomUUID();
    expect(await h.application.copies.copy(reader.principal, source.nodeId, refused, toPersonalSpace)).toMatchObject({
      status: 202,
      body: { operation: { state: "failed", error: { code: "LICENSE_INVALID" } } },
    });
    expect(await h.rootNodes(reader.id)).toHaveLength(1);
    await expect(h.runtime.service.getUnitLoadData(
      { unitID: unitId, type: UniverType.UNIVER_SHEET, revision: 0 },
      collaborationCallOptions(reader.id),
    )).rejects.toMatchObject({ code: "UNIT_NOT_FOUND" });
    expect(await h.stored(refused)).toEqual([true]);
    await h.application.blobs.runMaintenance("worker");
    expect(await h.stored(refused)).toEqual([false]);
    expect(await h.stored(retried)).toEqual([true]);
    await expect(h.application.operations.retry(reader.id, refused)).rejects.toMatchObject({ status: 409 });
    expect(await h.application.copies.resumeDue("worker")).toBe(0);

    vi.spyOn(h.store, "put").mockRejectedValue(new Error("The object store is down."));
    const exhausted = randomUUID();
    await h.application.copies.copy(reader.principal, source.nodeId, exhausted, toPersonalSpace);
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      expect(await h.application.operations.get(reader.id, exhausted)).toMatchObject({ state: "pending" });
      later();
      expect(await h.application.copies.resumeDue("worker")).toBe(1);
    }
    expect(await h.application.operations.get(reader.id, exhausted)).toMatchObject({
      state: "failed",
      error: { message: "The object store is down." },
    });
    expect(await h.stored(exhausted)).toEqual([false]);
    expect(await h.rootNodes(reader.id)).toHaveLength(1);
  }, 180_000);
});
