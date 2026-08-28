import { describe, expect, it, vi } from "vitest";
import { WorkspaceHttp } from "../src/index.js";

describe("Workspace HTTP transport", () => {
  it.each([
    "not-a-url",
    "ftp://workspace.test",
    "https://user:secret@workspace.test",
    "https://workspace.test/api",
    "https://workspace.test?query=1",
    "https://workspace.test#fragment",
  ])("rejects invalid Workspace origin %s", (origin) => {
    expect(
      () => new WorkspaceHttp({ cookie: "session=x", origin, role: "client" }),
    ).toThrowError(expect.objectContaining({ code: "workspace-origin-invalid" }));
  });

  it("rejects cross-origin requests before sending the Session cookie", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const http = new WorkspaceHttp({
      cookie: "session=x",
      fetcher,
      origin: "https://workspace.test/",
      role: "client",
    });

    expect(http.origin).toBe("https://workspace.test");
    await expect(http.request("https://other.test/api/spaces")).rejects.toMatchObject({
      code: "workspace-origin-mismatch",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["username", "https://user@workspace.test/api/spaces"],
    ["password", "https://:secret@workspace.test/api/spaces"],
  ])("rejects same-origin request URLs containing a %s before fetch", async (_kind, path) => {
    const fetcher = vi.fn<typeof fetch>();
    const http = new WorkspaceHttp({
      cookie: "session=x",
      fetcher,
      origin: "https://workspace.test",
      role: "client",
    });

    await expect(http.request(path)).rejects.toMatchObject({
      code: "workspace-origin-mismatch",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the current role, Cookie, Origin, body and idempotency key", async () => {
    let request: Request | undefined;
    const http = new WorkspaceHttp({
      cookie: "session=x",
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ ok: true });
      },
      origin: "https://workspace.test",
      role: "client",
    });

    await expect(
      http.json("/api/nodes", {
        body: { name: "Plan" },
        idempotencyKey: "request-1",
        method: "POST",
      }),
    ).resolves.toEqual({ ok: true });
    expect(request?.url).toBe("https://workspace.test/api/nodes");
    expect(request?.headers.get("cookie")).toBe("session=x");
    expect(request?.headers.get("origin")).toBe("https://workspace.test");
    expect(request?.headers.get("idempotency-key")).toBe("request-1");
    expect(request?.headers.get("x-univer-cli-sdk-role")).toBe("client");
    await expect(request?.json()).resolves.toEqual({ name: "Plan" });
  });

  it("preserves numeric service codes and response scope diagnostics", async () => {
    const http = new WorkspaceHttp({
      cookie: "session=x",
      fetcher: async () =>
        new Response(JSON.stringify({ error: { code: 40901, message: "conflict" } }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      origin: "https://workspace.test",
      role: "client",
    });
    await expect(http.json("/api/nodes")).rejects.toMatchObject({
      code: "40901",
      detail: { path: "/api/nodes", status: 409 },
      message: "conflict",
    });
  });

  it("distinguishes interrupted, invalid JSON and non-object response bodies", async () => {
    const responses = [
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("body interrupted"));
          },
        }),
      ),
      new Response("not-json"),
      Response.json(["not", "an", "object"]),
    ];
    const http = new WorkspaceHttp({
      cookie: "session=x",
      fetcher: async () => responses.shift()!,
      origin: "https://workspace.test",
      role: "client",
    });

    await expect(http.json("/api/one")).rejects.toMatchObject({
      code: "workspace-result-unknown",
    });
    await expect(http.json("/api/two")).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
    await expect(http.json("/api/three")).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
  });

  it("adapts authenticated same-origin requests without hiding Collaboration HTTP status", async () => {
    let request: Request | undefined;
    const http = new WorkspaceHttp({
      cookie: "session=x",
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return new Response(null, { status: 409 });
      },
      origin: "https://workspace.test",
      role: "worker",
    });

    const response = await http.collaborationRequest("https://workspace.test/comb", {
      body: "{}",
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(request?.headers.get("cookie")).toBe("session=x");
    expect(request?.headers.get("origin")).toBe("https://workspace.test");
    expect(request?.headers.get("x-univer-cli-sdk-role")).toBe("worker");
    expect(request?.headers.get("x-univer-cli-sdk-worker-pid")).toBe(String(process.pid));
    await expect(http.collaborationRequest("https://other.test/comb")).rejects.toMatchObject({
      code: "workspace-origin-mismatch",
    });
  });

  it.each([
    ["username", "https://user@workspace.test/comb"],
    ["password", "https://:secret@workspace.test/comb"],
  ])("rejects Collaboration URLs containing a %s before fetch", async (_kind, path) => {
    const fetcher = vi.fn<typeof fetch>();
    const http = new WorkspaceHttp({
      cookie: "session=x",
      fetcher,
      origin: "https://workspace.test",
      role: "client",
    });

    await expect(http.collaborationRequest(path)).rejects.toMatchObject({
      code: "workspace-request-invalid",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses redirects and does not forward Cookies to cross-origin Asset URLs", async () => {
    const cookies: Array<string | null> = [];
    const http = new WorkspaceHttp({
      cookie: "session=x",
      fetcher: async (_input, init) => {
        cookies.push(new Headers(init?.headers).get("cookie"));
        return cookies.length === 1
          ? new Response(null, { status: 302, headers: { location: "https://other.test" } })
          : new Response("asset", { headers: { "content-type": "text/plain" } });
      },
      origin: "https://workspace.test",
      role: "client",
    });
    await expect(http.request("/redirect")).rejects.toMatchObject({
      code: "workspace-redirect-refused",
    });
    await expect(http.content(new URL("https://cdn.test/asset"))).resolves.toBeInstanceOf(Response);
    expect(cookies).toEqual(["session=x", null]);
  });

  it("rejects unsafe Asset content URLs before fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const http = new WorkspaceHttp({
      cookie: "session=x",
      fetcher,
      origin: "https://workspace.test",
      role: "client",
    });

    await expect(http.content(new URL("file:///tmp/asset"))).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
    await expect(http.content(new URL("https://user:secret@cdn.test/asset"))).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
