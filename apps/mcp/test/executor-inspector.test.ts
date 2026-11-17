import { createWorkspaceContentRuntime } from "@univerjs/univer-workspace-client-core";
import { describe, expect, it } from "vitest";
import { runConversionJob } from "../src/executor/jobs/run.js";
import { workerEnvironment } from "../src/executor/runtime.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";

describe("executor processes and the Node inspector", () => {
  it("keeps the inspector closed in an execute worker that receives SIGUSR1", async () => {
    const runtime = createWorkspaceContentRuntime({
      resolveCredential: () => "cookie",
      resolveLicense: () => "license",
      workerEntry: new URL("./fixtures/script-worker.mjs", import.meta.url),
      pool: { env: workerEnvironment },
    });
    try {
      const { value } = await runtime.executeRead({
        code: `
          const inspector = process.getBuiltinModule("node:inspector");
          process.debugPort = 0;
          process.kill(process.pid, "SIGUSR1");
          const started = Date.now();
          while (inspector.url() === undefined && Date.now() - started < 1000)
            await new Promise((resolve) => setTimeout(resolve, 20));
          return inspector.url() === undefined ? "closed" : "open";`,
        target: {
          origin: "http://127.0.0.1:1",
          revision: 7,
          scope: { kind: "worktree", worktreeId: "wt" },
          unitId: "unit-1",
          unitType: "sheet",
        },
      });
      expect(value).toBe("closed");
    } finally {
      await runtime.close();
    }
  });

  it("keeps the inspector closed in a conversion job that receives SIGUSR1", async () => {
    const result = await runConversionJob(
      { kind: "import", bytes: new Uint8Array([0]), options: { fileName: "x.xlsx", type: 2 } },
      { license: "license", licenseKey: "key" },
      AbortSignal.timeout(10_000),
      new URL("./fixtures/job-inspector.mjs", import.meta.url),
    );
    expect(result).toEqual({ inspector: "closed" });
  });

  it("refuses Node inspector flags on the production executor", () => {
    const env = {
      WORKSPACE_ORIGIN: "https://workspace.test",
      MCP_EXECUTOR_TOKEN: "executor-token-".repeat(4),
      MCP_EXECUTOR_ALLOWED_USER_IDS: "alice",
    };
    const production = { ...env, NODE_ENV: "production" };
    for (const flag of [
      "--inspect",
      "--inspect=0.0.0.0:9229",
      "--inspect-brk",
      "--inspect-port=0",
    ]) {
      expect(() => parseExecutorConfig(production, [flag])).toThrow(/inspector/);
      expect(() =>
        parseExecutorConfig({ ...production, NODE_OPTIONS: `--max-old-space-size=512 ${flag}` }),
      ).toThrow(/inspector/);
      expect(parseExecutorConfig({ ...env, NODE_OPTIONS: flag }, [flag]).PORT).toBe(3000);
    }
    expect(
      parseExecutorConfig({ ...production, NODE_OPTIONS: "--disable-sigusr1" }, [
        "--disable-sigusr1",
      ]).PORT,
    ).toBe(3000);
  });
});
