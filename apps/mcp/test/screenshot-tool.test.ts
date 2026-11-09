import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobHandleSchema, jobViewSchema } from "../src/gateway/jobs/model.js";
import { createGateway } from "../src/gateway/server.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { decodeFrame, encodeFrame } from "../src/shared/frame.js";
import { zeroCost } from "../src/shared/usage.js";
import { testStagingDirectory } from "./staging-directory.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);
const image = (name: string, offset: number, size: number, page?: number) => ({
  name,
  mediaType: "image/png",
  width: 1,
  height: 1,
  offset,
  size,
  ...(page === undefined ? {} : { page }),
});
const meta = { executor: "warm", unitType: "slide", cost: { ...zeroCost, render_pages: 2 } };
const args = { unit: "unit-1", worktree: "wt-1", pages: "1-2" };

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP listener");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function start(options: { syncBudgetMs?: number } = {}) {
  let logs = "";
  const requests: Array<{ header: Record<string, unknown>; payload: Uint8Array }> = [];
  let reply: () => Promise<Uint8Array> = async () => {
    throw new Error("No executor reply configured");
  };
  const executor = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const frame = decodeFrame(Buffer.concat(chunks));
      requests.push({ header: frame.header as Record<string, unknown>, payload: frame.payload });
      void reply().then((body) => response.end(body));
    });
  });
  const executorUrl = await listen(executor);
  const reservation = createServer();
  const origin = await listen(reservation);
  await close(reservation);
  const gateway = createGateway(
    parseGatewayConfig({
      MCP_DEV_SESSION_PASSTHROUGH: "1",
      WORKSPACE_ORIGIN: "http://workspace.test",
      MCP_PUBLIC_URL: `${origin}/mcp`,
      MCP_STAGING_DIRECTORY: testStagingDirectory(),
      MCP_EXECUTOR_URLS: executorUrl,
      MCP_INTERNAL_TOKEN: "t".repeat(32),
      MCP_SYNC_BUDGET_MS: String(options.syncBudgetMs ?? 30_000),
    }),
    {
      fetcher: async () =>
        Response.json({ authenticated: true, user: { id: "alice", displayName: "Alice" } }),
      logger: pino(
        {},
        new Writable({
          write(chunk, _encoding, callback) {
            logs += chunk.toString();
            callback();
          },
        }),
      ),
    },
  );
  const client = new Client({ name: "screenshot-test", version: "1" });
  gateway.server.listen(Number(new URL(origin).port), "127.0.0.1");
  await once(gateway.server, "listening");
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp?toolsets=all`), {
      requestInit: { headers: { Authorization: "Bearer test-session" } },
    }),
  );
  cleanups.push(async () => {
    await client.close();
    await gateway.close();
    await close(gateway.server);
    await close(executor);
  });
  return {
    client,
    requests,
    reply(next: () => Promise<Uint8Array>) {
      reply = next;
    },
    events: () =>
      logs
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line["event"] === "mcp.tool_call"),
  };
}
const success = (images: ReturnType<typeof image>[], payload: Uint8Array) => async () =>
  new Uint8Array(
    encodeFrame(
      { ok: true, output: { unitId: "unit-1", unitType: "slide", images }, meta },
      payload,
    ),
  );

describe("screenshot tool", () => {
  it("is listed in core and all with an output schema and the read-only annotations", async () => {
    const { client } = await start();
    const tool = (await client.listTools()).tools.find(({ name }) => name === "screenshot");
    expect(tool?.outputSchema).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(Object.keys((tool?.inputSchema as { properties: object }).properties)).toEqual(
      expect.arrayContaining([
        "unit",
        "trunk",
        "worktree",
        "pages",
        "contact_slide",
        "tile",
        "sheet",
        "range",
        "region",
        "elements",
        "padding",
        "scale",
        "idempotency_key",
      ]),
    );
  });

  it("returns small results as image blocks and maps the options for the executor", async () => {
    const t = await start();
    t.reply(
      success(
        [image("page-1.png", 0, png.length, 1), image("page-2.png", png.length, png.length, 2)],
        Buffer.concat([png, png]),
      ),
    );
    const result = await t.client.callTool({
      name: "screenshot",
      arguments: { ...args, contact_slide: true, tile: "2x1", padding: 4, scale: 2 },
    });
    expect(result.isError).not.toBe(true);
    expect(t.requests[0]?.header).toMatchObject({
      op: "render.screenshot",
      input: {
        unitId: "unit-1",
        scope: { kind: "worktree", worktreeId: "wt-1" },
        options: { pages: "1-2", contactSlide: true, tile: "2x1", padding: 4, scale: 2 },
      },
    });
    expect(result.content).toEqual([
      { type: "text", text: "screenshot completed." },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ]);
    expect(result.structuredContent).toEqual({
      unitId: "unit-1",
      unitType: "slide",
      images: [image("page-1.png", 0, png.length, 1), image("page-2.png", 0, png.length, 2)].map(
        ({ offset: _offset, ...entry }) => entry,
      ),
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("download");
  });

  it("returns download links, no image blocks and the usage above the inline limit", async () => {
    const t = await start();
    const big = Buffer.alloc(1024 * 1024 + 1, 7);
    t.reply(success([image("page-1.png", 0, big.length, 1)], big));
    const result = await t.client.callTool({
      name: "screenshot",
      arguments: { unit: "unit-1", trunk: true },
    });
    expect(result.content).toEqual([{ type: "text", text: "screenshot completed." }]);
    const { images } = result.structuredContent as { images: Array<{ download: { url: string } }> };
    expect(images).toHaveLength(1);
    const response = await fetch(images[0]!.download.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(big);
    expect(t.requests[0]?.header).toMatchObject({ input: { scope: { kind: "trunk" } } });
    await vi.waitFor(() =>
      expect(t.events()).toMatchObject([
        { tool: "screenshot", outcome: "ok", cost: { render_pages: 2, export_bytes: big.length } },
      ]),
    );
  });

  it("returns a job whose result always uses download links, and dedupes by idempotency key", async () => {
    const t = await start({ syncBudgetMs: 5 });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    const ready = success([image("page-1.png", 0, png.length, 1)], png);
    t.reply(async () => {
      await done;
      return ready();
    });
    const call = { ...args, idempotency_key: "screenshot-key-1234" };
    const first = await t.client.callTool({ name: "screenshot", arguments: call });
    const handle = jobHandleSchema.parse(first.structuredContent);
    expect(first.content).toEqual([
      { type: "text", text: "screenshot is running. Poll job_get with job_id." },
    ]);
    expect(
      (await t.client.callTool({ name: "screenshot", arguments: call })).structuredContent,
    ).toEqual(handle);
    const conflict = await t.client.callTool({
      name: "screenshot",
      arguments: { ...call, pages: "3" },
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.structuredContent).toMatchObject({ code: "workspace-idempotency-conflict" });
    finish();
    const poll = async () =>
      jobViewSchema.parse(
        (await t.client.callTool({ name: "job_get", arguments: { job_id: handle.job_id } }))
          .structuredContent,
      );
    await vi.waitFor(async () => expect((await poll()).status).toBe("succeeded"));
    const polled = await poll();
    if (polled.status !== "succeeded") throw new Error("Expected a settled job");
    const { images } = polled.result as { images: Array<{ download: { url: string } }> };
    const response = await fetch(images[0]!.download.url);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(t.requests).toHaveLength(1);
  });

  it("rejects a missing or doubled scope and a malformed option before the executor", async () => {
    const t = await start();
    for (const [input, code] of [
      [{ unit: "u" }, "workspace-screenshot-scope-required"],
      [{ unit: "u", trunk: true, worktree: "wt-1" }, "workspace-argument-invalid"],
      [{ unit: "u", trunk: true, padding: "wide" }, "workspace-argument-invalid"],
    ] as const) {
      const result = await t.client.callTool({ name: "screenshot", arguments: input });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code });
    }
    expect(t.requests).toHaveLength(0);
  });

  it("relays executor rejections as tool errors", async () => {
    const t = await start();
    t.reply(
      async () =>
        new Uint8Array(
          encodeFrame({
            ok: false,
            error: {
              code: "workspace-argument-invalid",
              message: "--range is not supported for Doc",
              detail: null,
              outcome: "tool_error",
            },
            meta: { executor: "warm", cost: { ...zeroCost } },
          }),
        ),
    );
    const result = await t.client.callTool({
      name: "screenshot",
      arguments: { unit: "u", trunk: true, range: "A1" },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "--range is not supported for Doc" }]);
    expect(result.structuredContent).toMatchObject({ code: "workspace-argument-invalid" });
  });
});
