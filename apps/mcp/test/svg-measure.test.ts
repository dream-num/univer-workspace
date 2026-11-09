import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpContext } from "../src/executor/context.js";
import { svgCompile } from "../src/executor/ops/svg-compile.js";
import { createRendererClient } from "../src/executor/renderer-client.js";
import { decodeFrame, encodeFrame } from "../src/shared/frame.js";
import { zeroCost } from "../src/shared/usage.js";

const token = "internal-token-".repeat(4);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100">' +
  '<text x="10" y="40" font-size="20" font-family="Arial">Hello 世界</text></svg>';
const metrics = {
  actualHeight: 24,
  actualWidth: 77,
  firstLineAscent: 18,
  firstLineDescent: 6,
  lineCount: 1,
};
const meta = { executor: "warm", cost: { ...zeroCost } };

afterEach(() => vi.restoreAllMocks());

function setup(configured = true) {
  const rendererFetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () => new Response(new Uint8Array(encodeFrame({ ok: true, output: metrics, meta }))),
    );
  const ctx: OpContext = {
    http: vi.fn() as never,
    source: vi.fn() as never,
    userId: "owner",
    requestId: "svg",
    transportOrigin: "https://workspace.test",
    signal: new AbortController().signal,
    usage: { executor: "none", cost: { ...zeroCost } },
    runtime: { executeRead: vi.fn(), executeAndCommit: vi.fn(), exportUnitData: vi.fn() },
    exchange: { license: "", licenseKey: "" },
    renderer: createRendererClient({
      url: configured ? "http://renderer:3000" : undefined,
      internalToken: token,
      requestId: "svg",
      deadlineAt: Date.now() + 30_000,
      signal: new AbortController().signal,
    }),
  };
  return { ctx, rendererFetch };
}

describe("svg.compile text measurement", () => {
  it("measures every line through the renderer without estimate_text_size", async () => {
    const f = setup();
    const { output } = await svgCompile(f.ctx, { svg }, new Uint8Array());
    expect(output.textMeasure).toBe("univer-render-runtime");
    expect(output.lints.join("\n")).not.toContain("estimat");
    const [url, options] = f.rendererFetch.mock.calls[0]!;
    expect(String(url)).toBe("http://renderer:3000/rpc/v1/measureText");
    const header = decodeFrame(Buffer.from(options?.body as Uint8Array)).header as {
      op: string;
      input: { doc: { body: { dataStream: string } } };
    };
    expect(header.op).toBe("measureText");
    expect(header.input.doc.body.dataStream).toContain("世界");
  });

  it("keeps the built-in estimate and never calls the renderer with estimate_text_size", async () => {
    const f = setup();
    const { output } = await svgCompile(f.ctx, { svg, estimateTextSize: true }, new Uint8Array());
    expect(output.textMeasure).not.toBe("univer-render-runtime");
    expect(output.lints.join("\n")).toContain("estimat");
    expect(f.rendererFetch).not.toHaveBeenCalled();
  });

  it("maps a renderer error to its tool error", async () => {
    const f = setup();
    f.rendererFetch.mockImplementation(
      async () =>
        new Response(
          new Uint8Array(
            encodeFrame({
              ok: false,
              error: {
                code: "workspace-argument-invalid",
                message: "bad doc",
                detail: null,
                outcome: "tool_error",
              },
              meta,
            }),
          ),
        ),
    );
    await expect(svgCompile(f.ctx, { svg }, new Uint8Array())).rejects.toMatchObject({
      wire: { code: "workspace-argument-invalid", outcome: "tool_error" },
    });
  });

  it("maps an unreachable renderer to a retryable tool error", async () => {
    const f = setup();
    f.rendererFetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(svgCompile(f.ctx, { svg }, new Uint8Array())).rejects.toMatchObject({
      wire: { code: "workspace-renderer-unavailable", detail: { retryable: true } },
    });
  });

  it("fails non-retryably when no renderer is configured, but still estimates", async () => {
    const f = setup(false);
    await expect(svgCompile(f.ctx, { svg }, new Uint8Array())).rejects.toMatchObject({
      wire: { code: "workspace-renderer-not-configured", detail: { retryable: false } },
    });
    expect(f.rendererFetch).not.toHaveBeenCalled();
    await expect(
      svgCompile(f.ctx, { svg, estimateTextSize: true }, new Uint8Array()),
    ).resolves.toBeDefined();
  });
});
