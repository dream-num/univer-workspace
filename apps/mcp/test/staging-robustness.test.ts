import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { connect } from "node:net";
import { request } from "node:http";
import { chmod, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pino } from "pino";
import { afterEach, expect, it, vi } from "vitest";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { defaultLimits } from "../src/gateway/staging/model.js";
import { createGateway } from "../src/gateway/server.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { testStagingDirectory } from "./staging-directory.js";

const stores: LocalStagingStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});
const input = {
  purpose: "blob",
  file_name: "data.bin",
  media_type: "application/octet-stream",
} as const;
function setup(
  options: ConstructorParameters<typeof LocalStagingStore>[2] = {},
  directory = testStagingDirectory(),
) {
  const store = new LocalStagingStore(directory, "http://mcp.test/mcp", options);
  stores.push(store);
  return { store, directory };
}
async function* bytes(size = 3) {
  yield Buffer.alloc(size, 255);
}
const put = (url: string, body: BodyInit, headers?: HeadersInit) =>
  new Request(url, {
    method: "PUT",
    body,
    ...(headers ? { headers } : {}),
    duplex: "half",
  } as RequestInit);

it.each([undefined, 5, 3, 0])(
  "treats size %s as an optional upper bound with chunked bytes",
  async (size) => {
    const { store } = setup();
    const { upload } = await store.createUpload("owner", {
      ...input,
      ...(size === undefined ? {} : { size }),
    });
    const body = size === 0 ? "" : "abc";
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(Buffer.from(body));
        c.close();
      },
    });
    expect((await store.handle(put(upload.upload_url, stream))).status).toBe(204);
    expect(await store.requireUpload("owner", upload.upload_id, "blob")).toMatchObject({
      size: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
    expect(upload.max_bytes).toBe(size ?? defaultLimits.blob);
  },
);

it("accepts Content-Length below the declared maximum and enforces limits on chunked streams", async () => {
  const { store, directory } = setup({ limits: { ...defaultLimits, blob: 4 } });
  const { upload } = await store.createUpload("owner", { ...input, size: 3 });
  expect((await store.handle(put(upload.upload_url, "abcd"))).status).toBe(413);
  expect(await readdir(directory)).toEqual([`${upload.upload_id}.json`]);
  expect((await store.handle(put(upload.upload_url, "ab", { "content-length": "2" }))).status).toBe(
    204,
  );
  const unlimited = await store.createUpload("owner", input);
  expect((await store.handle(put(unlimited.upload.upload_url, "abcde"))).status).toBe(413);
  const capped = await store.createUpload("owner", { ...input, size: 9 });
  expect(capped.upload.max_bytes).toBe(4);
  expect((await store.handle(put(capped.upload.upload_url, "abcd"))).status).toBe(204);
});

it("isolates corrupt, unreadable and vanished sidecars during startup and sweeps", async () => {
  const directory = testStagingDirectory();
  const bad = join(directory, `${randomUUID()}.json`);
  const unreadable = join(directory, `${randomUUID()}.json`);
  await writeFile(bad, '{"private":"file-content"}', { mode: 0o600 });
  await writeFile(unreadable, "{}", { mode: 0o600 });
  await chmod(unreadable, 0o640);
  const onError = vi.fn();
  let now = Date.now();
  const { store } = setup({ onError, now: () => now }, directory);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { upload } = await store.createUpload("owner", input);
  expect(onError).toHaveBeenCalledTimes(1);
  now += 61 * 60_000;
  await store.sweep();
  expect(onError).toHaveBeenCalledTimes(3);
  expect(onError).toHaveBeenCalledWith(expect.any(Error), bad.split("/").at(-1)?.slice(0, 36));
  expect(await readdir(directory)).not.toContain(`${upload.upload_id}.json`);
  // Deletion concurrent with a sweep must leave the remaining entries usable.
  await Promise.all([store.sweep(), unlink(unreadable)]);
  await expect(store.createUpload("owner", input)).resolves.toHaveProperty("upload");
});

