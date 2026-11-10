import { opSpecs, PROTOCOL_VERSION } from "../src/shared/executor-protocol.js";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { expect, it, vi } from "vitest";
import { createGateway } from "./gateway.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { encodeFrame } from "../src/shared/frame.js";
import { zeroCost } from "../src/shared/usage.js";
import { testStagingDirectory } from "./staging-directory.js";
import { jobHandleSchema, jobViewSchema } from "../src/gateway/jobs/model.js";

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

it("serves job handles through MCP schemas and emits conversion usage once on settlement, with polling at zero cost", async () => {
  let logs = "";
  let conversions = 0;
  let finish!: () => void;
  const conversion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const executor = createServer((request, response) => {
    if (request.url === "/rpc/v1/capabilities") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ v: PROTOCOL_VERSION, operations: Object.keys(opSpecs) }));
      return;
    }
    request.resume();
    conversions++;
    void conversion.then(() =>
      response.end(
        encodeFrame(
          {
            ok: true,
            output: { name: "Book", type: "sheet", unitId: "unit", worktreeId: "wt" },
            meta: {
              executor: "cold_start",
              unitType: "sheet",
              cost: { ...zeroCost, worker_cpu_ms: 42 },
            },
          },
          new Uint8Array([80, 75]),
        ),
      ),
    );
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
      MCP_EXECUTOR_TOKEN: "t".repeat(32),
      MCP_SYNC_BUDGET_MS: "5",
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
  const client = new Client({ name: "jobs-test", version: "1" });
  const events = () =>
    logs
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line))
      .filter((line) => line.event === "mcp.tool_call");
  try {
    gateway.server.listen(Number(new URL(origin).port), "127.0.0.1");
    await once(gateway.server, "listening");
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { Authorization: "Bearer test-session" } },
      }),
    );
    const args = {
      worktree: "wt",
      unit: "unit",
      format: "xlsx",
      idempotency_key: "retry-export-key-123",
    };
    const first = await client.callTool({ name: "export", arguments: args });
    expect(first.isError).not.toBe(true);
    const handle = jobHandleSchema.parse(first.structuredContent);
    expect(first.content).toEqual([
      { type: "text", text: "export is running. Poll job_get with job_id." },
    ]);
    expect(events()).toHaveLength(0);
    expect((await client.callTool({ name: "export", arguments: args })).structuredContent).toEqual(
      handle,
    );
    finish();
    await vi.waitFor(() => expect(events()).toHaveLength(1));
    const polled = jobViewSchema.parse(
      (await client.callTool({ name: "job_get", arguments: { job_id: handle.job_id } }))
        .structuredContent,
    );
    expect(polled.status).toBe("succeeded");
    if (polled.status !== "succeeded") throw new Error("Expected a settled job");
    const cached = await client.callTool({ name: "export", arguments: args });
    expect(cached.structuredContent).toEqual(polled.result);
    expect(cached._meta).toMatchObject({ "univer.workspace.deduplicated": true });
    expect(events()).toMatchObject([
      {
        tool: "export",
        outcome: "ok",
        executor: "cold_start",
        cost: { worker_cpu_ms: 42, export_bytes: 2 },
      },
      { tool: "job_get", outcome: "ok", executor: "none", cost: zeroCost },
    ]);
    expect(conversions).toBe(1);
  } finally {
    finish();
    await client.close();
    await gateway.close();
    await close(gateway.server);
    await close(executor);
  }
});
