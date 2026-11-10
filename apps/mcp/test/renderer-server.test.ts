import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer } from "../src/renderer/server.js";
import type { RenderRuntime } from "../src/renderer/ops.js";
import { parseRendererConfig } from "../src/shared/config-renderer.js";
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from "../src/shared/frame.js";
import {
  printPdfInput,
  rendererOpSpecs,
  rendererRequestHeaderSchema,
  screenshotInput,
} from "../src/shared/renderer-protocol.js";

const token = "renderer-token-".repeat(4);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);
const sheet = { unitType: "sheet", unitData: { id: "u1", name: "Sheet" } };

function fakeRuntime(overrides: Partial<Record<keyof RenderRuntime, unknown>> = {}) {
  return {
    close: vi.fn(() => Promise.resolve()),
    measureText: vi.fn(() =>
      Promise.resolve({
        actualHeight: 20,
        actualWidth: 48,
        firstLineAscent: 15,
        firstLineDescent: 5,
        lineCount: 1,
      }),
    ),
    render: vi.fn(() => Promise.resolve({ bytes: png, width: 1, height: 1 })),
    ...overrides,
  } as unknown as RenderRuntime;
}

const started: Array<ReturnType<typeof createRenderer>> = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((renderer) => renderer.close()));
});

async function start(runtime = fakeRuntime(), env: Record<string, string> = {}) {
  const create = vi.fn(() => Promise.resolve(runtime));
  const renderer = createRenderer(parseRendererConfig({ MCP_RENDERER_TOKEN: token, ...env }), {
    createRuntime: create,
    logger: pino({ level: "silent" }),
  });
  started.push(renderer);
  renderer.server.listen(0, "127.0.0.1");
  await once(renderer.server, "listening");
  const base = `http://127.0.0.1:${(renderer.server.address() as AddressInfo).port}`;
  const call = async (op: string, input: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}/rpc/v1/${op}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": FRAME_CONTENT_TYPE,
        "x-mcp-rpc-version": "1",
        ...headers,
      },
      body: encodeFrame({ v: 1, op, requestId: "req-1", deadlineMs: 5_000, input }),
    });
    return response;
  };
  const frame = async (response: Response) =>
    decodeFrame(new Uint8Array(await response.arrayBuffer()));
  return { base, call, frame, create, runtime };
}

describe("renderer protocol", () => {
  it("validates each operation's input and the request envelope", () => {
    expect(Object.keys(rendererOpSpecs)).toEqual(["screenshot", "printPdf", "lint", "measureText"]);
    expect(screenshotInput.safeParse(sheet).success).toBe(true);
    expect(
      screenshotInput.safeParse({ ...sheet, target: { kind: "sheet-range", range: "A1:B2" } })
        .success,
    ).toBe(true);
    for (const invalid of [
      { unitType: "sheet" },
      { ...sheet, unitType: "chart" },
      { ...sheet, target: { kind: "sheet-range" } },
      { ...sheet, target: { kind: "sheet-viewport", scale: 0 } },
      { ...sheet, target: { kind: "sheet-viewport", extra: true } },
    ])
      expect(screenshotInput.safeParse(invalid).success).toBe(false);
    expect(printPdfInput.safeParse({ unitType: "doc", unitData: "text" }).success).toBe(false);
    expect(rendererOpSpecs.lint.input.safeParse({ ...sheet }).success).toBe(false);
    expect(rendererOpSpecs.measureText.input.safeParse({ doc: {}, wrapWidth: -1 }).success).toBe(
      false,
    );
    const header = { v: 1, op: "measureText", requestId: "r1", deadlineMs: 1000, input: {} };
    expect(rendererRequestHeaderSchema.safeParse(header).success).toBe(true);
    for (const invalid of [
      { ...header, v: 2 },
      { ...header, op: "nope" },
      { ...header, deadlineMs: 60_000 },
      { ...header, requestId: "bad id" },
    ])
      expect(rendererRequestHeaderSchema.safeParse(invalid).success).toBe(false);
  });

  it("requires the renderer token and configuration limits", () => {
    expect(() => parseRendererConfig({})).toThrow();
    expect(() => parseRendererConfig({ MCP_RENDERER_TOKEN: "short" })).toThrow();
    expect(parseRendererConfig({ MCP_RENDERER_TOKEN: token })).toMatchObject({
      RENDERER_MAX_RUNTIMES: 2,
      RENDERER_QUEUE_TIMEOUT_MS: 5_000,
      RENDERER_OPERATION_TIMEOUT_MS: 25_000,
    });
  });
});