it("protects a consume crossing expiry and tolerates an already removed lock on release", async () => {
  let now = Date.now();
  const { store, directory } = setup({ now: () => now });
  const { upload } = await store.createUpload("owner", input);
  await store.handle(put(upload.upload_url, "abc"));
  const result = await store.withUpload(
    "owner",
    upload.upload_id,
    "blob",
    async (_object, path) => {
      now += 61 * 60_000;
      await store.sweep();
      expect(await readFile(path, "utf8")).toBe("abc");
      await unlink(join(directory, `${upload.upload_id}.lock`));
      return "published";
    },
  );
  expect(result).toBe("published");
  await store.sweep();
  expect(await readdir(directory)).toEqual([]);
});

it.each(["Q3/report.pdf", "a\nb.txt", "c1\u0085.pdf", "x".repeat(256), "x\\y\u0000.pdf"])(
  "preserves legal node names and sanitizes attachment names (%s)",
  async (fileName) => {
    const { store } = setup();
    const download = await store.createDownload({
      owner: "owner",
      fileName,
      mediaType: "application/pdf",
      content: bytes(),
    });
    expect(download.file_name).toBe(fileName);
    const response = await store.handle(new Request(download.url));
    const name = decodeURIComponent(
      response.headers.get("content-disposition")!.split("UTF-8''")[1]!,
    );
    expect(name).not.toMatch(/[\\/\p{Cc}]/u);
    expect(Array.from(name).length).toBeLessThanOrEqual(180);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.alloc(3, 255));
  },
);

it("enforces pending-upload and combined byte quotas per user, including concurrent streams and restart", async () => {
  const { store, directory } = setup({ maxUserBytes: 5, maxPendingUploads: 1 });
  const { upload } = await store.createUpload("owner", input);
  await expect(store.createUpload("owner", input)).rejects.toMatchObject({
    code: "workspace-staging-quota-exceeded",
  });
  await store.handle(put(upload.upload_url, "abc"));
  await expect(
    store.createDownload({
      owner: "owner",
      fileName: "file",
      mediaType: "text/plain",
      content: bytes(),
    }),
  ).rejects.toMatchObject({ code: "workspace-staging-quota-exceeded" });
  const next = await store.createUpload("owner", input);
  expect((await store.handle(put(next.upload.upload_url, "abc"))).status).toBe(429);
  expect((await store.handle(put(next.upload.upload_url, "ab"))).status).toBe(204);
  await expect(
    store.createDownload({
      owner: "other",
      fileName: "file",
      mediaType: "text/plain",
      content: bytes(),
    }),
  ).resolves.toHaveProperty("url");
  const reopened = setup({ maxUserBytes: 5 }, directory).store;
  await expect(
    reopened.createDownload({
      owner: "owner",
      fileName: "file",
      mediaType: "text/plain",
      content: bytes(1),
    }),
  ).rejects.toMatchObject({ code: "workspace-staging-quota-exceeded" });
  const concurrent = setup({ maxUserBytes: 5 }).store;
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      concurrent.createDownload({
        owner: "owner",
        fileName: "file",
        mediaType: "text/plain",
        content: bytes(),
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});

it("hides pending downloads and retains the page's actionable 413 message", async () => {
  const { store, directory } = setup();
  const { upload } = await store.createUpload("owner", input);
  const path = join(directory, `${upload.upload_id}.json`);
  const metadata = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...metadata, kind: "download" }));
  expect(
    (await store.handle(new Request(upload.upload_url.replace("/uploads/", "/downloads/")))).status,
  ).toBe(404);
  await writeFile(path, JSON.stringify(metadata));
  expect(await (await store.handle(new Request(upload.page_url))).text()).toContain(
    "File is too large. Choose a smaller file.",
  );
});

