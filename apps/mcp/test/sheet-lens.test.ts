import { describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import {
  WorkspaceContentSource,
  type WorkspaceContentRuntimeOperations,
  type WorkspaceRuntimeScope,
  type WorkspaceRuntimeTarget,
} from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { createSheetLensHandler } from "../src/executor/ops/sheet-lens.js";
import type { OpContext } from "../src/executor/context.js";
import { callExecutor } from "../src/gateway/executor/client.js";
import { outlineTool } from "../src/gateway/tools/core/outline.js";
import { readTool } from "../src/gateway/tools/core/read.js";
import { findTool } from "../src/gateway/tools/core/find.js";
import {
  sheetLensResponse,
  sheetLensToolOutput,
} from "../src/gateway/tools/core/sheet-lens-support.js";
import type { ToolContext } from "../src/gateway/tools/definition.js";
import { opSpecs } from "../src/shared/executor-protocol.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import { mapRuntimeError } from "../src/executor/errors.js";
import { UsageAccumulator, zeroCost } from "../src/shared/usage.js";
import { RESULT_LIMIT } from "../src/gateway/paging.js";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import { testStagingDirectory } from "./staging-directory.js";
import { parseGatewayConfig } from "../src/shared/config.js";

vi.mock("../src/gateway/executor/client.js", () => ({ callExecutor: vi.fn() }));
const scope: WorkspaceRuntimeScope = { kind: "trunk" };
const target: WorkspaceRuntimeTarget = {
  origin: "https://workspace.test",
  scope,
  unitId: "unit",
  unitType: "sheet",
  revision: 7,
};
type SheetData = Extract<
  Awaited<ReturnType<WorkspaceContentRuntimeOperations["exportUnitData"]>>,
  { sheetOrder: string[] }
>;
const data: SheetData = {
  id: "unit",
  name: "Sales",
  appVersion: "1",
  locale: "enUS" as SheetData["locale"],
  sheetOrder: ["orders"],
  styles: {},
  sheets: {
    orders: {
      id: "orders",
      name: "Orders",
      rowCount: 30,
      columnCount: 10,
      cellData: Object.fromEntries(
        Array.from({ length: 21 }, (_, r) => [
          r,
          Object.fromEntries(
            Array.from({ length: 10 }, (_, c) => [
              c,
              { v: r === 0 ? `Column ${c}` : c === 0 ? `returned ${r}` : r * c },
            ]),
          ),
        ]),
      ),
    },
  },
  resources: [{ name: "SHEET_DRAWING_PLUGIN", data: "{" }],
};

function setup(unitData = data) {
  const http = new WorkspaceHttp({ origin: target.origin, role: "client" });
  const source = new WorkspaceContentSource(http);
  vi.spyOn(source, "resolveTrunkRuntimeTarget").mockResolvedValue(target);
  vi.spyOn(source, "resolveRuntimeTarget").mockImplementation(async ({ worktreeId }) => ({
    ...target,
    scope: { kind: "worktree", worktreeId },
  }));
  const exportUnitData = vi.fn(async () => unitData);
  const ctx: OpContext = {
    requestId: "lens-test",
    userId: "alice",
    transportOrigin: target.origin,
    signal: new AbortController().signal,
    usage: { executor: "none", cost: { ...zeroCost } },
    http: () => http,
    source: () => source,
    runtime: { exportUnitData, executeRead: vi.fn(), executeAndCommit: vi.fn() },
    exchange: { license: "", licenseKey: "" },
  };
  const toolContext: ToolContext = {
    http,
    user: { id: "alice", name: "Alice" },
    requestId: "lens-test",
    identityOrigin: target.origin,
    resources: vi.fn(),
    scopes: new Set(["read"]),
  };
  const handler = createSheetLensHandler(16 * 1024 * 1024);
  vi.mocked(callExecutor).mockImplementation(async (_connection, _spec, request) => {
    const input = opSpecs["content.sheet-lens"].input.parse(request.input);
    const result = await handler(ctx, input);
    return { ...result, meta: ctx.usage };
  });
  return { ctx, handler, toolContext, exportUnitData, source };
}

it.each([outlineTool, readTool, findTool])(
  "$name rejects both scopes and neither at the input boundary",
  (tool) => {
    const options = { unit: "unit", range: "Orders!A1:J5", terms: ["returned"] };
    expect(tool.inputSchema.safeParse(options).success).toBe(false);
    expect(tool.inputSchema.safeParse({ ...options, trunk: true, worktree: "wt" }).success).toBe(
      false,
    );
    expect(tool.inputSchema.safeParse({ ...options, trunk: false }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ ...options, trunk: true }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ ...options, worktree: "wt" }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ ...options, trunk: false, worktree: "wt" }).success).toBe(
      true,
    );
  },
);

