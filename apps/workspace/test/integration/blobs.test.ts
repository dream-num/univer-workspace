import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import { BlobsRepository } from "../../server/src/modules/blobs/blobs.repository.js";
import { ApplicationError } from "../../server/src/middleware/errors.js";

const applications: WorkspaceApplication[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Blob Resources", () => {
  it("publishes only after verified upload and exposes generic Resource views", async () => {
    const { application } = createTestApplication();
    const userId = await register(application, "blob-owner");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const intent = {
      spaceId: space.id,
      parentNodeId: null,
      name: "notes.txt",
      originalFilename: "client-name.pdf",
      byteSize: 11,
      declaredMediaType: "application/pdf",
    };

    const reserved = application.blobs.createUpload(
      userId,
      "blob-upload-idempotency-0001",
      intent
    );
    expect(reserved).toMatchObject({
      status: 201,
      body: {
        operation: { kind: "createBlobResource", state: "pending" },
        upload: { state: "waitingForUpload", byteSize: 11 },
        uploadTarget: { method: "PUT" },
      },
    });
    const replay = application.blobs.createUpload(
      userId,
      "blob-upload-idempotency-0001",
      intent
    );
    expect(replay.status).toBe(200);
    expect(replay.body.upload.id).toBe(reserved.body.upload.id);
    expect(replay.body.upload.nodeId).toBe(reserved.body.upload.nodeId);
    expect(replay.body.upload.resourceId).toBe(reserved.body.upload.resourceId);
    expect(count(application, "nodes")).toBe(0);
    expect(count(application, "resources")).toBe(0);

    await application.blobs.upload(
      userId,
      reserved.body.upload.id,
      "11",
      Readable.from([Buffer.from("hello world")])
    );
    expect(application.blobs.getUpload(userId, reserved.body.upload.id)).toMatchObject({
      upload: {
        state: "uploaded",
        receivedSize: 11,
        detectedMediaType: "text/plain; charset=utf-8",
      },
    });
    expect(count(application, "nodes")).toBe(0);

    const completed = await application.blobs.complete(
      userId,
      reserved.body.upload.id
    );
    expect(completed).toMatchObject({
      status: 201,
      body: {
        operation: { state: "completed" },
        node: {
          id: reserved.body.upload.nodeId,
          name: "notes.txt",
          resource: {
            id: reserved.body.upload.resourceId,
            kind: "blob",
            mediaType: "text/plain; charset=utf-8",
            byteSize: 11,
            availability: "ready",
            capabilities: {
              openContent: true,
              editContent: true,
              downloadContent: true,
            },
          },
        },
      },
    });
    expect((await application.blobs.complete(userId, reserved.body.upload.id)).status).toBe(200);
    expect(count(application, "resources")).toBe(1);
    expect(count(application, "univer_resources")).toBe(0);
    expect(count(application, "blob_resources")).toBe(1);

    expect(application.resources.get(userId, reserved.body.upload.resourceId)).toMatchObject({
      resource: { kind: "blob", mediaType: "text/plain; charset=utf-8" },
      node: { id: reserved.body.upload.nodeId },
    });
    expect(application.resources.open(userId, reserved.body.upload.resourceId)).toMatchObject({
      resource: {
        kind: "blob",
        originalFilename: "client-name.pdf",
        contentUrl: `/api/blob-resources/${reserved.body.upload.resourceId}/content`,
        downloadUrl: `/api/blob-resources/${reserved.body.upload.resourceId}/download`,
      },
    });
    expect(application.nodes.listSpaceRoot(userId, space.id, {})).toMatchObject({
      nodes: [{ resource: { kind: "blob" } }],
    });

    const viewerId = await register(application, "blob-viewer");
    await expect(
      application.blobs.openContent(
        viewerId,
        reserved.body.upload.resourceId,
        undefined
      )
    ).rejects.toMatchObject<ApplicationError>({ code: "NOT_FOUND" });
    application.permissions.upsertNodeGrant(
      userId,
      reserved.body.upload.nodeId,
      viewerId,
      { role: "viewer" }
    );
    expect(
      application.resources.open(viewerId, reserved.body.upload.resourceId)
    ).toMatchObject({ resource: { kind: "blob", accessRole: "viewer" } });
    const viewerContent = await application.blobs.openContent(
      viewerId,
      reserved.body.upload.resourceId,
      undefined
    );
    expect((await readAll(viewerContent.stream)).toString()).toBe("hello world");

    const full = await application.blobs.openContent(
      userId,
      reserved.body.upload.resourceId,
      undefined
    );
    expect((await readAll(full.stream)).toString()).toBe("hello world");
    const partial = await application.blobs.openContent(
      userId,
      reserved.body.upload.resourceId,
      "bytes=6-10"
    );
    expect(partial).toMatchObject({
      partial: true,
      start: 6,
      end: 10,
      totalByteSize: 11,
    });
    expect((await readAll(partial.stream)).toString()).toBe("world");
    await expect(
      application.blobs.openContent(
        userId,
        reserved.body.upload.resourceId,
        "bytes=100-200"
      )
    ).rejects.toMatchObject<ApplicationError>({
      code: "RANGE_NOT_SATISFIABLE",
      status: 416,
    });
    application.database.connection
      .prepare("DELETE FROM recent_resources WHERE resource_id = ?")
      .run(reserved.body.upload.resourceId);
    application.database.connection
      .prepare("UPDATE blob_resources SET availability = 'quarantined' WHERE resource_id = ?")
      .run(reserved.body.upload.resourceId);
    expect(() =>
      application.resources.open(userId, reserved.body.upload.resourceId)
    ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(count(application, "recent_resources")).toBe(0);
    await expect(
      application.blobs.openContent(
        userId,
        reserved.body.upload.resourceId,
        undefined
      )
    ).rejects.toMatchObject<ApplicationError>({ code: "NOT_FOUND" });
  });

  it("rejects conflicting intents and permits a clean retry after a short body", async () => {
    const { application } = createTestApplication();
    const userId = await register(application, "blob-retry");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const result = application.blobs.createUpload(
      userId,
      "blob-upload-idempotency-0002",
      {
        spaceId: space.id,
        parentNodeId: null,
        name: "archive.zip",
        originalFilename: "archive.zip",
        byteSize: 4,
        declaredMediaType: "application/octet-stream",
      }
    );

    expect(() =>
      application.blobs.createUpload(userId, "blob-upload-idempotency-0002", {
        spaceId: space.id,
        parentNodeId: null,
        name: "other.zip",
        originalFilename: "archive.zip",
        byteSize: 4,
        declaredMediaType: "application/octet-stream",
      })
    ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(() =>
      application.blobs.createUpload(userId, "blob-upload-too-large-0001", {
        spaceId: space.id,
        parentNodeId: null,
        name: "too-large.bin",
        originalFilename: "too-large.bin",
        byteSize: 1025,
        declaredMediaType: "application/octet-stream",
      })
    ).toThrowError(
      expect.objectContaining({ code: "PAYLOAD_TOO_LARGE", status: 413 })
    );

    await expect(
      application.blobs.upload(
        userId,
        result.body.upload.id,
        "4",
        Readable.from([Buffer.from("abc")])
      )
    ).rejects.toMatchObject<ApplicationError>({ code: "CONFLICT" });
    expect(application.blobs.getUpload(userId, result.body.upload.id).upload.state).toBe(
      "waitingForUpload"
    );
    await application.blobs.upload(
      userId,
      result.body.upload.id,
      "4",
      Readable.from([Buffer.from("PK12")])
    );
    expect(application.blobs.getUpload(userId, result.body.upload.id)).toMatchObject({
      upload: { state: "uploaded", detectedMediaType: "application/zip" },
    });
  });

  it("supports publishing and reading an empty Blob", async () => {
    const { application } = createTestApplication();
    const userId = await register(application, "blob-empty");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const reserved = application.blobs.createUpload(
      userId,
      "blob-upload-empty-0001",
      {
        spaceId: space.id,
        parentNodeId: null,
        name: "empty.txt",
        originalFilename: "empty.txt",
        byteSize: 0,
        declaredMediaType: "text/plain",
      }
    );
    await application.blobs.upload(
      userId,
      reserved.body.upload.id,
      "0",
      Readable.from([])
    );
    await application.blobs.complete(userId, reserved.body.upload.id);
    const opened = await application.blobs.openContent(
      userId,
      reserved.body.upload.resourceId,
      undefined
    );
    expect(opened).toMatchObject({ totalByteSize: 0, start: 0, end: 0 });
    expect(await readAll(opened.stream)).toEqual(Buffer.alloc(0));
  });

  it("recovers an interrupted upload on application restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "workspace-blob-restart-"));
    directories.push(directory);
    const blobDirectory = join(directory, "objects");
    const config = {
      host: "127.0.0.1",
      port: 0,
      databaseFilename: join(directory, "product.sqlite"),
      collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
      blobDirectory,
      maxBlobBytes: 1024,
      secureCookies: false,
      sessionTtlMs: 60_000,
    } as const;
    const dependencies = {
      unitStore: {
        async createUnit(input: { readonly unitId: string }) {
          return { unitId: input.unitId, headRevision: 1 };
        },
      },
    };
    const first = createWorkspaceApplication(config, dependencies);
    applications.push(first);
    const userId = await register(first, "blob-restart");
    const space = first.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const reserved = first.blobs.createUpload(
      userId,
      "blob-upload-restart-0001",
      {
        spaceId: space.id,
        parentNodeId: null,
        name: "restart.bin",
        originalFilename: "restart.bin",
        byteSize: 4,
        declaredMediaType: "application/octet-stream",
      }
    );
    const objectKey = (
      first.database.connection
        .prepare("SELECT object_key FROM blob_upload_sessions WHERE id = ?")
        .get(reserved.body.upload.id) as { readonly object_key: string }
    ).object_key;
    first.database.connection
      .prepare("UPDATE blob_upload_sessions SET state = 'verifying' WHERE id = ?")
      .run(reserved.body.upload.id);
    mkdirSync(blobDirectory, { recursive: true });
    writeFileSync(join(blobDirectory, `${objectKey}.upload`), "stale");
    await first.close();

    const restarted = createWorkspaceApplication(config, dependencies);
    applications.push(restarted);
    expect(restarted.blobs.getUpload(userId, reserved.body.upload.id)).toMatchObject({
      upload: { state: "waitingForUpload" },
    });
    await restarted.blobs.upload(
      userId,
      reserved.body.upload.id,
      "4",
      Readable.from([Buffer.from([4, 3, 2, 1])])
    );
    expect(existsSync(join(blobDirectory, `${objectKey}.upload`))).toBe(false);
    expect(existsSync(join(blobDirectory, objectKey))).toBe(true);
  });

  it("cleans aborted, expired, and permanently deleted objects through the outbox", async () => {
    const { application, blobDirectory } = createTestApplication();
    const userId = await register(application, "blob-cleanup");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");

    const aborted = await uploadedBlob(application, userId, space.id, "abort.bin", "blob-cleanup-abort-0001");
    expect(readdirSync(blobDirectory)).toHaveLength(1);
    application.blobs.abort(userId, aborted.uploadId);
    expect(count(application, "object_deletion_jobs")).toBe(1);
    await application.blobs.runMaintenance("cleanup-worker");
    expect(readdirSync(blobDirectory)).toHaveLength(0);
    expect(count(application, "object_deletion_jobs")).toBe(0);

    const expired = await uploadedBlob(application, userId, space.id, "expire.bin", "blob-cleanup-expire-0001");
    application.database.connection
      .prepare("UPDATE blob_upload_sessions SET expires_at = 0 WHERE id = ?")
      .run(expired.uploadId);
    await application.blobs.runMaintenance("cleanup-worker");
    expect(application.blobs.getUpload(userId, expired.uploadId).upload.state).toBe("expired");
    expect(readdirSync(blobDirectory)).toHaveLength(0);

    const published = await uploadedBlob(application, userId, space.id, "delete.bin", "blob-cleanup-delete-0001");
    await application.blobs.complete(userId, published.uploadId);
    const objectKey = (
      application.database.connection
        .prepare("SELECT object_key FROM blob_resources WHERE resource_id = ?")
        .get(published.resourceId) as { readonly object_key: string }
    ).object_key;
    const objectFilename = join(blobDirectory, objectKey);
    expect(existsSync(objectFilename)).toBe(true);
    const batch = application.trash.trashNode(userId, published.nodeId);
    application.trash.removePermanently(userId, batch.id);
    expect(existsSync(objectFilename)).toBe(true);
    expect(count(application, "object_deletion_jobs")).toBe(1);
    await application.blobs.runMaintenance("cleanup-worker");
    expect(existsSync(objectFilename)).toBe(false);
    expect(count(application, "object_deletion_jobs")).toBe(0);
  });
});

