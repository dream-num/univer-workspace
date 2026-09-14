import { Readable } from "node:stream";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(applications.splice(0).map((application) => application.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Blob Resource HTTP API", () => {
  it("uploads, publishes, ranges, caches, and downloads authenticated bytes", async () => {
    const { cookie, space, origin } = await createHttpContext();
    const content = Buffer.from("hello blob");

    const reserve = await fetch(`${origin}/api/blob-upload-sessions`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "idempotency-key": "http-blob-idempotency-0001",
      },
      body: JSON.stringify({
        spaceId: space.id,
        parentNodeId: null,
        name: "你好.txt",
        originalFilename: "你好.txt",
        byteSize: content.byteLength,
        declaredMediaType: "video/mp4",
      }),
    });
    expect(reserve.status).toBe(201);
    const reservation = (await reserve.json()) as {
      readonly upload: { readonly id: string; readonly resourceId: string };
      readonly uploadTarget: { readonly contentUrl: string };
    };
    const replay = await fetch(`${origin}/api/blob-upload-sessions`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "idempotency-key": "http-blob-idempotency-0001",
      },
      body: JSON.stringify({
        spaceId: space.id,
        parentNodeId: null,
        name: "你好.txt",
        originalFilename: "你好.txt",
        byteSize: content.byteLength,
        declaredMediaType: "video/mp4",
      }),
    });
    expect(replay.status).toBe(200);

    const upload = await fetch(`${origin}${reservation.uploadTarget.contentUrl}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/octet-stream" },
      body: content,
    });
    expect(upload.status).toBe(204);
    const uploadState = await fetch(`${origin}/api/blob-upload-sessions/${reservation.upload.id}`, {
      headers: { cookie },
    });
    expect(await uploadState.json()).toMatchObject({
      upload: {
        state: "uploaded",
        detectedMediaType: "text/plain; charset=utf-8",
      },
    });
    const complete = await fetch(
      `${origin}/api/blob-upload-sessions/${reservation.upload.id}/complete`,
      { method: "POST", headers: { cookie } },
    );
    expect(complete.status).toBe(201);
    expect(await complete.json()).toMatchObject({
      node: { resource: { kind: "blob", mediaType: "text/plain; charset=utf-8" } },
    });

    const contentUrl = `${origin}/api/blob-resources/${reservation.upload.resourceId}/content`;
    const full = await fetch(contentUrl, { headers: { cookie } });
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(full.headers.get("content-disposition")).toContain("inline");
    expect(full.headers.get("content-disposition")).toContain("%E4%BD%A0%E5%A5%BD.txt");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    const etag = full.headers.get("etag");
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(Buffer.from(await full.arrayBuffer())).toEqual(content);

    const partial = await fetch(contentUrl, {
      headers: { cookie, range: "bytes=6-9" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 6-9/10");
    expect(await partial.text()).toBe("blob");
    const cached = await fetch(contentUrl, {
      headers: { cookie, "if-none-match": etag! },
    });
    expect(cached.status).toBe(304);
    const download = await fetch(
      `${origin}/api/blob-resources/${reservation.upload.resourceId}/download`,
      { headers: { cookie } },
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await download.arrayBuffer())).toEqual(content);

    expect((await fetch(contentUrl)).status).toBe(401);
    expect(
      (
        await fetch(contentUrl, {
          headers: { cookie, range: "bytes=40-50" },
        })
      ).status,
    ).toBe(416);
  });
});

describe("Blob replacement HTTP API", () => {
  it("publishes new bytes and a fresh ETag, then rejects the stale validator", async () => {
    const { cookie, contentUrl, etag } = await publishedBlob();
    const replacement = await fetch(contentUrl, {
      method: "PUT",
      headers: { cookie, "if-match": etag, "idempotency-key": "http-replace-idempotency-0001" },
      body: "changed",
    });
    expect(replacement.status).toBe(200);
    const replaced = (await replacement.json()) as { etag: string };
    expect(replaced.etag).not.toBe(etag);
    expect(replacement.headers.get("etag")).toBe(replaced.etag);
    const stale = await fetch(contentUrl, {
      method: "PUT",
      headers: { cookie, "if-match": etag, "idempotency-key": "http-replace-idempotency-0002" },
      body: "lost",
    });
    expect(stale.status).toBe(412);
    const after = await fetch(contentUrl, { headers: { cookie, "if-none-match": etag } });
    expect(after.status).toBe(200);
    expect(await after.text()).toBe("changed");
  });

  it.each([undefined, "*", 'W/"weak"'])(
    "rejects invalid If-Match %s without changing bytes",
    async (validator) => {
      const { cookie, contentUrl } = await publishedBlob();
      const response = await fetch(contentUrl, {
        method: "PUT",
        headers: {
          cookie,
          "idempotency-key": "http-replace-invalid-0001",
          ...(validator === undefined ? {} : { "if-match": validator }),
        },
        body: "lost",
      });
      expect(response.status).toBe(400);
      const after = await fetch(contentUrl, { headers: { cookie } });
      expect(await after.text()).toBe("hello blob");
    },
  );
});

async function publishedBlob() {
  const { application, cookie, space, origin, userId } = await createHttpContext();
  const content = Buffer.from("hello blob");
  const { body } = application.blobs.createUpload(userId, "http-replace-setup-0001", {
    spaceId: space.id,
    parentNodeId: null,
    name: "file.txt",
    originalFilename: "file.txt",
    byteSize: content.length,
  });
  await application.blobs.upload(
    userId,
    body.upload.id,
    String(content.length),
    Readable.from([content]),
  );
  await application.blobs.complete(userId, body.upload.id);
  const contentUrl = `${origin}/api/blob-resources/${body.upload.resourceId}/content`;
  const response = await fetch(contentUrl, { headers: { cookie } });
  const etag = response.headers.get("etag")!;
  await response.arrayBuffer();
  return { cookie, contentUrl, etag };
}

async function createHttpContext() {
  const directory = mkdtempSync(join(tmpdir(), "workspace-http-blob-"));
  directories.push(directory);
  const application = createWorkspaceApplication(
    {
      host: "127.0.0.1",
      port: 0,
      databaseFilename: join(directory, "product.sqlite"),
      collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
      blobDirectory: join(directory, "objects"),
      secureCookies: false,
      sessionTtlMs: 60_000,
    },
    {
      unitStore: {
        async createUnit(input) {
          return { unitId: input.unitId, headRevision: 1 };
        },
      },
    },
  );
  applications.push(application);
  const issued = await application.identity.registerWithPassword({
    username: "http-blob",
    displayName: "HTTP Blob",
    password: "correct horse battery staple",
  });
  const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
  const space = application.spaces.list(issued.view.user.id).spaces[0];
  if (!space) throw new Error("Personal space is missing");
  const server = createServer(application.app);
  servers.push(server);
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address is missing");
  const origin = `http://127.0.0.1:${address.port}`;
  return { application, cookie, space, origin, userId: issued.view.user.id };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
