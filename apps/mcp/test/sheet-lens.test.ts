import { describe, expect, it, vi } from "vitest";
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

function setup() {
  const http = new WorkspaceHttp({ origin: target.origin, role: "client" });
  const source = new WorkspaceContentSource(http);
  vi.spyOn(source, "resolveTrunkRuntimeTarget").mockResolvedValue(target);
  vi.spyOn(source, "resolveRuntimeTarget").mockImplementation(async ({ worktreeId }) => ({
    ...target,
    scope: { kind: "worktree", worktreeId },
  }));
  const exportUnitData = vi.fn(async () => data);
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
  },
);

describe("resumable tool arguments", () => {
  it.each([
    {
      tool: outlineTool,
      args: { unit: "unit", trunk: true, at: "s1.t1", from: "s1.t1.c1", depth: 2, budget: 300 },
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
  expect(parseExecutorConfig(env).EXECUTOR_SHEET_LENS_CACHE_BYTES).toBe(128 * 1024 * 1024);
  expect(
    parseExecutorConfig({ ...env, EXECUTOR_SHEET_LENS_CACHE_BYTES: "0" })
      .EXECUTOR_SHEET_LENS_CACHE_BYTES,
  ).toBe(0);
  for (const value of ["", " ", "-1", "1.5", "NaN", "Infinity", "abc", "9007199254740992"])
    expect(() => parseExecutorConfig({ ...env, EXECUTOR_SHEET_LENS_CACHE_BYTES: value })).toThrow(
      /EXECUTOR_SHEET_LENS_CACHE_BYTES/,
    );
});
