import * as childProcess from "node:child_process";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { access, realpath } from "node:fs/promises";
import { ExchangeFormat } from "@univerjs-pro/exchange-node";
import { expect, it, vi } from "vitest";
import { runConversionJob, jobEnvironment } from "../src/executor/jobs/run.js";
import { mapRuntimeError, timeoutError } from "../src/executor/errors.js";
import { UNIVER_LICENSE, UNIVER_LICENSE_KEY } from "../src/executor/license.js";

vi.mock("node:child_process", { spy: true });

const credentials = { license: UNIVER_LICENSE, licenseKey: UNIVER_LICENSE_KEY };
const job = {
  kind: "import",
  bytes: new Uint8Array([0, 255]),
  options: { fileName: "x.xlsx", type: 2 },
} as const;

it("forks with an explicit environment and advanced binary serialization, then removes its private directory", async () => {
  vi.stubEnv("MCP_EXECUTOR_TOKEN", "executor-secret");
  vi.stubEnv("MCP_RENDERER_TOKEN", "renderer-secret");
  vi.stubEnv("WORKSPACE_ORIGIN", "https://workspace.test");
  vi.stubEnv("UNIVER_LICENSE_KEY", "parent-key");
  const fixture = new URL("./fixtures/job-audit.mjs", import.meta.url);
  // An xlsx produced by the native converter exercises the real import child and its network hook.
  const bytes = await runConversionJob(
    {
      kind: "export",
      data: {
        id: "book",
        name: "Binary ✓",
        appVersion: "1.0",
        locale: "enUS",
        sheetOrder: ["s1", "s2"],
        styles: {},
        sheets: {
          s1: {
            id: "s1",
            name: "First",
            rowCount: 20,
            columnCount: 10,
            cellData: { 0: { 0: { v: 42 }, 1: { f: "=A1*2", v: 84 } } },
          },
          s2: {
            id: "s2",
            name: "Second",
            rowCount: 20,
            columnCount: 10,
            cellData: { 0: { 0: { v: "hello" } } },
          },
        },
      },
      options: { type: 2, format: ExchangeFormat.XLSX },
    },
    credentials,
    AbortSignal.timeout(15_000),
    fixture,
  );
  try {
    const result = await runConversionJob(
      { ...job, bytes },
      credentials,
      AbortSignal.timeout(15_000),
      fixture,
    );
    expect(result["sheetOrder"]).toHaveLength(2);
    expect(JSON.stringify(result)).toContain("=A1*2");
    expect(JSON.stringify(result)).toContain("hello");
    expect(result["_audit"]).toMatchObject({
      connections: 0,
      credentialKeys: [],
      execArgv: ["--max-old-space-size=256"],
    });
    const audit = z
      .object({ env: z.record(z.string(), z.string()), cwd: z.string() })
      .parse(result["_audit"]);
    const { __CF_USER_TEXT_ENCODING: _macOSRuntime, ...env } = audit.env;
    expect(env).toEqual(jobEnvironment(env["HOME"]!));
    expect(join(await realpath(dirname(env["HOME"]!)), basename(env["HOME"]!))).toBe(audit.cwd);
    expect(JSON.stringify(audit)).not.toMatch(
      /executor-secret|renderer-secret|parent-key|workspace\.test|session|grant/i,
    );
    await expect(access(audit.cwd)).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
  }
}, 20_000);

