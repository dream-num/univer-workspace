import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { FileSource } from "@univerjs/protocol";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { createBlobStore } from "../../server/src/integrations/blob/create-blob-store.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { startBlobMaintenance } from "../../server/src/jobs/blob-maintenance.js";
import { interactivePrincipal } from "../fixtures/principal.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
const unitStore = { async createUnit(input: { readonly unitId: string }) { return { unitId: input.unitId, headRevision: 1 }; } };

describe.skipIf(!url)("A second replica on the same PostgreSQL database and BlobStore", { timeout: 30_000 }, () => {
  it("leaves a Blob upload that is still streaming on the first replica alone", async () => {
    await using replicas = await sharedStorage();
    const first = await replicas.start();
    const { userId, spaceId } = await register(first, "blob-stream");
    const reserved = await first.blobs.createUpload(interactivePrincipal(userId), "replica-blob-upload-0001", {
      spaceId, parentNodeId: null, name: "large.bin", originalFilename: "large.bin", byteSize: 8,
    });
    const body = new PassThrough();
    const uploading = first.blobs.upload(userId, reserved.body.upload.id, "8", body);
    body.write(Buffer.from("half"));
    await until(async () => (await first.blobs.getUpload(userId, reserved.body.upload.id)).upload.state === "verifying");

    const second = await replicas.start();
    body.end(Buffer.from("done"));

    await expect(uploading).resolves.toBeUndefined();
    const completed = await second.blobs.complete(interactivePrincipal(userId), reserved.body.upload.id);
    expect(completed.status).toBe(201);
    const opened = await second.blobs.openContent(userId, reserved.body.upload.resourceId, undefined);
    expect(await buffer(opened.stream)).toEqual(Buffer.from("halfdone"));
  });

  it("leaves a Blob replacement that is still streaming on the first replica alone", async () => {
    await using replicas = await sharedStorage();
    const first = await replicas.start();
    const { userId, spaceId } = await register(first, "blob-replace");
    const actor = interactivePrincipal(userId);
    const reserved = await first.blobs.createUpload(actor, "replica-blob-original-0001", {
      spaceId, parentNodeId: null, name: "page.bin", originalFilename: "page.bin", byteSize: 3,
    });
    await first.blobs.upload(userId, reserved.body.upload.id, "3", Readable.from([Buffer.from("old")]));
    await first.blobs.complete(actor, reserved.body.upload.id);
    const resourceId = reserved.body.upload.resourceId;
    const current = await first.blobs.openContent(userId, resourceId, undefined);
    await buffer(current.stream);
    const body = new PassThrough();
    const operationId = "replica-blob-replace-0001";
    const replacing = first.blobs.replace(actor, resourceId, operationId, `"${current.access.etag}"`, "8", body);
    body.write(Buffer.from("new-"));
    await until(() => first.operations.get(userId, operationId).then((operation) => operation.state === "pending", () => false));

    const second = await replicas.start();
    body.end(Buffer.from("page"));

    await expect(replacing).resolves.toMatchObject({ operationId, resourceId });
    expect(await second.operations.get(userId, operationId)).toMatchObject({ state: "completed" });
    await replicas.maintain(second);
    const opened = await second.blobs.openContent(userId, resourceId, undefined);
    expect(await buffer(opened.stream)).toEqual(Buffer.from("new-page"));
  });

  it("leaves a Univer Asset upload that is still streaming on the first replica alone", async () => {
    await using replicas = await sharedStorage();
    const first = await replicas.start();
    const { userId, spaceId } = await register(first, "asset-stream");
    const created = await first.resources.create(userId, "replica-asset-slide-0001", {
      kind: "univer", spaceId, parentNodeId: null, name: "Slides", unitType: "slide",
    });
    const unitId = (await first.resources.open(userId, created.body.node.resource!.id)).resource;
    if (unitId.kind !== "univer") throw new Error("Created Resource is not a Univer Unit");
    const body = new PassThrough();
    const uploading = first.univerAssets.upload(userId, { kind: "trunk" }, {
      size: "8", source: String(FileSource.UnitEmbedded), assign: unitId.unitId,
      filename: "image.png", declaredMediaType: "image/png", body,
    });
    body.write(Buffer.from("half"));
    await until(async () => (await replicas.pool.query("SELECT 1 FROM univer_asset_uploads")).rowCount === 1);

    const second = await replicas.start();
    body.end(Buffer.from("done"));

    const { FileId } = await uploading;
    const opened = await second.univerAssets.openContent(userId, { kind: "trunk" }, FileId, undefined);
    expect(await buffer(opened.stream)).toEqual(Buffer.from("halfdone"));
  });

  it("recovers what a stopped replica left mid-receive once its lease or reservation lapsed", async () => {
    await using replicas = await sharedStorage();
    const first = await replicas.start();
    const { userId, spaceId } = await register(first, "stopped-replica");
    const actor = interactivePrincipal(userId);
    const lapsed = Date.now() - 61_000;

    const upload = await first.blobs.createUpload(actor, "stopped-blob-upload-0001", {
      spaceId, parentNodeId: null, name: "upload.bin", originalFilename: "upload.bin", byteSize: 4,
    });
    await replicas.pool.query("UPDATE blob_upload_sessions SET state = 'verifying', updated_at = $1 WHERE id = $2",
      [lapsed, upload.body.upload.id]);

    const { resourceId } = await publishedBlob(first, userId, spaceId, "stopped-blob-original-0001");
    const replacementObject = randomUUID();
    await replicas.pool.query(
      `INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
       VALUES ('stopped-blob-replace-0001', 'replace_blob_content', $1, 'receiving', 'pending', $2, 0, $3, $3, $3)`,
      [userId, JSON.stringify({ resourceId, expectedEtag: "old", byteSize: 3, objectKey: replacementObject }), lapsed]);
    await replicas.store.put({ objectKey: replacementObject, body: Readable.from([Buffer.from("par")]), expectedByteSize: 3 });

    const created = await first.resources.create(userId, "stopped-asset-slide-0001", {
      kind: "univer", spaceId, parentNodeId: null, name: "Slides", unitType: "slide",
    });
    const slide = (await first.resources.open(userId, created.body.node.resource!.id)).resource;
    if (slide.kind !== "univer") throw new Error("Created Resource is not a Univer Unit");
    const [receivingObject, storedObject, storedAsset] = [randomUUID(), randomUUID(), randomUUID()];
    const png = Buffer.from("png!");
    for (const objectKey of [receivingObject, storedObject]) {
      await replicas.store.put({ objectKey, body: Readable.from([png]), expectedByteSize: png.byteLength, detectMediaType: false });
    }
    await replicas.pool.query(
      `INSERT INTO univer_asset_uploads (id, asset_id, unit_id, object_key, actor_user_id, original_filename,
         declared_media_type, expected_size, received_size, sha256, etag, state, created_at, updated_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'receiving.png', 'image/png', 4, NULL, NULL, NULL, 'receiving', $6, $6, $6),
              ($7, $8, $3, $9, $5, 'stored.png', 'image/png', 4, 4, $10, 'etag', 'stored', $6, $6, $6)`,
      [randomUUID(), randomUUID(), slide.unitId, receivingObject, userId, lapsed,
        randomUUID(), storedAsset, storedObject, "a".repeat(64)]);

    const second = await replicas.start();

    expect(await second.blobs.getUpload(userId, upload.body.upload.id)).toMatchObject({ upload: { state: "waitingForUpload" } });
    await second.blobs.upload(userId, upload.body.upload.id, "4", Readable.from([Buffer.from("data")]));
    expect((await second.blobs.complete(actor, upload.body.upload.id)).status).toBe(201);
    expect(await second.operations.get(userId, "stopped-blob-replace-0001")).toMatchObject({
      state: "failed", error: { code: "REPLACEMENT_INTERRUPTED" },
    });
    expect(await replicas.store.head(replacementObject)).toBeNull();
    const kept = await second.blobs.openContent(userId, resourceId, undefined);
    expect(await buffer(kept.stream)).toEqual(Buffer.from("old"));
    const published = await second.univerAssets.openContent(userId, { kind: "trunk" }, storedAsset, undefined);
    expect(await buffer(published.stream)).toEqual(png);
    expect(await replicas.store.head(receivingObject)).toBeNull();
    expect((await replicas.pool.query("SELECT 1 FROM univer_asset_uploads")).rowCount).toBe(0);
  });

  it("deletes the late bytes of a replacement that maintenance failed while they still streamed", async () => {
    await using replicas = await sharedStorage();
    const first = await replicas.start();
    const { userId, spaceId } = await register(first, "late-replace");
    const actor = interactivePrincipal(userId);
    const { resourceId, etag } = await publishedBlob(first, userId, spaceId, "late-blob-original-0001");
    const body = new PassThrough();
    const operationId = "late-blob-replace-0001";
    const replacing = first.blobs.replace(actor, resourceId, operationId, etag, "8", body);
    body.write(Buffer.from("new-"));
    await until(() => first.operations.get(userId, operationId).then((operation) => operation.state === "pending", () => false));
    const { rows: [operation] } = await replicas.pool.query(
      "UPDATE operations SET updated_at = $1 WHERE id = $2 RETURNING payload_json", [Date.now() - 61_000, operationId]);
    const objectKey = JSON.parse(operation.payload_json).objectKey;

    const second = await replicas.start();
    body.end(Buffer.from("page"));

    await expect(replacing).rejects.toMatchObject({ code: "CONFLICT" });
    await replicas.maintain(second);
    expect(await replicas.store.head(objectKey)).toBeNull();
    const kept = await second.blobs.openContent(userId, resourceId, undefined);
    expect(await buffer(kept.stream)).toEqual(Buffer.from("old"));
  });
});

