import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { expect, it, vi } from "vitest";
import { ExchangeFormat } from "@univerjs-pro/exchange-node";
import { WorkspaceContentSource } from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { exchangeImport } from "../src/executor/ops/exchange-import.js";
import type { OpContext } from "../src/executor/context.js";
import { zeroCost } from "../src/shared/usage.js";
import { createDispatcher } from "../src/executor/dispatch.js";
import { handlers } from "../src/executor/ops/index.js";
import { runConversionJob } from "../src/executor/jobs/run.js";
import { conversionError } from "../src/executor/jobs/errors.js";
import { ConversionJobQueue } from "../src/executor/jobs/queue.js";
import { sweepJobDirectories } from "../src/executor/jobs/directories.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import { opSpecs, type RequestHeader } from "../src/shared/executor-protocol.js";
import { importTool } from "../src/gateway/tools/core/import.js";
import { UNIVER_LICENSE, UNIVER_LICENSE_KEY } from "../src/executor/license.js";

const configInput = {
  WORKSPACE_ORIGIN: "http://workspace.test",
  MCP_EXECUTOR_TOKEN: "token".repeat(10),
};
const config = parseExecutorConfig(configInput);
const credentials = { license: UNIVER_LICENSE, licenseKey: UNIVER_LICENSE_KEY };
const entry = new URL("./fixtures/job-entry.mjs", import.meta.url);
const runtime = {
  executeRead: vi.fn(),
  executeAndCommit: vi.fn(),
  exportUnitData: vi.fn(),
  close: vi.fn(),
};
const header: RequestHeader = {
  v: 1,
  op: "exchange.import",
  requestId: "import-test",
  deadlineMs: 10_000,
  grant: { kind: "session", userId: "alice", session: "session", expiresAt: Date.now() + 600_000 },
  input: {
    worktreeId: "wt",
    spaceId: "space",
    fileName: "small.xlsx",
    idempotencyKey: "retry-identical-12345",
  },
};
const book = {
  id: "book",
  name: "Repeat",
  appVersion: "1.0",
  locale: "enUS",
  sheetOrder: ["s1"],
  styles: {},
  sheets: {
    s1: {
      id: "s1",
      name: "First",
      rowCount: 10,
      columnCount: 10,
      cellData: { 0: { 0: { v: 42 } } },
    },
  },
};

it("requires a complete configured license pair and validates retry keys before work", () => {
  for (const pair of [{ UNIVER_LICENSE: "L" }, { UNIVER_LICENSE_KEY: "K" }])
    expect(() => parseExecutorConfig({ ...configInput, ...pair })).toThrow(/together/);
  expect(parseExecutorConfig(configInput).UNIVER_LICENSE).toBeUndefined();
  expect(
    parseExecutorConfig({ ...configInput, UNIVER_LICENSE: "L", UNIVER_LICENSE_KEY: "K" }),
  ).toMatchObject({ UNIVER_LICENSE: "L", UNIVER_LICENSE_KEY: "K" });
  for (const key of ["short", "x".repeat(201), "has spaces but long", "has/slash-12345678"])
    expect(
      importTool.inputSchema.safeParse({
        upload_id: "u",
        worktree: "w",
        space: "s",
        idempotency_key: key,
      }).success,
    ).toBe(false);
  const input = opSpecs["exchange.import"].input.parse(header.input);
  expect(opSpecs["exchange.import"].route(input)).toEqual({
    scope: "exchange.import",
    unitId: input.idempotencyKey,
  });
});

