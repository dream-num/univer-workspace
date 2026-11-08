import { once } from "node:events";
import { request } from "node:http";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pino } from "pino";
import { expect, it } from "vitest";
import { createGateway } from "../src/gateway/server.js";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { testStagingDirectory } from "./staging-directory.js";

it("correlates safe failure diagnostics and logs each client abort once at info", async () => {
  const directory = testStagingDirectory();
  let logs = "";
  let failSession = false;
  const gateway = createGateway(
    parseGatewayConfig({
      WORKSPACE_ORIGIN: "https://workspace.test",
      MCP_PUBLIC_URL: "http://127.0.0.1/mcp",
      MCP_STAGING_DIRECTORY: directory,
      MCP_DEV_SESSION_PASSTHROUGH: "1",
      MCP_MAX_CONNECTIONS: "25",
    }),
    {
      logger: pino(
        { level: "trace" },
        new Writable({
          write(chunk, _encoding, done) {
            logs += String(chunk);
            done();
          },
        }),
      ),
      fetcher: async () => {
        if (failSession) throw new Error("secret upstream path /private/session");
        return Response.json({
          authenticated: true,
          user: { id: "owner", displayName: "Owner", username: "owner" },
        });
      },
    },
  );
  const store = new LocalStagingStore(directory, "http://127.0.0.1/mcp");
  gateway.server.listen(0, "127.0.0.1");
  await once(gateway.server, "listening");
  const address = gateway.server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  const origin = `http://127.0.0.1:${address.port}`;
  const events = () =>
    logs
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const failures = (id: string) =>
    events().filter((entry) => entry.request_id === id && /failed/i.test(entry.msg ?? ""));
  const create = () =>
    store.createUpload("owner", {
      purpose: "blob",
      file_name: "test.bin",
      media_type: "application/octet-stream",
    });
  const send = (path: string, id: string, body?: string) =>
    new Promise<Response>((resolve, reject) => {
      const req = request(
        origin,
        {
          path,
          method: body === undefined ? "GET" : "POST",
          headers: {
            host: "127.0.0.1",
            authorization: "Bearer dev",
            "x-request-id": id,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-11-25",
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500 })),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  const call = (id: string, name: string, args: object) =>
    send(
      "/mcp?toolsets=files",
      id,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    );
  try {
    expect(gateway.server.maxConnections).toBe(25);
    const { upload } = await create();
    const uploadUrl = new URL(upload.upload_url);
    const aborted = request(origin, {
      path: uploadUrl.pathname + uploadUrl.search,
      method: "PUT",
      headers: { host: "127.0.0.1", "content-length": "1000000", "x-request-id": "upload-abort" },
    });
    aborted.on("error", () => {});
    aborted.write(Buffer.alloc(1000));
    await expect
      .poll(async () => (await readdir(directory)).includes(`${upload.upload_id}.lock`))
      .toBe(true);
    aborted.destroy();
    await expect.poll(() => failures("upload-abort").length).toBe(1);
    expect(failures("upload-abort")[0]).toMatchObject({
      level: 30,
      code: "ECONNRESET",
      error_name: "Error",
    });
    await expect
      .poll(async () => (await readdir(directory)).some((name) => name.endsWith(".lock")))
      .toBe(false);

    const download = await store.createDownload({
      owner: "owner",
      fileName: "test.bin",
      mediaType: "application/octet-stream",
      content: (async function* () {
        for (let i = 0; i < 32; i++) yield Buffer.alloc(1024 * 1024);
      })(),
    });
    const downloadUrl = new URL(download.url);
    await new Promise<void>((resolve, reject) => {
      const req = request(
        origin,
        {
          path: downloadUrl.pathname + downloadUrl.search,
          headers: { host: "127.0.0.1", "x-request-id": "download-abort" },
        },
        (res) => {
          res.once("data", () => {
            req.destroy();
            resolve();
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
    await expect.poll(() => failures("download-abort").length).toBe(1);
    expect(failures("download-abort")[0]).toMatchObject({
      level: 30,
      code: "ERR_STREAM_PREMATURE_CLOSE",
    });

    await expect
      .poll(async () => (await readdir(directory)).some((name) => name.endsWith(".lock")))
      .toBe(false);
    const ready = await create();
    await store.handle(new Request(ready.upload.upload_url, { method: "PUT", body: "abc" }));
    await unlink(join(directory, `${ready.upload.upload_id}.data`));
    const toolResult = await (
      await call("internal-tool", "blob_upload", {
        upload_id: ready.upload.upload_id,
        space: "space",
        idempotency_key: "test",
      })
    ).text();
    expect(toolResult).toContain("workspace-internal-error");
    expect(toolResult).not.toContain(directory);
    expect(failures("internal-tool")).toHaveLength(1);
    expect(failures("internal-tool")[0]).toMatchObject({
      error_name: "Error",
      code: "ENOENT",
      syscall: "open",
      level: 50,
    });

    const metadataPath = join(directory, `${ready.upload.upload_id}.json`);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, JSON.stringify({ ...metadata, kind: "download" }));
    const fileUrl = new URL(ready.upload.upload_url.replace("uploads", "downloads"));
    expect((await send(fileUrl.pathname + fileUrl.search, "file-error")).status).toBe(500);
    expect(failures("file-error")).toHaveLength(1);
    expect(failures("file-error")[0]).toMatchObject({
      error_name: "Error",
      code: "ENOENT",
      syscall: "open",
      level: 50,
    });
    failSession = true;
    expect((await call("gateway-error", "blob_get", { resource: "r" })).status).toBe(500);
    expect(failures("gateway-error")).toHaveLength(1);
    expect(failures("gateway-error")[0]).toMatchObject({
      error_name: expect.any(String),
      level: 50,
    });
    expect(logs).not.toContain(directory);
    expect(logs).not.toContain("/private/session");
    expect(logs).not.toContain(uploadUrl.searchParams.get("token"));
    expect(failures("upload-abort")).toHaveLength(1);
    expect(failures("download-abort")).toHaveLength(1);
  } finally {
    await store.close();
    await gateway.close();
    gateway.server.closeAllConnections();
    await new Promise<void>((resolve) => gateway.server.close(() => resolve()));
  }
});