describe("resumable tool arguments", () => {
  it.each([
    {
      tool: outlineTool,
      args: {
        unit: "unit", trunk: true, at: "s1.t1", from: "s1.t1.c1", depth: 2, budget: 300, json: true,
      },
      changes: ["at", "from"],
    },
    {
      tool: readTool,
      args: {
        unit: "unit",
        trunk: true,
        range: "Orders!A1:J5",
        content: "formula+style",
        max: 10,
        json: true,
      },
      changes: ["range"],
    },
    {
      tool: findTool,
      args: {
        unit: "unit",
        trunk: true,
        terms: ["returned"],
        in: "values",
        case: true,
        sheets: ["Orders"],
        from: "Orders!A2",
        max: 2,
        json: true,
      },
      changes: ["from"],
    },
  ])(
    "$tool.name continues the listing with every original option",
    async ({ tool, args, changes }) => {
      const { toolContext } = setup();
      const first = sheetLensToolOutput.parse((await tool.run(toolContext, args)).output);
      expect(first.next?.tool).toBe(tool.name);
      expect(first.next).toBeDefined();
      for (const [key, value] of Object.entries(args))
        if (!changes.includes(key)) expect(first.next?.arguments[key]).toEqual(value);
      const nextArgs = first.next?.arguments;
      expect(tool.inputSchema.safeParse(nextArgs).success).toBe(true);
      const second = sheetLensToolOutput.parse((await tool.run(toolContext, nextArgs)).output);
      expect(second.json).not.toEqual(first.json);
      expect(second.text.split("\n")[0]).toBe("unit unit [trunk, rev=7]");
    },
  );
});

it.each([
  { tool: readTool, max: 2000, range: "Orders!A1:J5" },
  { tool: findTool, max: 500, terms: ["returned"] },
])("$tool.name bounds max at $max", ({ tool, max, ...options }) => {
  expect(tool.inputSchema.safeParse({ unit: "unit", trunk: true, ...options, max }).success).toBe(true);
  expect(tool.inputSchema.safeParse({ unit: "unit", trunk: true, ...options, max: max + 1 }).success).toBe(
    false,
  );
});

it.each([outlineTool, readTool, findTool])("$name only includes JSON when requested", async (tool) => {
  const { toolContext } = setup();
  const args = { unit: "unit", trunk: true, range: "Orders!A1:J5", terms: ["returned"] };
  for (const json of [undefined, false, true]) {
    const { output } = await tool.run(toolContext, {
      ...args, ...(json === undefined ? {} : { json }),
    });
    expect(output).toHaveProperty("text");
    if (json === true) expect(output).toHaveProperty("json");
    else expect(Object.hasOwn(output, "json")).toBe(false);
  }
});

async function withGateway(run: (client: Client) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
    String(input) === "https://executor.test/rpc/v1/capabilities"
      ? Promise.resolve(Response.json({ v: 1, operations: ["content.sheet-lens"] }))
      : realFetch(input, init),
  );
  const { gateway, url } = await listenGateway((url) =>
    createGateway(parseGatewayConfig({
      MCP_DEV_SESSION_PASSTHROUGH: "1",
      WORKSPACE_ORIGIN: target.origin,
      MCP_PUBLIC_URL: url,
      MCP_STAGING_DIRECTORY: testStagingDirectory(),
      MCP_EXECUTOR_URLS: "https://executor.test",
      MCP_EXECUTOR_TOKEN: "t".repeat(32),
    }), {
      logger: pino({ level: "silent" }),
      fetcher: async () => Response.json({
        authenticated: true, user: { id: "alice", displayName: "Alice" },
      }),
    }),
  );
  const client = new Client({ name: "sheet-lens-test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: "Bearer test-session" } },
      }),
    );
    await run(client);
  } finally {
    await client.close();
    await gateway.close();
    gateway.server.closeAllConnections();
    await new Promise<void>((resolve) => gateway.server.close(() => resolve()));
    fetchSpy.mockRestore();
  }
}

it.each([
  { name: "a default 200 by 10 text range", rows: 200, columns: 10, value: "text value ".repeat(8), max: undefined },
  { name: "a 32767-character quoted cell", rows: 1, columns: 1, value: "x".repeat(30000) + '"'.repeat(2767), max: 1 },
])("returns $name through the gateway without JSON", async ({ rows, columns, value, max }) => {
  const sheet = data.sheets["orders"]!;
  setup({
    ...data,
    resources: [],
    sheets: {
      orders: {
        ...sheet, rowCount: rows, columnCount: columns,
        cellData: Object.fromEntries(Array.from({ length: rows }, (_, row) => [
          row,
          Object.fromEntries(Array.from({ length: columns }, (_, column) => [column, { v: value }])),
        ])),
      },
    },
  });
  await withGateway(async (client) => {
    const result = await client.callTool({
      name: "read",
      arguments: {
        unit: "unit", trunk: true, range: columns === 1 ? "Orders!A1" : "Orders!A1:J200",
        ...(max === undefined ? {} : { max }),
      },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent).length).toBeLessThanOrEqual(RESULT_LIMIT);
    const output = sheetLensToolOutput.parse(result.structuredContent);
    expect(Object.hasOwn(output, "json")).toBe(false);
    expect(output.text).toContain(JSON.stringify(value));
  });
});

