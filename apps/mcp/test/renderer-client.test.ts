import { afterEach, describe, expect, it, vi } from "vitest";
import { createRendererClient } from "../src/executor/renderer-client.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from "../src/shared/frame.js";
import { zeroCost } from "../src/shared/usage.js";

const token = "renderer-token-".repeat(4);
const meta = { executor: "warm", cost: { ...zeroCost, render_pages: 1 } };
const output = {
  unitId: "u1",
  unitType: "sheet",
  images: [{ name: "a.png", mediaType: "image/png", width: 1, height: 1, offset: 0, size: 3 }],
};
const unit = { unitType: "sheet", unitData: { id: "u1" } } as const;

function client(options: { url?: string | null; remainingMs?: number } = {}) {
  return createRendererClient({
    url: options.url === null ? undefined : (options.url ?? "http://renderer.test:3000"),
    rendererToken: token,
    requestId: "req-1",
    deadlineAt: Date.now() + (options.remainingMs ?? 30_000),
    signal: new AbortController().signal,
  });
}
const frameResponse = (header: unknown, payload?: Uint8Array) =>
  new Response(new Uint8Array(encodeFrame(header, payload)));

afterEach(() => vi.restoreAllMocks());

describe("renderer client", () => {
  it("authenticates with the renderer token and sends only the operation input", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, options) =>
        frameResponse({ ok: true, output, meta }, new Uint8Array([1, 2, 3])),
      );
    const result = await client().call("screenshot", unit);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("http://renderer.test:3000/rpc/v1/screenshot");
    expect(options?.headers).toEqual({
      authorization: `Bearer ${token}`,
      "content-type": FRAME_CONTENT_TYPE,
      "x-mcp-rpc-version": "1",
    });
    const request = decodeFrame(Buffer.from(options?.body as Uint8Array));
    expect(request.header).toEqual({
      v: 1,
      op: "screenshot",
      requestId: "req-1",
      deadlineMs: expect.any(Number),
      input: unit,
    });
    expect(request.payload).toHaveLength(0);
    expect(result.output).toEqual(output);
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(result.meta.cost.render_pages).toBe(1);
  });

  it("fails without a configured renderer, without retrying", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    await expect(client({ url: null }).call("screenshot", unit)).rejects.toMatchObject({
      wire: {
        code: "workspace-renderer-not-configured",
        outcome: "tool_error",
        detail: { retryable: false },
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes renderer errors through with their codes", async () => {
    const wire = {
      code: "workspace-render-input-invalid",
      message: "Bad range",
      detail: { reason: "INVALID_INPUT" },
      outcome: "tool_error",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      frameResponse({ ok: false, error: wire, meta: { executor: "none", cost: { ...zeroCost } } }),
    );
    await expect(client().call("screenshot", unit)).rejects.toMatchObject({ wire });
  });

  it.each([
    [401, "workspace-renderer-unavailable", "internal_error"],
    [503, "workspace-renderer-unavailable", "tool_error"],
    [413, "workspace-request-too-large", "tool_error"],
    [426, "workspace-renderer-version-mismatch", "internal_error"],
  ])("maps HTTP %i to %s", async (status, code, outcome) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status }));
    await expect(client().call("screenshot", unit)).rejects.toMatchObject({
      wire: { code, outcome },
    });
  });

  it("maps a lost connection to a retryable unavailable and a timeout to a retryable timeout", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(refused);
    await expect(client().call("screenshot", unit)).rejects.toMatchObject({
      wire: { code: "workspace-renderer-unavailable", detail: { retryable: true } },
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    await expect(client().call("screenshot", unit)).rejects.toMatchObject({
      wire: { code: "workspace-renderer-timeout", outcome: "timeout" },
    });
    const fetcher = vi.spyOn(globalThis, "fetch");
    await expect(client({ remainingMs: 500 }).call("screenshot", unit)).rejects.toMatchObject({
      wire: { code: "workspace-renderer-timeout" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed and oversized responses", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => new Response("garbage"));
    await expect(client().call("screenshot", unit)).rejects.toMatchObject({
      wire: { code: "workspace-internal-error", outcome: "internal_error" },
    });
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () =>
      frameResponse({ ok: true, output: { ...output, unitId: 7 }, meta }),
    );
    await expect(client().call("screenshot", unit)).rejects.toMatchObject({
      wire: { code: "workspace-internal-error" },
    });
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      async () => new Response(new Uint8Array(16 * 1024 + 1)),
    );
    await expect(client().call("measureText", { doc: { id: "d" } })).rejects.toMatchObject({
      wire: { code: "workspace-result-too-large" },
    });
  });

  it("reads the renderer URL from the executor configuration", () => {
    const env = { WORKSPACE_ORIGIN: "https://workspace.test", MCP_EXECUTOR_TOKEN: "executor-token-".repeat(4) };
    expect(parseExecutorConfig(env).MCP_RENDERER_URL).toBeUndefined();
    expect(
      parseExecutorConfig({ ...env, MCP_RENDERER_URL: "http://renderer:3000", MCP_RENDERER_TOKEN: token }).MCP_RENDERER_URL,
    ).toBe("http://renderer:3000");
    for (const invalid of [
      { MCP_RENDERER_URL: "http://renderer:3000" },
      { MCP_RENDERER_TOKEN: token },
      { MCP_RENDERER_URL: "http://renderer:3000", MCP_RENDERER_TOKEN: "short" },
      { MCP_RENDERER_URL: "http://renderer/x", MCP_RENDERER_TOKEN: token },
    ]) expect(() => parseExecutorConfig({ ...env, ...invalid })).toThrow();
    expect(() => parseExecutorConfig({
      ...env, MCP_RENDERER_URL: "http://renderer:3000", MCP_RENDERER_TOKEN: env.MCP_EXECUTOR_TOKEN,
    })).toThrow(/must differ/);
  });
});
