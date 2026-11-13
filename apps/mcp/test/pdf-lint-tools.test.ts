import { opSpecs, PROTOCOL_VERSION } from "../src/shared/executor-protocol.js";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobHandleSchema, jobViewSchema } from "../src/gateway/jobs/model.js";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { decodeFrame, encodeFrame } from "../src/shared/frame.js";
import { zeroCost } from "../src/shared/usage.js";
import { testStagingDirectory } from "./staging-directory.js";

const pdf = Buffer.from("%PDF-1.7\n%%EOF\n");
const meta = { executor: "warm", unitType: "doc", cost: { ...zeroCost, render_pages: 2 } };
const pdfOutput = {
  unitId: "unit-1",
  unitType: "doc",
  name: "Report",
  mediaType: "application/pdf",
  pageCount: 2,
};
const lintReport = {
  kind: "unit-layout-lint",
  unitId: "unit-1",
  unitType: "slide",
  coverage: { pages: [{ page: 1, pageId: "p1" }], rules: ["text-off-page"] },
  findings: [{ id: "f1", page: 1, pageId: "p1", rule: "text-off-page", severity: "warning" }],
};
const printed =
  (output: object = pdfOutput) =>
  async () =>
    new Uint8Array(encodeFrame({ ok: true, output, meta }, pdf));