it.each([
  { fileName: "x.xlsx", exitCode: 7, signal: null },
  { fileName: "signal.xlsx", exitCode: null, signal: "SIGTERM" },
  { fileName: "large.xlsx", exitCode: 7, signal: null },
  { fileName: "invalid.xlsx", exitCode: null, signal: "SIGKILL" },
])(
  "preserves internal crash diagnostics for $fileName without leaking them to tool callers",
  async ({ fileName, exitCode, signal }) => {
    let crashed: unknown;
    try {
      await runConversionJob(
        { ...job, options: { ...job.options, fileName } },
        credentials,
        AbortSignal.timeout(5000),
        new URL("./fixtures/job-crash.mjs", import.meta.url),
      );
    } catch (error) {
      crashed = error;
    }
    expect(crashed).toBeInstanceOf(Error);
    if (!(crashed instanceof Error)) throw new Error("Expected a conversion crash");
    const diagnostics = z
      .object({
        jobKind: z.literal("import"),
        exitCode: z.number().nullable(),
        signal: z.string().nullable(),
        stderrTail: z.string(),
      })
      .parse(crashed.cause);
    expect(diagnostics).toMatchObject({ jobKind: "import", exitCode, signal });
    expect(diagnostics.stderrTail).toContain("native conversion failed");
    expect(diagnostics.stderrTail).toContain("fixture-secret");
    expect(diagnostics.stderrTail.endsWith("fixture-private-content\n")).toBe(true);
    expect(Buffer.byteLength(diagnostics.stderrTail)).toBeLessThanOrEqual(16 * 1024);
    if (fileName === "large.xlsx") {
      expect(Buffer.byteLength(diagnostics.stderrTail)).toBe(16 * 1024);
      expect(diagnostics.stderrTail).not.toContain("discarded-prefix");
    }
    if (fileName === "invalid.xlsx") expect(crashed.message).toContain("invalid result");
    expect(crashed.message).not.toContain("memory limit");
    expect(Object.getOwnPropertyDescriptor(crashed, "cause")?.enumerable).toBe(false);
    for (const effect of ["write", "read"] as const) {
      const wire = mapRuntimeError(crashed, effect);
      expect(wire).toMatchObject({
        code: "workspace-job-crashed",
        outcome: "tool_error",
        detail: null,
      });
      expect(JSON.stringify(wire)).not.toMatch(
        /native conversion failed|fixture-secret|fixture-private-content|stderrTail|exitCode|SIGTERM|SIGKILL/,
      );
    }
    expect(JSON.stringify(crashed)).not.toMatch(
      /fixture-secret|fixture-private-content|stderrTail/,
    );
  },
);

it.each(["read", "write"] as const)(
  "kills a hung child at the remaining %s deadline",
  async (effect) => {
    const controller = new AbortController();
    const { fork } = await vi.importActual<typeof childProcess>("node:child_process");
    const forked = vi.mocked(childProcess.fork).mockImplementation((...args) => {
      const child = fork(...args);
      child.once("message", () => controller.abort(timeoutError(effect)));
      return child;
    });
    try {
      await expect(
        runConversionJob(
          job,
          credentials,
          controller.signal,
          new URL("./fixtures/job-hang.mjs", import.meta.url),
        ),
      ).rejects.toMatchObject({
        wire: {
          code: effect === "read" ? "workspace-executor-timeout" : "workspace-result-unknown",
        },
      });
    } finally {
      forked.mockRestore();
    }
  },
);

it("round trips docx text through short-lived native conversion jobs", async () => {
  const entry = new URL("./fixtures/job-audit.mjs", import.meta.url);
  const bytes = await runConversionJob(
    {
      kind: "export",
      data: {
        id: "doc",
        documentStyle: {},
        body: { dataStream: "Office round trip hello\r\n", paragraphs: [{ startIndex: 23 }] },
      },
      options: { type: 1, format: ExchangeFormat.DOCX },
    },
    credentials,
    AbortSignal.timeout(15_000),
    entry,
  );
  const imported = await runConversionJob(
    { kind: "import", bytes, options: { fileName: "text.docx", type: 1 } },
    credentials,
    AbortSignal.timeout(15_000),
    entry,
  );
  expect(imported).toMatchObject({
    body: { dataStream: expect.stringContaining("Office round trip hello") },
    _audit: { connections: 0, credentialKeys: [], execArgv: ["--max-old-space-size=256"] },
  });
}, 20_000);
