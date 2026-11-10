import { pino } from "pino";
import { expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { createDispatcher } from "../src/executor/dispatch.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import { zeroCost } from "../src/shared/usage.js";

const { runConversionJob } = vi.hoisted(() => ({ runConversionJob: vi.fn() }));
vi.mock("../src/executor/jobs/run.js", () => ({ runConversionJob }));

it("reports cold_start and no Unit/runtime costs for a compile-only Typst job", async () => {
  runConversionJob.mockResolvedValue({
    committed: false,
    javascript: "return 1",
    targetUnitId: "target",
    title: "Title",
    diagnostics: [],
    previews: [],
  });
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ authenticated: true, user: { id: "owner", displayName: "Owner" } }),
  );
  try {
    const runtime = {
      executeRead: vi.fn(),
      executeAndCommit: vi.fn(),
      exportUnitData: vi.fn(),
      close: vi.fn(),
    };
    const dispatch = createDispatcher(
      parseExecutorConfig({
        WORKSPACE_ORIGIN: "http://workspace.test",
        MCP_EXECUTOR_TOKEN: "token".repeat(10),
      }),
      runtime,
      pino({ level: "silent" }),
    );
    const result = await dispatch("typst.compile", {
      v: 1,
      op: "typst.compile",
      requestId: "compile-only",
      deadlineMs: 15000,
      grant: {
        kind: "session",
        userId: "owner",
        session: "session",
        expiresAt: Date.now() + 60000,
      },
      input: {},
    }, zipSync({ "typst.json": Buffer.from("{}") }));
    expect(result.header).toMatchObject({
      ok: true,
      meta: { executor: "cold_start", cost: zeroCost },
    });
    expect(result.header.meta.unitType).toBeUndefined();
    expect(result.header.meta.repo).toBeUndefined();
    expect(runConversionJob).toHaveBeenCalledExactlyOnceWith(
      { kind: "typst.compile", bundle: expect.any(Map) },
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      expect.any(Number),
    );
    expect(runtime.executeRead).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
