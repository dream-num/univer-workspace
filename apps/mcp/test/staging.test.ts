import { createHash } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { chmod, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { defaultLimits, type UploadInput } from "../src/gateway/staging/model.js";
import { createGateway } from "../src/gateway/server.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { testStagingDirectory } from "./staging-directory.js";

const stores: LocalStagingStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});
function setup(options: ConstructorParameters<typeof LocalStagingStore>[2] = {}) {
  const directory = testStagingDirectory();
  const store = new LocalStagingStore(directory, "http://mcp.test/mcp", options);
  stores.push(store);
  return { store, directory };
}
const input: UploadInput = {
  purpose: "blob",
  file_name: "private-secret.txt",
  size: 3,
  media_type: "text/plain",
};
function put(url: string, body = "abc", length = body.length) {
  return new Request(url, { method: "PUT", headers: { "Content-Length": String(length) }, body });
}
async function* bytes(value: string) {
  yield new TextEncoder().encode(value);
}

describe("filesystem staging", () => {
  it("stores only the token hash and atomically changes pending uploads to ready", async () => {
    const { store, directory } = setup();
    const { upload } = await store.createUpload("owner", input);
    const token = new URL(upload.upload_url).searchParams.get("token")!;
    expect(token).toHaveLength(64);
    expect(new URL(upload.upload_url).pathname).toBe(`/mcp/files/uploads/${upload.upload_id}`);
    const sidecar = join(directory, `${upload.upload_id}.json`);
    const pending = JSON.parse(await readFile(sidecar, "utf8"));
    expect(pending).toMatchObject({
      kind: "upload",
      state: "pending",
      tokenHash: createHash("sha256").update(token).digest("hex"),
    });
    expect(await readFile(sidecar, "utf8")).not.toContain(token);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(sidecar)).mode & 0o777).toBe(0o600);
    expect((await store.handle(put(upload.upload_url))).status).toBe(204);
    expect(await store.requireUpload("owner", upload.upload_id, "blob")).toMatchObject({
      state: "ready",
      size: 3,
      sha256: createHash("sha256").update("abc").digest("hex"),
    });
    expect(await readdir(directory)).toEqual(
      expect.arrayContaining([`${upload.upload_id}.json`, `${upload.upload_id}.data`]),
    );
    expect(
      (await readdir(directory)).some((name) => name.endsWith(".tmp") || name.endsWith(".lock")),
    ).toBe(false);
    expect((await store.handle(put(upload.upload_url, "xyz"))).status).toBe(409);
    expect(await readFile(join(directory, `${upload.upload_id}.data`), "utf8")).toBe("abc");
    const reopened = new LocalStagingStore(directory, "http://mcp.test/mcp");
    stores.push(reopened);
    expect((await reopened.requireUpload("owner", upload.upload_id, "blob")).state).toBe("ready");
  });
  it("enforces owner, purpose and state without revealing foreign objects", async () => {
    const { store } = setup();
    const { upload } = await store.createUpload("owner", input);
    await expect(store.requireUpload("other", upload.upload_id, "blob")).rejects.toMatchObject({
      code: "workspace-upload-not-found",
    });
    await expect(
      store.requireUpload("owner", upload.upload_id, "office-import"),
    ).rejects.toMatchObject({ code: "workspace-upload-purpose-mismatch" });
    await expect(store.requireUpload("owner", upload.upload_id, "blob")).rejects.toMatchObject({
      code: "workspace-upload-not-ready",
    });
    for (const id of ["../escape", "..%2fescape", "/tmp/file", "not-a-uuid"])
      await expect(store.requireUpload("owner", id, "blob")).rejects.toMatchObject({
        code: "workspace-upload-not-found",
      });
  });
  it("checks the capability token, ten-minute link expiry and one-hour object expiry", async () => {
    let now = Date.now();
    const { store } = setup({ now: () => now });
    const { upload } = await store.createUpload("owner", input);
    const wrong = new URL(upload.upload_url);
    wrong.searchParams.set("token", "0".repeat(64));
    expect((await store.handle(put(wrong.href))).status).toBe(404);
    expect((await store.handle(put(upload.upload_url.replace(/\?token=.*/, "")))).status).toBe(404);
    await store.handle(put(upload.upload_url));
    now += 10 * 60_000;
    expect((await store.handle(new Request(upload.page_url))).status).toBe(404);
    expect((await store.requireUpload("owner", upload.upload_id, "blob")).state).toBe("ready");
    now += 50 * 60_000;
    await expect(store.requireUpload("owner", upload.upload_id, "blob")).rejects.toMatchObject({
      code: "workspace-upload-not-found",
    });
  });
  it("refuses bytes and Content-Length over the upper limit without publishing bytes", async () => {
    const { store, directory } = setup({ limits: { ...defaultLimits, blob: 3 } });
    const capped = await store.createUpload("owner", { ...input, size: 4 });
    expect(capped.upload.max_bytes).toBe(3);
    const { upload } = await store.createUpload("owner", input);
    for (const request of [put(upload.upload_url, "abcd", 3), put(upload.upload_url, "abc", 4)]) {
      expect((await store.handle(request)).status).toBe(413);
      expect((await readdir(directory)).sort()).toEqual(
        [`${upload.upload_id}.json`, `${capped.upload.upload_id}.json`].sort(),
      );
    }
    expect((await store.handle(put(upload.upload_url))).status).toBe(204);
    await expect(
      store.createDownload({
        owner: "owner",
        fileName: "file",
        mediaType: "text/plain",
        content: bytes("abcd"),
      }),
    ).rejects.toMatchObject({ code: "workspace-file-size-mismatch" });
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
  it("sweeps expired uploads, downloads and abandoned files at startup and on its interval", async () => {
    let now = Date.now();
    const { store, directory } = setup({ now: () => now });
    const { upload } = await store.createUpload("owner", input);
    await store.handle(put(upload.upload_url));
    const download = await store.createDownload({
      owner: "owner",
      fileName: "file",
      mediaType: "text/plain",
      content: bytes("abc"),
    });
    now += 15 * 60_000;
    expect((await store.handle(new Request(download.url))).status).toBe(404);
    await store.sweep();
    expect(await readdir(directory)).toHaveLength(2);
    now += 45 * 60_000;
    const reopened = new LocalStagingStore(directory, "http://mcp.test/mcp", {
      now: () => now,
      intervalMs: 5,
    });
    stores.push(reopened);
    const next = await reopened.createUpload("owner", input);
    expect(await readdir(directory)).toEqual([`${next.upload.upload_id}.json`]);
    now += 60 * 60_000;
    await expect.poll(async () => (await readdir(directory)).length).toBe(0);
  });
  it("returns safe download headers and a static upload page with strict CSP", async () => {
    const { store } = setup();
    const { upload } = await store.createUpload("owner", input);
    const page = await store.handle(new Request(upload.page_url));
    const html = await page.text();
    expect(html).not.toContain(input.file_name);
    expect(html).not.toContain(new URL(upload.upload_url).searchParams.get("token"));
    expect(page.headers.get("content-security-policy")).toContain(
      "default-src 'none'; script-src 'nonce-",
    );
    const download = await store.createDownload({
      owner: "owner",
      fileName: "文档.svg",
      mediaType: "image/svg+xml",
      size: 3,
      content: bytes("abc"),
    });
    const response = await store.handle(new Request(download.url));
    expect(await response.text()).toBe("abc");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-length")).toBe("3");
  });
  it("refuses unsafe directories, sidecar symlinks and media types at the boundary", async () => {
    const unsafe = testStagingDirectory();
    await chmod(unsafe, 0o755);
    expect(() => new LocalStagingStore(unsafe, "http://mcp.test/mcp")).toThrow(/private/);
    const { store, directory } = setup();
    const { upload } = await store.createUpload("owner", input);
    const outside = join(testStagingDirectory(), "outside");
    await writeFile(outside, "{}");
    const { unlink } = await import("node:fs/promises");
    await unlink(join(directory, `${upload.upload_id}.json`));
    await symlink(outside, join(directory, `${upload.upload_id}.json`));
    await expect(store.requireUpload("owner", upload.upload_id, "blob")).rejects.toThrow();
    await expect(
      store.createUpload("owner", { ...input, purpose: "office-import" }),
    ).rejects.toMatchObject({ code: "workspace-upload-media-type-invalid" });
    await expect(
      store.createUpload("owner", { ...input, file_name: "../../file" }),
    ).rejects.toThrow();
  });
});

