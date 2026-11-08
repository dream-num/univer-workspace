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
  vi.stubEnv("MCP_INTERNAL_TOKEN", "internal-secret");
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
      /internal-secret|parent-key|workspace\.test|session|grant/i,
    );
    await expect(access(audit.cwd)).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
  }
}, 20_000);

it("reports a crashed conversion as a tool error before any write", async () => {
  let crashed: unknown;
  try {
    await runConversionJob(
      job,
      credentials,
      AbortSignal.timeout(5000),
      new URL("./fixtures/job-crash.mjs", import.meta.url),
    );
  } catch (error) {
    crashed = error;
  }
  expect(mapRuntimeError(crashed, "write")).toMatchObject({
    code: "workspace-job-crashed",
    outcome: "tool_error",
  });
  expect(mapRuntimeError(crashed, "read")).toMatchObject({
    code: "workspace-job-crashed",
    outcome: "tool_error",
  });
});

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
