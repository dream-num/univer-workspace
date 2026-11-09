import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeFrame,
  envelope,
  executorToken,
  fixture,
  rendererToken,
  rpcHeader,
  send,
  svg,
} from "./harness.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});
async function start(controlRenderer = false) {
  const f = await fixture(controlRenderer);
  cleanup.push(() => f.close());
  return f;
}
const writeInput = { worktreeId: "wt", unitId: "unit", code: "increment the current value" };
const applyInput = {
  svg,
  page: 1,
  apply: true,
  worktreeId: "wt",
  unitId: "unit",
  estimateTextSize: true,
};

describe.skipIf(!!process.env.MCP_CONTRACT_URL)(
  "§15 controlled dependency checks (deployed mode cannot control Workspace, runtime or renderer)",
  () => {
    it("§8.2 executes one write once and advances its Unit revision exactly once", async () => {
      const f = await start();
      f.state.unitType = "sheet";
      const before = f.state.revision;
      const response = await send(f.executorUrl, executorToken, "content.execute", {
        body: encodeFrame(rpcHeader("executor", "content.execute", writeInput)),
      });
      expect(response.status).toBe(200);
      expect(envelope(response.bytes)).toMatchObject({
        ok: true,
        output: { committed: true, revision: before + 1 },
      });
      expect(f.state.revision).toBe(before + 1);
      expect(f.state.writes).toBe(1);
    });

    it("§4.5 truncates committed content.execute values while preserving the commit", async () => {
      const f = await start();
      f.state.value = "x".repeat(8 * 1024 * 1024);
      const response = await send(f.executorUrl, executorToken, "content.execute", {
        body: encodeFrame(rpcHeader("executor", "content.execute", writeInput)),
      });
      const parsed = envelope(response.bytes);
      expect(parsed).toMatchObject({
        ok: true,
        output: { committed: true, revision: 8, status: "committed", valueTruncated: true },
      });
      if (!parsed.ok) throw new Error("Expected committed result");
      expect(parsed.output).not.toHaveProperty("value");
      expect(f.state.writes).toBe(1);
    });

    it("§4.5 returns a non-retryable committed error for oversized successful SVG apply", async () => {
      const f = await start();
      f.state.value = "x".repeat(8 * 1024 * 1024);
      const response = await send(f.executorUrl, executorToken, "svg.compile", {
        body: encodeFrame(rpcHeader("executor", "svg.compile", applyInput)),
      });
      expect(response.status).toBe(200);
      expect(envelope(response.bytes)).toMatchObject({
        ok: false,
        error: {
          code: "workspace-result-too-large",
          outcome: "tool_error",
          detail: { committed: true, retryable: false },
          message: expect.stringMatching(/Read the current state instead of repeating the write/),
        },
        meta: { cost: { committed_revisions: 1 } },
      });
      expect(f.state.revision).toBe(8);
      expect(f.state.writes).toBe(1);
    });

    it("§4.5 keeps oversized executor reads retryable by narrowing, without a committed marker", async () => {
      const f = await start();
      f.state.value = "x".repeat(8 * 1024 * 1024);
      const response = await send(f.executorUrl, executorToken, "content.inspect", {
        body: encodeFrame(
          rpcHeader("executor", "content.inspect", {
            scope: { kind: "worktree", worktreeId: "wt" },
            unitId: "unit",
            target: "presentation",
          }),
        ),
      });
      expect(response.status).toBe(200);
      expect(envelope(response.bytes)).toMatchObject({
        ok: false,
        error: { code: "workspace-result-too-large", detail: null, outcome: "tool_error" },
      });
      expect(f.state.reads).toBe(1);
      expect(f.state.writes).toBe(0);
    });

    it("§4.5 returns the read error envelope when a renderer result exceeds responseBytes", async () => {
      const f = await start();
      f.state.pngBytes = Buffer.alloc(64 * 1024 * 1024);
      const response = await send(f.rendererUrl, rendererToken, "screenshot", {
        body: encodeFrame(
          rpcHeader("renderer", "screenshot", {
            unitType: "sheet",
            unitData: { id: "unit", name: "Sheet" },
          }),
        ),
      });
      expect(response.status).toBe(200);
      expect(envelope(response.bytes)).toMatchObject({
        ok: false,
        error: { code: "workspace-result-too-large", detail: null, outcome: "tool_error" },
      });
    });

    it("§6.2, §6.3 includes a 1500 ms upload in the 2000 ms deadline while Workspace never answers", async () => {
      const f = await start();
      f.state.hangWorkspace = true;
      const body = encodeFrame({
        ...rpcHeader("executor", "content.execute", writeInput),
        deadlineMs: 2000,
      });
      const began = performance.now();
      const response = await send(f.executorUrl, executorToken, "content.execute", {
        chunks: [{ bytes: body.subarray(0, 4) }, { bytes: body.subarray(4), waitMs: 1500 }],
      });
      expect(performance.now() - began).toBeLessThanOrEqual(3000);
      expect(envelope(response.bytes)).toMatchObject({
        ok: false,
        error: {
          code: "workspace-executor-timeout",
          detail: { retryable: true, started: false },
          outcome: "timeout",
        },
      });
      expect(f.state.writes).toBe(0);
    });

    it("§6.2 never starts an executor operation whose budget expired during upload", async () => {
      const f = await start();
      const body = encodeFrame({
        ...rpcHeader("executor", "content.execute", writeInput),
        deadlineMs: 50,
      });
      const response = await send(f.executorUrl, executorToken, "content.execute", {
        chunks: [{ bytes: body.subarray(0, 4) }, { bytes: body.subarray(4), waitMs: 100 }],
      });
      expect(envelope(response.bytes)).toMatchObject({
        ok: false,
        error: { code: "workspace-executor-timeout", detail: { started: false } },
      });
      expect(f.state.workspaceCalls).toBe(0);
      expect(f.state.writes).toBe(0);
    });

    it("§6.2 counts renderer upload time and does not lease a runtime after expiry", async () => {
      const f = await start();
      const body = encodeFrame({
        ...rpcHeader("renderer", "measureText", {
          doc: { id: "d", body: { dataStream: "Hello\r\n" } },
        }),
        deadlineMs: 50,
      });
      const response = await send(f.rendererUrl, rendererToken, "measureText", {
        chunks: [{ bytes: body.subarray(0, 4) }, { bytes: body.subarray(4), waitMs: 100 }],
      });
      expect(envelope(response.bytes)).toMatchObject({
        ok: false,
        error: {
          code: "workspace-renderer-timeout",
          detail: { retryable: true },
          outcome: "timeout",
        },
      });
      expect(f.state.measurements).toBe(0);
    });

    it("§6.3 reports a queued content.execute as not started, and a leased write as unknown", async () => {
      const f = await start();
      f.state.hangWrite = true;
      const first = send(f.executorUrl, executorToken, "content.execute", {
        body: encodeFrame({
          ...rpcHeader("executor", "content.execute", writeInput),
          deadlineMs: 1000,
        }),
      });
      await expect.poll(() => f.state.writes).toBe(1);
      const second = await send(f.executorUrl, executorToken, "content.execute", {
        body: encodeFrame({
          ...rpcHeader("executor", "content.execute", writeInput),
          deadlineMs: 50,
        }),
      });
      expect(envelope(second.bytes)).toMatchObject({
        ok: false,
        error: { code: "workspace-executor-timeout", detail: { started: false, retryable: true } },
      });
      expect(envelope((await first).bytes)).toMatchObject({
        ok: false,
        error: { code: "workspace-result-unknown", detail: { retryable: false } },
      });
      expect(f.state.writes).toBe(1);
    });

    it("§3.1 refreshes renderer declarations, retains them on failure, and excludes incompatible versions", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const f = await start(true);
      const declared = async () => {
        const response = await send(f.executorUrl, executorToken, "capabilities", {
          method: "GET",
        });
        return JSON.parse(response.bytes.toString()).operations as string[];
      };
      const compile = async () =>
        envelope(
          (
            await send(f.executorUrl, executorToken, "svg.compile", {
              body: encodeFrame(rpcHeader("executor", "svg.compile", { svg })),
            })
          ).bytes,
        );
      expect(await declared()).toEqual(
        expect.arrayContaining([
          "render.screenshot",
          "render.printPdf",
          "render.lint",
          "svg.compile",
        ]),
      );
      expect(await compile()).toMatchObject({
        ok: true,
        output: { textMeasure: "univer-render-runtime" },
      });
      f.state.rendererOperations = ["screenshot", "unknown-operation"];
      await vi.advanceTimersByTimeAsync(60_000);
      await expect.poll(declared).not.toContain("render.printPdf");
      expect(await declared()).toContain("render.screenshot");
      expect(await declared()).not.toContain("render.lint");
      expect(await compile()).toMatchObject({
        ok: true,
        output: { textMeasure: "builtin-estimate" },
      });
      const measured = f.state.measurements;
      f.state.rendererStatus = 503;
      await vi.advanceTimersByTimeAsync(60_000);
      await expect.poll(() => f.state.rendererCapabilityCalls).toBe(3);
      expect(await declared()).toContain("render.screenshot");
      f.state.rendererStatus = 200;
      f.state.rendererVersion = 2;
      await vi.advanceTimersByTimeAsync(60_000);
      await expect.poll(declared).not.toContain("render.screenshot");
      expect(await declared()).toContain("svg.compile");
      expect(await compile()).toMatchObject({
        ok: true,
        output: { textMeasure: "builtin-estimate" },
      });
      expect(f.state.measurements).toBe(measured);
      f.state.rendererVersion = 1;
      f.state.rendererOperations = ["printPdf", "lint", "measureText"];
      await vi.advanceTimersByTimeAsync(60_000);
      await expect.poll(declared).toContain("render.printPdf");
      expect(await declared()).toContain("render.lint");
      expect(await declared()).not.toContain("render.screenshot");
      expect(await compile()).toMatchObject({
        ok: true,
        output: { textMeasure: "univer-render-runtime" },
      });
    });

    it("§3.1 capability discovery refuses redirects and retains an empty declaration", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const f = await start(true);
      await send(f.executorUrl, executorToken, "capabilities", { method: "GET" });
      f.state.rendererVersion = 2;
      await vi.advanceTimersByTimeAsync(60_000);
      await expect
        .poll(
          async () =>
            JSON.parse(
              (
                await send(f.executorUrl, executorToken, "capabilities", { method: "GET" })
              ).bytes.toString(),
            ).operations,
        )
        .not.toContain("render.screenshot");
      f.state.rendererVersion = 1;
      f.state.rendererRedirect = true;
      await vi.advanceTimersByTimeAsync(60_000);
      await expect.poll(() => f.state.rendererCapabilityCalls).toBe(3);
      const response = await send(f.executorUrl, executorToken, "capabilities", { method: "GET" });
      expect(JSON.parse(response.bytes.toString()).operations).not.toContain("render.screenshot");
    });
  },
);