/** Starts replicas the way `main.ts` does, each with its own connections, against one database and one bucket. */
async function sharedStorage() {
  const resources = new AsyncDisposableStack();
  try {
    const database = await createPostgresTestDatabase(url!);
    resources.defer(database.close);
    const config: WorkspaceConfig = {
      ...loadConfig({}),
      s3BlobStore: await createTestBucket(resources),
      database: { provider: "postgres", connectionString: database.connectionString },
    };
    const pool = new Pool({ connectionString: database.connectionString });
    resources.defer(() => pool.end());
    const maintain = async (application: WorkspaceApplication) => {
      await startBlobMaintenance(application.blobs, {
        drafts: application.htmlViewDrafts,
        skillDrafts: application.skillDrafts,
        univerAssets: application.univerAssets,
        onError(error) { throw error; },
      }).dispose();
    };
    const store = createBlobStore(config);
    resources.defer(() => store.dispose?.());
    return {
      pool,
      store,
      maintain,
      async start() {
        const product = await openProductDatabase(config.database);
        resources.defer(() => product.close());
        const collaboration = await openCollaborationDatabase(config, product.unitCreationFacts);
        resources.defer(() => collaboration.close());
        const application = createWorkspaceApplication(config, product.repositories, collaboration, { unitStore });
        resources.defer(() => application.close());
        await application.initialize();
        await maintain(application);
        return application;
      },
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}

async function register(application: WorkspaceApplication, username: string) {
  const issued = await application.identity.registerWithPassword({
    username, displayName: username, password: "correct horse battery staple",
  });
  const userId = issued.view.user.id;
  const space = (await application.spaces.list(userId)).spaces[0];
  if (!space) throw new Error("Personal space is missing");
  return { userId, spaceId: space.id };
}

async function publishedBlob(application: WorkspaceApplication, userId: string, spaceId: string, key: string) {
  const actor = interactivePrincipal(userId);
  const reserved = await application.blobs.createUpload(actor, key, {
    spaceId, parentNodeId: null, name: `${key}.bin`, originalFilename: `${key}.bin`, byteSize: 3,
  });
  await application.blobs.upload(userId, reserved.body.upload.id, "3", Readable.from([Buffer.from("old")]));
  await application.blobs.complete(actor, reserved.body.upload.id);
  const opened = await application.blobs.openContent(userId, reserved.body.upload.resourceId, undefined);
  opened.stream.destroy();
  return { resourceId: reserved.body.upload.resourceId, etag: `"${opened.access.etag}"` };
}

async function until(check: () => Promise<boolean>): Promise<void> {
  for (const deadline = Date.now() + 5_000; Date.now() < deadline;) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not met within 5 seconds");
}
