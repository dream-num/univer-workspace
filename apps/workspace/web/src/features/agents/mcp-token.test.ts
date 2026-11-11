import { describe, expect, it, vi } from "vitest";
import { createMcpTokenSource } from "./mcp-token";
import { deferred } from "./test-helpers";

describe("MCP tokens", () => {
  it.each(["ask", "auto"] as const)("issues %s scopes and revokes every issued token", async (mode) => {
    let time = 1000;
    let issued = 0;
    const request = vi.fn<typeof fetch>(async (_url, init) => init?.method === "DELETE" ? new Response(null, { status: 204 })
      : Response.json({ token: `token-${++issued}`, record: { id: `id-${issued}` } }));
    const source = createMcpTokenSource({ mode, fetch: request, now: () => time });
    expect(await source.token()).toBe("token-1");
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ name: "Workspace Agents", scopes: mode === "ask" ? ["read"] : ["read", "write"], expiresAt: 3_601_000 });
    time += 3_539_999;
    expect(await source.token()).toBe("token-1");
    time++;
    expect(await source.token()).toBe("token-2");
    source.invalidate();
    expect(await source.token()).toBe("token-3");
    time += 3_600_001;
    expect(await source.token()).toBe("token-4");
    await source.dispose();
    expect(request.mock.calls.filter((call) => call[1]?.method === "DELETE").map((call) => call[0]))
      .toEqual(["/api/auth/tokens/id-1", "/api/auth/tokens/id-2", "/api/auth/tokens/id-3", "/api/auth/tokens/id-4"]);
    await expect(source.token()).rejects.toThrow("disposed");
  });

  it("refreshes rather than caching a token invalidated while issuance is pending", async () => {
    const issued = deferred<Response>();
    const request = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => issued.promise)
      .mockResolvedValueOnce(Response.json({ token: "fresh", record: { id: "new" } }))
      .mockResolvedValue(new Response(null, { status: 204 }));
    const source = createMcpTokenSource({ mode: "ask", fetch: request });
    const pending = source.token();
    source.invalidate();
    issued.resolve(Response.json({ token: "stale", record: { id: "old" } }));
    expect(await pending).toBe("fresh");
    expect(await source.token()).toBe("fresh");
    expect(request).toHaveBeenCalledTimes(2);
    await source.dispose();
  });

  it("shares concurrent requests and revokes a token issued during disposal", async () => {
    const issued = deferred<Response>();
    const request = vi.fn<typeof fetch>(async (_url, init) => init?.method === "DELETE" ? new Response(null, { status: 204 }) : issued.promise);
    const source = createMcpTokenSource({ mode: "auto", fetch: request });
    const one = source.token();
    const two = source.token();
    const results = Promise.allSettled([one, two]);
    const disposed = source.dispose();
    issued.resolve(Response.json({ token: "token", record: { id: "id" } }));
    await disposed;
    expect((await results).every((result) => result.status === "rejected")).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