it("streams invalid UTF-8 and files over 4 MiB byte-identically through the real gateway HTTP server", async () => {
  const directory = testStagingDirectory();
  let logs = "";
  const gateway = createGateway(
    parseGatewayConfig({
      WORKSPACE_ORIGIN: "https://workspace.test",
      MCP_PUBLIC_URL: "http://127.0.0.1/mcp",
      MCP_STAGING_DIRECTORY: directory,
      MCP_DEV_SESSION_PASSTHROUGH: "1",
    }),
    {
      logger: pino(
        { level: "trace" },
        new Writable({
          write(chunk, _e, done) {
            logs += String(chunk);
            done();
          },
        }),
      ),
    },
  );
  const store = new LocalStagingStore(directory, "http://127.0.0.1/mcp");
  stores.push(store);
  gateway.server.listen(0, "127.0.0.1");
  await once(gateway.server, "listening");
  const address = gateway.server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  const origin = `http://127.0.0.1:${address.port}`;
  const transfer = (url: string, body?: Buffer) =>
    new Promise<{ status: number | undefined; body: Buffer }>((resolve, reject) => {
      const req = request(
        origin,
        {
          path: url.replace("http://127.0.0.1", ""),
          method: body ? "PUT" : "GET",
          headers: { host: "127.0.0.1" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
        },
      );
      req.on("error", reject);
      if (body) {
        req.write(body.subarray(0, 2));
        req.end(body.subarray(2));
      } else req.end();
    });
  try {
    expect(gateway.server.requestTimeout).toBe(30 * 60_000);
    expect(gateway.server.headersTimeout).toBe(60_000);
    for (const body of [
      Buffer.from([0xff, 0xf0, 0x9f, 0x98, 0, 0xfe]),
      Buffer.alloc(5 * 1024 * 1024, 0xff),
    ]) {
      for (const prefix of ["/mcp/files/", "/mcp/./files/", "/mcp/%2e/files/"]) {
        const { upload } = await store.createUpload("owner", input);
        expect(
          (await transfer(upload.upload_url.replace("/mcp/files/", prefix), body)).status,
        ).toBe(204);
        const download = await store.withUpload(
          "owner",
          upload.upload_id,
          "blob",
          async (object, path) => {
            expect(object.sha256).toBe(createHash("sha256").update(body).digest("hex"));
            return store.createDownload({
              owner: "owner",
              fileName: object.fileName,
              mediaType: object.mediaType,
              content: (async function* () {
                yield await readFile(path);
              })(),
            });
          },
        );
        const fetched = await transfer(download.url);
        expect(fetched.status).toBe(200);
        expect(createHash("sha256").update(fetched.body).digest("hex")).toBe(
          createHash("sha256").update(body).digest("hex"),
        );
      }
    }
    for (const path of ["/mcp/files/../../mcp", "/mcp/files/%2e%2e/%2e%2e/mcp"]) {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: { pad: "x".repeat(5 * 1024 * 1024) },
      });
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          origin,
          {
            path,
            method: "POST",
            headers: {
              host: "127.0.0.1",
              authorization: "Bearer dev",
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "content-length": Buffer.byteLength(body),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "ECONNRESET" || error.code === "EPIPE") resolve(0);
          else reject(error);
        });
        req.end(body);
      });
      // The adapter caps before dispatch; closing with unread bytes may reset the socket.
      expect([0, 413]).toContain(status);
    }
    const socket = connect(address.port, "127.0.0.1");
    let earlyResponse = "";
    socket.on("data", (chunk) => {
      earlyResponse += String(chunk);
    });
    socket.write(
      "PUT /mcp/files/uploads/missing HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100000000\r\n\r\n",
    );
    await once(socket, "close");
    expect(earlyResponse).toContain("404 Not Found");
    expect(earlyResponse.toLowerCase()).toContain("connection: close");
    expect(gateway.server.maxConnections).toBe(1024);
    const corrupt = await store.createUpload("owner", input);
    await writeFile(join(directory, `${corrupt.upload.upload_id}.json`), "private-file-contents");
    expect((await transfer(corrupt.upload.upload_url)).status).toBe(500);
    expect(logs).not.toContain(directory);
    expect(logs).not.toContain("private-file-contents");
    expect(logs).not.toContain(new URL(corrupt.upload.upload_url).searchParams.get("token"));
  } finally {
    await gateway.close();
    gateway.server.closeAllConnections();
    await new Promise<void>((resolve) => gateway.server.close(() => resolve()));
  }
});