const failure = (code: string, message: string) => async () =>
  new Uint8Array(
    encodeFrame({
      ok: false,
      error: { code, message, detail: null, outcome: "tool_error" },
      meta: { executor: "warm", cost: { ...zeroCost } },
    }),
  );

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
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start(options: { syncBudgetMs?: number } = {}) {
  let logs = "";
  const requests: Array<{ header: Record<string, unknown>; payload: Uint8Array }> = [];
  let reply: () => Promise<Uint8Array> = async () => {
    throw new Error("No executor reply configured");
  };
  const executor = createServer((request, response) => {
    if (request.url === "/rpc/v1/capabilities") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ v: PROTOCOL_VERSION, operations: Object.keys(opSpecs) }));
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const frame = decodeFrame(Buffer.concat(chunks));
      requests.push({ header: frame.header as Record<string, unknown>, payload: frame.payload });
      void reply().then((body) => response.end(body));
    });
  });
  const executorUrl = await listen(executor);
  cleanups.push(() => close(executor));
  const { gateway, url } = await listenGateway((url) =>
    createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: "http://workspace.test",
        MCP_PUBLIC_URL: url,
        MCP_STAGING_DIRECTORY: testStagingDirectory(),
        MCP_EXECUTOR_URLS: executorUrl,
        MCP_EXECUTOR_TOKEN: "t".repeat(32),
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
    ),
  );
  const client = new Client({ name: "pdf-lint-test", version: "1" });
  cleanups.push(async () => {
    await client.close();
    await gateway.close();
    await close(gateway.server);
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}?toolsets=all`), {
      requestInit: { headers: { Authorization: "Bearer test-session" } },
    }),
  );
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

describe("print_pdf tool", () => {
  it("is listed in files and all with an output schema and the read-only annotations", async () => {
    const { client } = await start();
    const tool = (await client.listTools()).tools.find(({ name }) => name === "print_pdf");
    expect(tool?.outputSchema).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(Object.keys((tool?.inputSchema as { properties: object }).properties)).toEqual([
      "unit",
      "trunk",
      "worktree",
      "idempotency_key",
    ]);
  });

  it("returns a download link and the page count, and records the usage", async () => {
    const t = await start();
    t.reply(printed());
    const result = await t.client.callTool({
      name: "print_pdf",
      arguments: { unit: "unit-1", worktree: "wt-1" },
    });
    expect(result.isError).not.toBe(true);
    expect(t.requests[0]?.header).toMatchObject({
      op: "render.printPdf",
      input: { unitId: "unit-1", scope: { kind: "worktree", worktreeId: "wt-1" } },
    });
    expect(result.content).toEqual([{ type: "text", text: "print_pdf completed." }]);
    const output = result.structuredContent as {
      unitId: string;
      unitType: string;
      pageCount: number;
      download: { url: string; file_name?: string };
    };
    expect(output).toMatchObject({ unitId: "unit-1", unitType: "doc", pageCount: 2 });
    const response = await fetch(output.download.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("Report.pdf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
    await vi.waitFor(() =>
      expect(t.events()).toMatchObject([
        {
          tool: "print_pdf",
          outcome: "ok",
          cost: { render_pages: 2, export_bytes: pdf.length },
        },
      ]),
    );
  });

  it("prints trunk Units", async () => {
    const t = await start();
    t.reply(printed());
    await t.client.callTool({ name: "print_pdf", arguments: { unit: "unit-1", trunk: true } });
    expect(t.requests[0]?.header).toMatchObject({ input: { scope: { kind: "trunk" } } });
  });

  it("returns a job whose result carries the link, and dedupes by idempotency key", async () => {
    const t = await start({ syncBudgetMs: 5 });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    t.reply(async () => {
      await done;
      return printed()();
    });
    const call = { unit: "unit-1", trunk: true, idempotency_key: "print-pdf-key-1234" };
    const first = await t.client.callTool({ name: "print_pdf", arguments: call });
    const handle = jobHandleSchema.parse(first.structuredContent);
    expect(first.content).toEqual([
      { type: "text", text: "print_pdf is running. Poll job_get with job_id." },
    ]);
    expect(
      (await t.client.callTool({ name: "print_pdf", arguments: call })).structuredContent,
    ).toEqual(handle);
    const conflict = await t.client.callTool({
      name: "print_pdf",
      arguments: { ...call, unit: "unit-2" },
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
    const result = polled.result as { pageCount: number; download: { url: string } };
    expect(result.pageCount).toBe(2);
    const response = await fetch(result.download.url);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
    expect(t.requests).toHaveLength(1);
  });

  it("rejects a missing or doubled scope before the executor", async () => {
    const t = await start();
    for (const [input, code] of [
      [{ unit: "u" }, "workspace-print-pdf-scope-required"],
      [{ unit: "u", trunk: true, worktree: "wt-1" }, "workspace-argument-invalid"],
    ] as const) {
      const result = await t.client.callTool({ name: "print_pdf", arguments: input });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code });
    }
    expect(t.requests).toHaveLength(0);
  });

  it("relays the Base rejection as a tool error", async () => {
    const t = await start();
    t.reply(
      failure("workspace-print-pdf-type-unsupported", "Base Units do not support PDF printing."),
    );
    const result = await t.client.callTool({
      name: "print_pdf",
      arguments: { unit: "u", trunk: true },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Base Units do not support PDF printing." },
    ]);
    expect(result.structuredContent).toMatchObject({
      code: "workspace-print-pdf-type-unsupported",
    });
  });
});

describe("lint tool", () => {
  it("is listed in files and all with an output schema and the read-only annotations", async () => {
    const { client } = await start();
    const tool = (await client.listTools()).tools.find(({ name }) => name === "lint");
    expect(tool?.outputSchema).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(Object.keys((tool?.inputSchema as { properties: object }).properties)).toEqual([
      "unit",
      "worktree",
      "pages",
    ]);
  });

  it("returns the report as structured content and maps the arguments", async () => {
    const t = await start();
    t.reply(
      async () =>
        new Uint8Array(
          encodeFrame({
            ok: true,
            output: lintReport,
            meta: { ...meta, unitType: "slide", cost: { ...zeroCost, render_pages: 1 } },
          }),
        ),
    );
    const result = await t.client.callTool({
      name: "lint",
      arguments: { unit: "unit-1", worktree: "wt-1", pages: "1,cover" },
    });
    expect(result.isError).not.toBe(true);
    expect(t.requests[0]?.header).toMatchObject({
      op: "render.lint",
      input: { worktreeId: "wt-1", unitId: "unit-1", pages: "1,cover" },
    });
    expect(result.structuredContent).toEqual(lintReport);
    await vi.waitFor(() =>
      expect(t.events()).toMatchObject([
        { tool: "lint", outcome: "ok", cost: { render_pages: 1 } },
      ]),
    );
  });

  it("requires a worktree and relays the executor's rejection of a non-Slide Unit", async () => {
    const t = await start();
    const missing = await t.client.callTool({ name: "lint", arguments: { unit: "u" } });
    expect(missing.isError).toBe(true);
    expect(t.requests).toHaveLength(0);
    const message = "Slide layout lint requires a Slide Unit; u is sheet.";
    t.reply(failure("workspace-unit-layout-lint-unit-type-unsupported", message));
    const result = await t.client.callTool({
      name: "lint",
      arguments: { unit: "u", worktree: "wt-1" },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: message }]);
    expect(result.structuredContent).toMatchObject({
      code: "workspace-unit-layout-lint-unit-type-unsupported",
    });
  });
});