describe("renderer RPC", () => {
  it("serves health, guards metrics and rejects bad transport", async () => {
    const { base, call } = await start(fakeRuntime(), { METRICS_TOKEN: "metrics" });
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    const metrics = await fetch(`${base}/metrics`, {
      headers: { authorization: "Bearer metrics" },
    });
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain("mcp_renderer_jobs_total");
    for (const authorization of ["", "Bearer wrong", `Bearer ${"executor-token-".repeat(4)}`])
      expect((await call("measureText", {}, { authorization })).status).toBe(401);
    expect((await call("measureText", {}, { "x-mcp-rpc-version": "2" })).status).toBe(426);
    expect((await call("measureText", {}, { "content-type": "text/plain" })).status).toBe(415);
    expect((await call("diagnostics.probe", {})).status).toBe(404);
    const hidden = await start();
    expect((await fetch(`${hidden.base}/metrics`)).status).toBe(404);
  });

  it("measures text through a leased runtime and reuses it for the next call", async () => {
    const { call, frame, create, runtime } = await start();
    const doc = { id: "d", body: { dataStream: "中文 Latin\r\n" } };
    const first = (await frame(await call("measureText", { doc }))).header as Record<
      string,
      unknown
    >;
    const second = (await frame(await call("measureText", { doc, wrapWidth: 100 })))
      .header as Record<string, unknown>;
    expect(first).toMatchObject({
      ok: true,
      output: { actualWidth: 48, lineCount: 1 },
      meta: { executor: "cold_start" },
    });
    expect(second).toMatchObject({ ok: true, meta: { executor: "warm" } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(runtime.measureText).toHaveBeenCalledWith(
      expect.objectContaining({ doc, wrapWidth: 100, signal: expect.any(AbortSignal) }),
    );
  });

  it("serves the first request warm after warm-up launched a runtime", async () => {
    const { call, frame, create } = await start();
    await started.at(-1)!.warm();
    const doc = { id: "d", body: { dataStream: "warm\r\n" } };
    expect((await frame(await call("measureText", { doc }))).header).toMatchObject({
      ok: true,
      meta: { executor: "warm" },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps serving when warm-up fails and starts a runtime on the first request", async () => {
    const { call, frame, create, runtime } = await start();
    create.mockRejectedValueOnce(new Error("browser missing"));
    create.mockResolvedValueOnce(runtime);
    await started.at(-1)!.warm();
    const doc = { id: "d", body: { dataStream: "cold\r\n" } };
    expect((await frame(await call("measureText", { doc }))).header).toMatchObject({
      ok: true,
      meta: { executor: "cold_start" },
    });
  });

  it("returns screenshot images as binary payloads with offsets", async () => {
    const { call, frame } = await start();
    const { header, payload } = await frame(await call("screenshot", sheet));
    expect(header).toMatchObject({
      ok: true,
      output: {
        unitId: "u1",
        unitType: "sheet",
        images: [{ mediaType: "image/png", offset: 0, size: png.length }],
      },
      meta: { cost: { render_pages: 1 } },
    });
    expect(Buffer.from(payload)).toEqual(png);
  });

  it("maps an argument error to a tool error and keeps the runtime", async () => {
    const { call, frame, runtime } = await start();
    const { header } = await frame(await call("screenshot", { unitType: "sheet" }));
    expect(header).toMatchObject({
      ok: false,
      error: { code: "workspace-argument-invalid", outcome: "tool_error" },
    });
    expect(runtime.close).not.toHaveBeenCalled();
  });

  it("maps an upstream input error to a tool error and keeps the runtime", async () => {
    const { call, frame, runtime } = await start();
    const { header } = await frame(
      await call("printPdf", { unitType: "base", unitData: { id: "b" } }),
    );
    expect(header).toMatchObject({
      ok: false,
      error: { code: "workspace-render-unit-unsupported", outcome: "tool_error" },
    });
    expect(runtime.close).not.toHaveBeenCalled();
  });

  it("discards the runtime after a browser failure and reports a retryable error", async () => {
    const runtime = fakeRuntime({
      measureText: vi.fn(() => Promise.reject(new Error("Target closed"))),
    });
    const { call, frame } = await start(runtime);
    const { header } = await frame(await call("measureText", { doc: { id: "d" } }));
    expect(header).toMatchObject({ ok: false, error: { outcome: "internal_error" } });
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("closes the pooled runtimes when the renderer shuts down", async () => {
    const { call, runtime } = await start();
    await call("measureText", { doc: { id: "d" } });
    const [renderer] = started;
    await renderer!.close();
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });
});