it("serves capability routes without bearer auth, keeps Host checks and never logs tokens or bytes", async () => {
  const directory = testStagingDirectory();
  let logs = "";
  const logger = pino(
    { level: "trace" },
    new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
  );
  const gateway = createGateway(
    parseGatewayConfig({
      WORKSPACE_ORIGIN: "https://workspace.test",
      MCP_PUBLIC_URL: "http://127.0.0.1/mcp",
      MCP_STAGING_DIRECTORY: directory,
      MCP_DEV_SESSION_PASSTHROUGH: "1",
    }),
    { logger },
  );
  const store = new LocalStagingStore(directory, "http://127.0.0.1/mcp");
  stores.push(store);
  gateway.server.listen(0, "127.0.0.1");
  await once(gateway.server, "listening");
  const address = gateway.server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  const { upload } = await store.createUpload("owner", { ...input, size: 24 });
  try {
    const local = upload.upload_url.replace("http://127.0.0.1", `http://127.0.0.1:${address.port}`);
    const request = (host: string) =>
      new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(
          local,
          { method: "PUT", headers: { host, "content-length": "24" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        req.on("error", reject);
        req.end("private-file-bytes-12345");
      });
    expect(await request("wrong")).toBe(403);
    expect(await request("127.0.0.1")).toBe(204);
    expect(logs).not.toContain("private-file-bytes-12345");
    expect(logs).not.toContain(new URL(upload.upload_url).searchParams.get("token"));
  } finally {
    await gateway.close();
    gateway.server.closeAllConnections();
    await new Promise<void>((resolve) => gateway.server.close(() => resolve()));
  }
});