it.each([
  { name: "outline", options: { at: "s1.t1", budget: 300 } },
  { name: "read", options: { range: "Orders!A1:J5", max: 10 } },
  { name: "find", options: { terms: ["returned"], max: 2 } },
])("$name sends its structured text as the exact text content", async ({ name, options }) => {
  setup();
  await withGateway(async (client) => {
    const result = await client.callTool({ name, arguments: { unit: "unit", trunk: true, ...options } });
    expect(result.isError).not.toBe(true);
    const output = sheetLensToolOutput.parse(result.structuredContent);
    expect(output.text).toContain("unit unit [trunk, rev=7]");
    expect(output.text).toContain("note:");
    expect(output.next).toBeDefined();
    expect(result.content).toEqual([{ type: "text", text: output.text }]);
  });
});

it("formats the revision, trimmed body and warning lines exactly like CLI text in both scopes", () => {
  const result = {
    text: "body\n\n",
    json: {},
    revision: 7,
    warnings: [
      { code: "sheet-lens-a", message: "first" },
      { code: "sheet-lens-b", message: "second" },
    ],
  };
  expect(sheetLensResponse(result, { unit: "unit", trunk: true }).output.text).toBe(
    "unit unit [trunk, rev=7]\nbody\nnote: first\nnote: second",
  );
  expect(sheetLensResponse(result, { unit: "unit", worktree: "wt" }).output.text).toBe(
    "unit unit [worktree wt, rev=7]\nbody\nnote: first\nnote: second",
  );
});

it("returns a non-Sheet tool error that names inspect without exporting", async () => {
  const { ctx, handler, exportUnitData, source } = setup();
  vi.mocked(source.resolveTrunkRuntimeTarget).mockResolvedValue({ ...target, unitType: "doc" });
  const error = await handler(ctx, { unitId: "unit", scope, request: { op: "outline" } }).catch(
    (error: unknown) => error,
  );
  expect(mapRuntimeError(error, "read")).toMatchObject({
    outcome: "tool_error",
    code: "workspace-sheet-lens-unit-type-unsupported",
    message: expect.stringContaining("inspect"),
  });
  expect(exportUnitData).not.toHaveBeenCalled();
});

it("shares one engine across requests while keeping users and revisions separate", async () => {
  const { ctx, handler, exportUnitData, source } = setup();
  const input = { unitId: "unit", scope, request: { op: "outline" as const } };
  await handler(ctx, input);
  expect(ctx.usage.cache).toBe("miss");
  await handler(ctx, input);
  expect(ctx.usage.cache).toBe("hit");
  await handler({ ...ctx, userId: "bob" }, input);
  expect(ctx.usage.cache).toBe("miss");
  expect(exportUnitData).toHaveBeenCalledTimes(2);
  vi.mocked(source.resolveTrunkRuntimeTarget).mockResolvedValue({ ...target, revision: 8 });
  await handler(ctx, input);
  expect(exportUnitData).toHaveBeenCalledTimes(3);
  const accumulator = new UsageAccumulator();
  accumulator.addOp(ctx.usage);
  expect(accumulator.snapshot()).toMatchObject({
    cache: "miss",
    timings: {
      exportMs: expect.any(Number),
      prepareMs: expect.any(Number),
      operationMs: expect.any(Number),
      totalMs: expect.any(Number),
    },
  });
});

it("fails startup on malformed cache budgets and accepts zero to disable caching", () => {
  const env = { WORKSPACE_ORIGIN: target.origin, MCP_EXECUTOR_TOKEN: "x".repeat(32) };
  expect(parseExecutorConfig(env).EXECUTOR_SHEET_LENS_CACHE_BYTES).toBe(512 * 1024 * 1024);
  expect(
    parseExecutorConfig({ ...env, EXECUTOR_SHEET_LENS_CACHE_BYTES: "0" })
      .EXECUTOR_SHEET_LENS_CACHE_BYTES,
  ).toBe(0);
  for (const value of ["", " ", "-1", "1.5", "NaN", "Infinity", "abc", "9007199254740992"])
    expect(() => parseExecutorConfig({ ...env, EXECUTOR_SHEET_LENS_CACHE_BYTES: value })).toThrow(
      /EXECUTOR_SHEET_LENS_CACHE_BYTES/,
    );
});