it("validates quota environment values and hides startup filesystem paths", async () => {
  const env = {
    WORKSPACE_ORIGIN: "http://workspace.test",
    MCP_PUBLIC_URL: "http://mcp.test/mcp",
    MCP_STAGING_DIRECTORY: testStagingDirectory(),
    MCP_DEV_SESSION_PASSTHROUGH: "1",
  };
  expect(parseGatewayConfig(env)).toMatchObject({
    MCP_STAGING_USER_MAX_BYTES: 2147483648,
    MCP_STAGING_USER_MAX_PENDING_UPLOADS: 20,
  });
  expect(
    parseGatewayConfig({
      ...env,
      MCP_STAGING_USER_MAX_BYTES: "5",
      MCP_STAGING_USER_MAX_PENDING_UPLOADS: "1",
    }),
  ).toMatchObject({ MCP_STAGING_USER_MAX_BYTES: 5, MCP_STAGING_USER_MAX_PENDING_UPLOADS: 1 });
  for (const value of ["0", "-1", "1.5", "NaN", "9007199254740992"])
    expect(() => parseGatewayConfig({ ...env, MCP_STAGING_USER_MAX_BYTES: value })).toThrow();
  const file = join(testStagingDirectory(), "private-source");
  await writeFile(file, "secret", { mode: 0o600 });
  expect(() => new LocalStagingStore(join(file, "unavailable"), "http://mcp.test/mcp")).toThrow(
    "Unable to initialize private staging directory.",
  );
});

it("refreshes ready sidecars from another replica before enforcing pending quotas", async () => {
  const { store: a, directory } = setup({ maxPendingUploads: 1 });
  const { upload } = await a.createUpload("owner", input);
  const { store: b } = setup({ maxPendingUploads: 1 }, directory);
  await expect(b.createUpload("owner", input)).rejects.toMatchObject({
    code: "workspace-staging-quota-exceeded",
  });
  await a.handle(put(upload.upload_url, "abc"));
  await b.sweep();
  await expect(b.createUpload("owner", input)).resolves.toHaveProperty("upload");
});

it("removes expired corrupt metadata and its data once with the object ID", async () => {
  let now = Date.now();
  const onError = vi.fn();
  const { store, directory } = setup({ now: () => now, onError });
  const { upload } = await store.createUpload("owner", input);
  await store.handle(put(upload.upload_url, "abc"));
  await writeFile(join(directory, `${upload.upload_id}.json`), "{broken");
  await store.sweep();
  expect(onError).not.toHaveBeenCalled();
  now += 61 * 60_000;
  await store.sweep();
  await store.sweep();
  expect(await readdir(directory)).toEqual([]);
  expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error), upload.upload_id);
});

it("keeps a successor lock and sweeps orphan zero-byte locks after the bound", async () => {
  let now = Date.now();
  const { store, directory } = setup({ now: () => now });
  const { upload } = await store.createUpload("owner", input);
  await store.handle(put(upload.upload_url, "abc"));
  const lock = join(directory, `${upload.upload_id}.lock`);
  await store.withUpload("owner", upload.upload_id, "blob", async () => {
    expect(await readFile(lock, "utf8")).toMatch(/^[a-f0-9]{64}$/);
    await unlink(lock);
    await writeFile(lock, "successor", { mode: 0o600 });
  });
  expect(await readFile(lock, "utf8")).toBe("successor");
  await unlink(lock);
  const orphan = join(directory, `${randomUUID()}.lock`);
  await writeFile(orphan, "", { mode: 0o600 });
  await store.sweep();
  expect(await readdir(directory)).toContain(orphan.split("/").at(-1));
  now += 121 * 60_000;
  await store.sweep();
  expect(await readdir(directory)).toEqual([]);
});

it("falls back for invalid Workspace media types and reports integrity errors internally", async () => {
  const { store, directory } = setup();
  const download = await store.createDownload({
    owner: "owner",
    fileName: "file",
    mediaType: "invalid",
    content: bytes(),
  });
  expect(download.media_type).toBe("application/octet-stream");
  const { upload } = await store.createUpload("owner", input);
  await store.handle(put(upload.upload_url, "abc"));
  await writeFile(join(directory, `${upload.upload_id}.data`), "corrupted");
  const consume = vi.fn();
  await expect(store.withUpload("owner", upload.upload_id, "blob", consume)).rejects.toThrow(
    "Staging data integrity mismatch",
  );
  expect(consume).not.toHaveBeenCalled();
});
