import { describe, expect, it, vi } from "vitest";
import { createMcpTokenSource } from "./mcp-token";
import { deferred } from "./test-helpers";

const HOUR = 3_600_000;

describe("MCP tokens", () => {
  it.each(["ask", "auto", "publish"] as const)("requests %s scopes from the agent token endpoint and refreshes before expiry", async (mode) => {
    let time = 1000;
    let issued = 0;
    const request = vi.fn<typeof fetch>(async () => Response.json({ token: `uvw_at_${++issued}`, expiresAt: time + HOUR }));
    const source = createMcpTokenSource({ grant: mode, fetch: request, now: () => time });
    expect(await source.token()).toBe("uvw_at_1");
    expect(request.mock.calls[0]?.[0]).toBe("/api/auth/agent-token");
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ scopes: mode === "ask" ? ["read"] : ["read", mode === "publish" ? "publish" : "write"] });
    time += HOUR - 60_001;
    expect(await source.token()).toBe("uvw_at_1");
    time++;
    expect(await source.token()).toBe("uvw_at_2");
    source.invalidate();
    expect(await source.token()).toBe("uvw_at_3");
    await source.dispose();
    expect(request).toHaveBeenCalledTimes(3);
    await expect(source.token()).rejects.toThrow("disposed");
  });

  it("reports a refused request without retrying", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const source = createMcpTokenSource({ grant: "ask", fetch: request });
    await expect(source.token()).rejects.toThrow("HTTP 503");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refreshes rather than caching a token invalidated while issuance is pending", async () => {
    const issued = deferred<Response>();
    const request = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => issued.promise)
      .mockResolvedValueOnce(Response.json({ token: "uvw_at_fresh", expiresAt: Date.now() + HOUR }));
    const source = createMcpTokenSource({ grant: "ask", fetch: request });
    const pending = source.token();
    source.invalidate();
    issued.resolve(Response.json({ token: "uvw_at_stale", expiresAt: Date.now() + HOUR }));
    expect(await pending).toBe("uvw_at_fresh");
    expect(await source.token()).toBe("uvw_at_fresh");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("shares concurrent requests and drops a token that arrives after disposal", async () => {
    const issued = deferred<Response>();
    const request = vi.fn<typeof fetch>(() => issued.promise);
    const source = createMcpTokenSource({ grant: "auto", fetch: request });
    const results = Promise.allSettled([source.token(), source.token()]);
    const disposed = source.dispose();
    issued.resolve(Response.json({ token: "uvw_at_late", expiresAt: Date.now() + HOUR }));
    await disposed;
    expect((await results).every((result) => result.status === "rejected")).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