describe("Blob content replacement", () => {
  it("replaces bytes with stable identity, fresh ETags, idempotent replay and stale-write protection", async () => {
    const { application, blobDirectory } = createTestApplication();
    const user = await register(application, "replace-owner");
    const space = application.spaces.list(user).spaces[0]!;
    const blob = await uploadedBlob(
      application,
      user,
      space.id,
      "original.bin",
      "replacement-create-0001",
    );
    await application.blobs.complete(user, blob.uploadId);
    const etag = await contentEtag(application, user, blob.resourceId);
    const originalNode = application.nodes.get(user, blob.nodeId);
    const first = await application.blobs.replace(
      user,
      blob.resourceId,
      "replacement-request-0001",
      etag,
      "4",
      Readable.from(["text"]),
    );
    expect(first.etag).not.toBe(etag);
    expect(application.resources.open(user, blob.resourceId).resource).toMatchObject({
      name: "original.bin",
      originalFilename: "original.bin",
      byteSize: 4,
    });
    expect(application.nodes.get(user, blob.nodeId)).toMatchObject({
      node: { id: blob.nodeId, name: "original.bin", parentNodeId: originalNode.node.parentNodeId },
    });
    expect(count(application, "resources")).toBe(1);
    expect(count(application, "blob_upload_sessions")).toBe(1);
    const bytes = await application.blobs.openContent(user, blob.resourceId, undefined);
    expect((await readAll(bytes.stream)).toString()).toBe("text");
    expect(
      await application.blobs.replace(
        user,
        blob.resourceId,
        "replacement-request-0001",
        etag,
        "4",
        Readable.from(["text"]),
      ),
    ).toEqual(first);
    await expect(
      application.blobs.replace(
        user,
        blob.resourceId,
        "replacement-request-0002",
        etag,
        "4",
        Readable.from(["lost"]),
      ),
    ).rejects.toMatchObject({ status: 412 });
    const second = await application.blobs.replace(
      user,
      blob.resourceId,
      "replacement-request-0003",
      first.etag,
      "4",
      Readable.from(["text"]),
    );
    expect(second.etag).not.toBe(first.etag);
    await expect(
      application.blobs.replace(
        user,
        blob.resourceId,
        "replacement-request-0004",
        first.etag,
        "4",
        Readable.from(["lost"]),
      ),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      application.blobs.replace(
        user,
        blob.resourceId,
        "replacement-request-0003",
        first.etag,
        "3",
        Readable.from(["bad"]),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(application.operations.get(user, first.operationId)).toMatchObject({
      kind: "replaceBlobContent",
      state: "completed",
      result: first,
    });
    await application.blobs.runMaintenance("replace-cleanup");
    expect(readdirSync(blobDirectory)).toHaveLength(1);
  });

  it("keeps old bytes after failed uploads, competing writes, or trashing during upload", async () => {
    const { application } = createTestApplication();
    const user = await register(application, "replace-race");
    const space = application.spaces.list(user).spaces[0]!;
    const blob = await uploadedBlob(
      application,
      user,
      space.id,
      "race.bin",
      "replace-race-create-0001",
    );
    await application.blobs.complete(user, blob.uploadId);
    const etag = await contentEtag(application, user, blob.resourceId);
    const replace = (key: string, body: Readable) =>
      application.blobs.replace(user, blob.resourceId, key, etag, "4", body);
    await expect(replace("replace-short-body-0001", Readable.from(["x"]))).rejects.toThrow();
    expect(application.operations.get(user, "replace-short-body-0001").state).toBe("failed");
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = replace(
      "replace-slow-body-0001",
      Readable.from(
        (async function* () {
          started();
          await gate;
          yield Buffer.from("slow");
        })(),
      ),
    );
    await waiting;
    const fast = await replace("replace-fast-body-0001", Readable.from(["fast"]));
    release();
    await expect(slow).rejects.toMatchObject({ status: 412 });
    expect(await contentEtag(application, user, blob.resourceId)).toBe(fast.etag);
    const outsider = await register(application, "replace-outsider");
    await expect(
      application.blobs.replace(
        outsider,
        blob.resourceId,
        "replace-denied-body-0001",
        fast.etag,
        "4",
        Readable.from(["nope"]),
      ),
    ).rejects.toMatchObject({ status: 404 });
    application.permissions.upsertNodeGrant(user, blob.nodeId, outsider, { role: "viewer" });
    await expect(
      application.blobs.replace(
        outsider,
        blob.resourceId,
        "replace-viewer-body-0001",
        fast.etag,
        "4",
        Readable.from(["nope"]),
      ),
    ).rejects.toMatchObject({ status: 403 });
    let unpause!: () => void;
    let startedTrash!: () => void;
    const entered = new Promise<void>((resolve) => {
      startedTrash = resolve;
    });
    const pause = new Promise<void>((resolve) => {
      unpause = resolve;
    });
    const trashed = application.blobs.replace(
      user,
      blob.resourceId,
      "replace-trash-body-0001",
      fast.etag,
      "4",
      Readable.from(
        (async function* () {
          startedTrash();
          await pause;
          yield Buffer.from("gone");
        })(),
      ),
    );
    await entered;
    application.trash.trashNode(user, blob.nodeId);
    unpause();
    await expect(trashed).rejects.toMatchObject({ status: 404 });
    expect(
      application.database.connection
        .prepare("SELECT etag FROM blob_resources WHERE resource_id = ?")
        .get(blob.resourceId),
    ).toMatchObject({ etag: fast.etag.slice(1, -1) });
  });

  it("keeps published bytes when editor permission is revoked during upload", async () => {
    const { application } = createTestApplication();
    const owner = await register(application, "replace-revoke-owner");
    const editor = await register(application, "replace-revoke-editor");
    const space = application.spaces.list(owner).spaces[0]!;
    const blob = await uploadedBlob(
      application,
      owner,
      space.id,
      "original.bin",
      "replace-revoke-create-0001",
    );
    await application.blobs.complete(owner, blob.uploadId);
    application.permissions.upsertNodeGrant(owner, blob.nodeId, editor, { role: "editor" });
    const etag = await contentEtag(application, editor, blob.resourceId);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const operationId = "replace-revoke-request-0001";
    const pending = application.blobs.replace(
      editor,
      blob.resourceId,
      operationId,
      etag,
      "4",
      Readable.from(
        (async function* () {
          started();
          await gate;
          yield Buffer.from("lost");
        })(),
      ),
    );
    await entered;
    application.permissions.upsertNodeGrant(owner, blob.nodeId, editor, { role: "viewer" });
    release();
    await expect(pending).rejects.toMatchObject({ status: 403 });
    expect(await contentEtag(application, owner, blob.resourceId)).toBe(etag);
    expect(application.operations.get(editor, operationId)).toMatchObject({
      state: "failed",
      error: { code: "FORBIDDEN" },
    });
  });

  it("fails interrupted replacements once on restart and cleans only unpublished objects", async () => {
    const { application, blobDirectory } = createTestApplication();
    const user = await register(application, "replace-recovery");
    const space = application.spaces.list(user).spaces[0]!;
    const blob = await uploadedBlob(
      application,
      user,
      space.id,
      "old.bin",
      "replace-recovery-create-0001",
    );
    await application.blobs.complete(user, blob.uploadId);
    const repository = new BlobsRepository(application.database);
    const operationId = "replace-interrupted-0001";
    const pending = repository.reserveReplacement(
      operationId,
      user,
      { resourceId: blob.resourceId, expectedEtag: "old", byteSize: 4 },
      Date.now(),
    );
    writeFileSync(join(blobDirectory, pending.objectKey), "lost");
    await application.close();
    const restarted = createTestApplication(join(blobDirectory, "..")).application;
    expect(restarted.operations.get(user, operationId)).toMatchObject({
      state: "failed",
      error: { code: "REPLACEMENT_INTERRUPTED" },
    });
    await restarted.blobs.runMaintenance("recovery");
    expect(readdirSync(blobDirectory)).toHaveLength(1);
    const content = await restarted.blobs.openContent(user, blob.resourceId, undefined);
    expect(await readAll(content.stream)).toEqual(Buffer.from([0, 1, 2, 3]));
    await restarted.close();
    const again = createTestApplication(join(blobDirectory, "..")).application;
    expect(count(again, "object_deletion_jobs")).toBe(0);
  });
});

function createTestApplication(existingDirectory?: string): {
  readonly application: WorkspaceApplication;
  readonly blobDirectory: string;
} {
  const directory = existingDirectory ?? mkdtempSync(join(tmpdir(), "workspace-blobs-"));
  directories.push(directory);
  const blobDirectory = join(directory, "objects");
  const application = createWorkspaceApplication(
    {
      host: "127.0.0.1",
      port: 0,
      databaseFilename: join(directory, "product.sqlite"),
      collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
      blobDirectory,
      maxBlobBytes: 1024,
      secureCookies: false,
      sessionTtlMs: 60_000,
    },
    {
      unitStore: {
        async createUnit(input) {
          return { unitId: input.unitId, headRevision: 1 };
        },
      },
    }
  );
  applications.push(application);
  return { application, blobDirectory };
}

async function register(application: WorkspaceApplication, username: string): Promise<string> {
  const issued = await application.identity.registerWithPassword({
    username,
    displayName: username,
    password: "correct horse battery staple",
  });
  return issued.view.user.id;
}

async function uploadedBlob(
  application: WorkspaceApplication,
  userId: string,
  spaceId: string,
  name: string,
  idempotencyKey: string
): Promise<{ readonly uploadId: string; readonly nodeId: string; readonly resourceId: string }> {
  const content = Buffer.from([0, 1, 2, 3]);
  const reserved = application.blobs.createUpload(userId, idempotencyKey, {
    spaceId,
    parentNodeId: null,
    name,
    originalFilename: name,
    byteSize: content.byteLength,
    declaredMediaType: "application/octet-stream",
  });
  await application.blobs.upload(
    userId,
    reserved.body.upload.id,
    String(content.byteLength),
    Readable.from([content])
  );
  return {
    uploadId: reserved.body.upload.id,
    nodeId: reserved.body.upload.nodeId,
    resourceId: reserved.body.upload.resourceId,
  };
}

function count(application: WorkspaceApplication, table: string): number {
  return (
    application.database.connection
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { readonly count: number }
  ).count;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function contentEtag(
  application: WorkspaceApplication,
  userId: string,
  resourceId: string,
): Promise<string> {
  const content = await application.blobs.openContent(userId, resourceId, undefined);
  await readAll(content.stream);
  return `"${content.access.etag}"`;
}