it("replays identical native conversion after the units POST times out without creating another Unit", async () => {
  const bytes = await runConversionJob(
    { kind: "export", data: book, options: { type: 2, format: ExchangeFormat.XLSX } },
    credentials,
    AbortSignal.timeout(30_000),
    entry,
  );
  const bodies: string[] = [];
  let confirmed = false;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    if (String(url).endsWith("/api/session"))
      return Response.json({ authenticated: true, user: { id: "alice", displayName: "Alice" } });
    expect(String(url)).toContain("/api/worktrees/wt/units");
    expect(new Headers(options?.headers).get("idempotency-key")).toBe("retry-identical-12345");
    bodies.push(String(options?.body));
    // Workspace has committed the Unit; all responses to the first call are lost.
    if (!confirmed) throw new TypeError("fetch failed after POST");
    return Response.json({
      unit: {
        unitId: "created-once",
        resourceId: "resource",
        nodeId: "node",
        name: JSON.parse(String(options?.body)).name,
        source: "worktree",
        unitType: "sheet",
        draftHeadRevision: 1,
        change: "added",
        mergeResult: "pending",
        activationState: "waitingForMerge",
        target: { spaceId: "space", parentNodeId: null },
      },
    });
  });
  try {
    const http = new WorkspaceHttp({
      origin: config.WORKSPACE_ORIGIN,
      cookie: "workspace_session=session",
      role: "client",
    });
    const signal = AbortSignal.timeout(30_000);
    const ctx: OpContext = {
      requestId: "native-retry",
      userId: "alice",
      signal,
      transportOrigin: config.WORKSPACE_TRANSPORT_URL,
      http: () => http,
      source: () => new WorkspaceContentSource(http),
      runtime,
      usage: { executor: "none", cost: { ...zeroCost } },
      exchange: {
        ...credentials,
        importBuffer: (bytes, options) =>
          runConversionJob({ kind: "import", bytes, options }, credentials, signal, entry),
      },
    };
    const input = opSpecs["exchange.import"].input.parse(header.input);
    await expect(exchangeImport(ctx, input, bytes)).rejects.toMatchObject({
      code: "workspace-result-unknown",
    });
    expect(bodies).toHaveLength(3);
    confirmed = true;
    const second = await exchangeImport(
      { ...ctx, requestId: "retry-with-new-request-id" },
      input,
      bytes,
    );
    expect(second).toMatchObject({ output: { unitId: "created-once" } });
    expect(new Set(bodies).size).toBe(1);
  } finally {
    fetcher.mockRestore();
  }
}, 60_000);

it.each([false, true])(
  "distinguishes deadlines before and after createUnit starts (%s)",
  async (started) => {
    vi.useFakeTimers();
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ authenticated: true, user: { id: "alice", displayName: "Alice" } }),
      );
    const handler = vi.spyOn(handlers, "exchange.import").mockImplementation(async (ctx) => {
      if (started) ctx.onCreateUnit?.();
      signalEntered();
      await new Promise((_resolve, reject) =>
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true }),
      );
      throw new Error("unreachable");
    });
    try {
      const pending = createDispatcher(config, runtime, pino({ level: "silent" }))(
        "exchange.import",
        { ...header, deadlineMs: 25 },
        new Uint8Array(),
      );
      await entered;
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;
      expect(result.header).toMatchObject({
        ok: false,
        error: {
          code: started ? "workspace-result-unknown" : "workspace-executor-timeout",
          outcome: "timeout",
          detail: started ? { retryable: false } : { retryable: true, started: false },
        },
      });
    } finally {
      vi.useRealTimers();
      handler.mockRestore();
      fetcher.mockRestore();
    }
  },
);

it("bounds concurrent jobs and drops a queued job at its own deadline", async () => {
  const queue = new ConversionJobQueue(1);
  const first = await queue.acquire(new AbortController().signal);
  const controller = new AbortController();
  const waiting = queue.acquire(controller.signal);
  controller.abort(new Error("deadline before conversion"));
  await expect(waiting).rejects.toThrow("deadline before conversion");
  let acquired = false;
  const next = queue.acquire(new AbortController().signal).then((release) => {
    acquired = true;
    return release;
  });
  await Promise.resolve();
  expect(acquired).toBe(false);
  first();
  const release = await next;
  expect(acquired).toBe(true);
  release();
});

it("accepts only conversion codes and strips Unix and Windows absolute paths", () => {
  for (const code of ["workspace-authentication-required", "workspace-result-unknown", "OTHER"])
    expect(conversionError(code, "failed at /private/secret/file.xlsx")).toEqual({
      code: "workspace-exchange-conversion-failed",
      message: "failed at [path]",
    });
  expect(conversionError("LICENSE_USAGE_STORAGE_ERROR", "failed C:\\secret\\usage.json")).toEqual({
    code: "LICENSE_USAGE_STORAGE_ERROR",
    message: "failed [path]",
  });
  expect(conversionError("INVALID_FILE", "invalid file").code).toBe("INVALID_FILE");
});

it("sweeps dead executors' directories and preserves live executors' directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-sweep-test-"));
  try {
    const dead = "univer-mcp-job-2147483647-dead";
    const live = `univer-mcp-job-${process.ppid}-live`;
    const restarted = `univer-mcp-job-${process.pid}-previous`;
    for (const name of [dead, restarted, live, "unrelated"]) await mkdir(join(root, name));
    await sweepJobDirectories(root);
    expect((await readdir(root)).sort()).toEqual(["unrelated", live].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("exits its conversion child when the executor IPC channel disconnects", async () => {
  const child = fork(new URL("./fixtures/job-disconnect.mjs", import.meta.url), [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    await once(child, "message");
    const exited = once(child, "exit");
    child.disconnect();
    expect(await exited).toEqual([0, null]);
  } finally {
    child.kill("SIGKILL");
  }
}, 5000);

it("reports a child killed by the configured heap cap as a conversion crash", async () => {
  await expect(
    runConversionJob(
      { kind: "import", bytes: new Uint8Array(), options: { fileName: "x.xlsx", type: 2 } },
      credentials,
      new AbortController().signal,
      new URL("./fixtures/job-heap.mjs", import.meta.url),
      16,
    ),
  ).rejects.toMatchObject({
    code: "workspace-job-crashed",
    message: expect.stringContaining("memory limit"),
  });
}, 20_000);

it("refuses oversized UnitData in the real child before sending a success payload", async () => {
  const cellData = Object.fromEntries(
    Array.from({ length: 5000 }, (_, index) => [
      index,
      { 0: { v: `row-${index}-${"x".repeat(200)}` } },
    ]),
  );
  const bytes = await runConversionJob(
    {
      kind: "export",
      data: { ...book, sheets: { s1: { ...book.sheets.s1, rowCount: 5000, cellData } } },
      options: { type: 2, format: ExchangeFormat.XLSX },
    },
    credentials,
    AbortSignal.timeout(15_000),
    entry,
  );
  await expect(
    runConversionJob(
      { kind: "import", bytes, options: { fileName: "oversized.xlsx", type: 2 } },
      credentials,
      AbortSignal.timeout(15_000),
      entry,
    ),
  ).rejects.toMatchObject({
    code: "workspace-import-too-large",
    detail: { maxBytes: 921600, size: expect.any(Number) },
  });
}, 20_000);

it.each([
  "workspace-authentication-required",
  "workspace-result-unknown",
  "LICENSE_USAGE_STORAGE_ERROR",
  "workspace-typst-invalid",
  "workspace-typst-diagnostics",
])("filters child-provided %s errors at the parent IPC boundary", async (code) => {
  await expect(
    runConversionJob(
      { kind: "import", bytes: new Uint8Array(), options: { fileName: code, type: 2 } },
      credentials,
      AbortSignal.timeout(5000),
      new URL("./fixtures/job-error.mjs", import.meta.url),
    ),
  ).rejects.toMatchObject({
    code: code.startsWith("LICENSE_") || code.startsWith("workspace-typst-") ? code : "workspace-exchange-conversion-failed",
    message: "failed at [path]",
    detail: { diagnostics: [{ sourcePath: "nested/page.typ", reason: "file not found (searched at nested/missing.png)", suggestedRewrite: "check [path]" }] },
  });
});
