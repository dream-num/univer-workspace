import { describe, expect, it, vi } from "vitest";
import {
  completeCliLogin,
  loginWithPassword,
  logout,
  type PendingCliLogin,
  startCliLogin,
  whoami,
  WorkspaceHttp,
} from "../src/index.js";
import { createGuestAgent, sessionIdentity } from "../src/product.js";

const origin = "https://workspace.test";
const fixedNow = 1_787_878_800_000;

describe("Workspace authentication protocol", () => {
  it("returns a password-authenticated Session without storing or forwarding it", async () => {
    let request: Request | undefined;
    const http = new WorkspaceHttp({
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return Response.json(
          { authenticated: true, user: { displayName: "Alice", id: "user-1" } },
          { headers: { "set-cookie": "workspace_session=test; Path=/; HttpOnly" } },
        );
      },
      origin,
      role: "client",
    });
    const password = ["test", "password"].join("-");

    await expect(loginWithPassword(http, { password, username: "alice" })).resolves.toEqual({
      cookie: "workspace_session=test",
      origin,
      subject: { id: "user-1", name: "Alice" },
    });
    expect(request?.url).toBe(`${origin}/api/auth/cli/password/login`);
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("cookie")).toBeNull();
    const body = (await request?.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["password", "username"]);
    expect(body["username"]).toBe("alice");
    expect(body["password"] === password).toBe(true);
  });

  it("retries the legacy password route once after a 404", async () => {
    const requests: Request[] = [];
    const http = new WorkspaceHttp({
      cookie: "workspace_session=existing",
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));
        return requests.length === 1
          ? new Response("Not found", { status: 404 })
          : Response.json(
              { authenticated: true, user: validUser() },
              { headers: { "set-cookie": "workspace_session=legacy; Path=/; HttpOnly" } },
            );
      },
      origin,
      role: "client",
    });
    const input = { username: "alice", password: "test-password" };

    await expect(loginWithPassword(http, input)).resolves.toMatchObject({ cookie: "workspace_session=legacy" });
    expect(requests.map((request) => request.url)).toEqual([
      `${origin}/api/auth/cli/password/login`, `${origin}/api/auth/password/login`,
    ]);
    for (const request of requests) {
      expect(request.method).toBe("POST");
      expect(request.headers.get("cookie")).toBeNull();
      await expect(request.json()).resolves.toEqual(input);
    }
  });

  it.each([401, 403, 429, 500])("does not retry password login after HTTP %s", async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(
      { error: { code: "LOGIN_FAILED", message: "Login failed" } }, { status },
    ));
    const http = new WorkspaceHttp({ fetcher, origin, role: "client" });

    await expect(loginWithPassword(http, { username: "alice", password: "wrong" }))
      .rejects.toMatchObject({ code: "LOGIN_FAILED", detail: { status, path: "/api/auth/cli/password/login" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops after a 404 from the legacy password route", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const http = new WorkspaceHttp({ fetcher, origin, role: "client" });

    await expect(loginWithPassword(http, { username: "alice", password: "test-password" }))
      .rejects.toMatchObject({ code: "HTTP_404", detail: { path: "/api/auth/password/login" } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing cookie", undefined, { authenticated: true, user: validUser() }],
    ["unauthenticated body", "workspace_session=test", { authenticated: false, user: validUser() }],
    ["missing id", "workspace_session=test", { authenticated: true, user: { displayName: "Alice" } }],
    ["invalid displayName", "workspace_session=test", { authenticated: true, user: { displayName: 1, id: "user-1" } }],
  ])("rejects a password response with %s", async (_case, cookie, body) => {
    const http = new WorkspaceHttp({
      fetcher: async () =>
        Response.json(body, { headers: cookie === undefined ? {} : { "set-cookie": cookie } }),
      origin,
      role: "client",
    });

    await expect(
      loginWithPassword(http, { password: ["test", "password"].join("-"), username: "alice" }),
    ).rejects.toMatchObject({ code: "workspace-invalid-response" });
  });

  it("starts a bounded browser approval with an absolute same-origin URL", async () => {
    let request: Request | undefined;
    const http = new WorkspaceHttp({
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return authorizationResponse();
      },
      origin: `${origin}/`,
      role: "client",
    });

    await expect(startCliLogin(http, () => fixedNow)).resolves.toEqual({
      deviceCode: "d".repeat(43),
      expiresAt: fixedNow + 600_000,
      origin,
      userCode: "ABCD-EFGH",
      verificationUrl: `${origin}/cli-login?userCode=ABCD-EFGH`,
    });
    expect(request?.url).toBe(`${origin}/api/auth/cli/authorizations`);
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("cookie")).toBeNull();
  });

  it.each([
    ["cross-origin", "https://other.test/cli-login"],
    ["username", "https://user@workspace.test/cli-login"],
    ["password", "https://:secret@workspace.test/cli-login"],
    ["invalid", "http://["],
  ])("rejects a %s verification URL after one request", async (_case, verificationUrl) => {
    const deviceCode = "d".repeat(43);
    const fetcher = vi.fn<typeof fetch>(async () =>
      authorizationResponse({ deviceCode, verificationUriComplete: verificationUrl }),
    );
    const http = new WorkspaceHttp({ fetcher, origin, role: "client" });

    const result = startCliLogin(http, () => fixedNow);
    await expect(result).rejects.toMatchObject({ code: "workspace-invalid-response" });
    await expect(result).rejects.not.toMatchObject({ message: expect.stringContaining(deviceCode) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["deviceCode", { deviceCode: "" }],
    ["userCode", { userCode: "" }],
    ["expiresIn", { expiresIn: 0 }],
    ["interval", { interval: 0 }],
  ])("rejects invalid browser approval field %s", async (_field, override) => {
    const http = new WorkspaceHttp({
      fetcher: async () => authorizationResponse(override),
      origin,
      role: "client",
    });
    await expect(startCliLogin(http, () => fixedNow)).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
  });

  it("rejects a non-finite browser approval expiry", async () => {
    const http = new WorkspaceHttp({
      fetcher: async () => authorizationResponse(),
      origin,
      role: "client",
    });
    await expect(startCliLogin(http, () => Number.POSITIVE_INFINITY)).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
  });

  it("completes one pending exchange without polling", async () => {
    let request: Request | undefined;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      request = new Request(input, init);
      return Response.json({ status: "pending" }, { status: 202 });
    });
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const http = new WorkspaceHttp({ fetcher, origin, role: "client" });
    try {
      await expect(completeCliLogin(http, pending(), () => fixedNow)).resolves.toEqual({
        status: "pending",
      });
    } finally {
      timeout.mockRestore();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(timeout).not.toHaveBeenCalled();
    expect(request?.url).toBe(`${origin}/api/auth/cli/authorizations/exchange`);
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("cookie")).toBeNull();
    const body = (await request?.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["deviceCode"]);
    expect(body["deviceCode"] === pending().deviceCode).toBe(true);
  });

  it("rejects an expired approval before requesting the exchange", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const http = new WorkspaceHttp({ fetcher, origin, role: "client" });
    await expect(
      completeCliLogin(http, pending(), () => fixedNow + 600_000),
    ).rejects.toMatchObject({ code: "workspace-cli-authorization-expired" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a pending approval for another Workspace before fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const http = new WorkspaceHttp({
      fetcher,
      origin: "https://other.test",
      role: "client",
    });
    const result = completeCliLogin(http, pending(), () => fixedNow);
    await expect(result).rejects.toMatchObject({ code: "workspace-origin-mismatch" });
    await expect(result).rejects.not.toMatchObject({
      message: expect.stringContaining(pending().deviceCode),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns an authenticated browser approval with the first Cookie pair", async () => {
    const http = new WorkspaceHttp({
      fetcher: async () =>
        Response.json(
          { authenticated: true, user: { displayName: "Alice", id: "user-1" } },
          { headers: { "set-cookie": "workspace_session=test; Path=/; HttpOnly" } },
        ),
      origin,
      role: "client",
    });

    await expect(completeCliLogin(http, pending(), () => fixedNow)).resolves.toEqual({
      cookie: "workspace_session=test",
      origin,
      status: "authenticated",
      subject: { id: "user-1", name: "Alice" },
    });
  });

  it("strictly parses pending and authenticated completion responses", async () => {
    const responses = [
      Response.json({ status: "waiting" }, { status: 202 }),
      Response.json(
        { authenticated: false, user: validUser() },
        { headers: { "set-cookie": "workspace_session=test" } },
      ),
      Response.json(
        { authenticated: true, user: { displayName: "Alice" } },
        { headers: { "set-cookie": "workspace_session=test" } },
      ),
      Response.json({ authenticated: true, user: validUser() }),
    ];
    const http = new WorkspaceHttp({
      fetcher: async () => responses.shift()!,
      origin,
      role: "client",
    });

    for (let index = 0; index < 4; index += 1) {
      await expect(completeCliLogin(http, pending(), () => fixedNow)).rejects.toMatchObject({
        code: "workspace-invalid-response",
      });
    }
  });

  it("reports an interrupted completion body as result unknown", async () => {
    const http = new WorkspaceHttp({
      fetcher: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("body interrupted"));
            },
          }),
          { status: 202 },
        ),
      origin,
      role: "client",
    });
    await expect(completeCliLogin(http, pending(), () => fixedNow)).rejects.toMatchObject({
      code: "workspace-result-unknown",
    });
  });

  it("reads the current authenticated User with the supplied Session", async () => {
    let request: Request | undefined;
    const http = new WorkspaceHttp({
      cookie: "workspace_session=test",
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ authenticated: true, user: validUser() });
      },
      origin,
      role: "client",
    });
    await expect(whoami(http)).resolves.toEqual({
      origin,
      subject: { id: "user-1", name: "Alice" },
    });
    expect(request?.url).toBe(`${origin}/api/session`);
    expect(request?.method).toBe("GET");
    expect(request?.headers.get("cookie")).toBe("workspace_session=test");
  });

  it.each([
    [{ kind: "agent", claimed: false }, { kind: "agent", claimed: false }],
    [{ kind: "agent", claimed: true }, { kind: "agent", claimed: true }],
    [{ kind: "human" }, {}],
  ])("reads the principal kind %j of the current User", async (sent, expected) => {
    const http = new WorkspaceHttp({
      cookie: "workspace_session=test",
      fetcher: async () => Response.json({ authenticated: true, user: { ...validUser(), ...sent } }),
      origin,
      role: "client",
    });
    await expect(whoami(http)).resolves.toEqual({
      origin,
      subject: { id: "user-1", name: "Alice", ...expected },
    });
  });

  it.each([
    [{ executorAccess: true }, true],
    [{}, false],
    [{ executorAccess: "true" }, false],
  ])("reads executor access %j from the session, and whoami leaves it out", async (sent, expected) => {
    const http = new WorkspaceHttp({
      cookie: "workspace_session=test",
      fetcher: async () => Response.json({ authenticated: true, user: validUser(), ...sent }),
      origin,
      role: "client",
    });
    await expect(sessionIdentity(http)).resolves.toEqual({
      origin,
      subject: { id: "user-1", name: "Alice" },
      executorAccess: expected,
    });
    await expect(whoami(http)).resolves.toEqual({ origin, subject: { id: "user-1", name: "Alice" } });
  });

  it("creates a guest agent and returns its Session without sending the current one", async () => {
    let request: Request | undefined;
    const http = new WorkspaceHttp({
      cookie: "workspace_session=existing",
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return Response.json(
          { agent: { id: "agent-1", username: "budget-x7k2" } },
          { status: 201, headers: { "set-cookie": "workspace_session=guest; Path=/; HttpOnly" } },
        );
      },
      origin,
      role: "client",
    });
    await expect(createGuestAgent(http, { label: "budget" })).resolves.toEqual({
      agent: { id: "agent-1", username: "budget-x7k2" },
      cookie: "workspace_session=guest",
      origin,
    });
    expect(request?.url).toBe(`${origin}/api/auth/guest`);
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("cookie")).toBeNull();
    await expect(request?.json()).resolves.toEqual({ label: "budget" });
  });

  it.each([
    ["no Session cookie", Response.json({ agent: { id: "agent-1", username: "a" } }, { status: 201 }), "workspace-invalid-response"],
    [
      "an invalid agent",
      Response.json({ agent: { id: "agent-1" } }, { status: 201, headers: { "set-cookie": "workspace_session=guest" } }),
      "workspace-invalid-response",
    ],
    [
      "the creation limit",
      Response.json({ error: { code: "AGENT_CREATE_RATE_LIMITED", message: "Too many agents." } }, { status: 429 }),
      "AGENT_CREATE_RATE_LIMITED",
    ],
  ])("rejects a guest agent response with %s", async (_case, response, code) => {
    const http = new WorkspaceHttp({ fetcher: async () => response, origin, role: "client" });
    await expect(createGuestAgent(http)).rejects.toMatchObject({ code });
  });

  it.each([
    ["unauthenticated", { authenticated: false }, "workspace-authentication-required"],
    ["missing id", { authenticated: true, user: { displayName: "Alice" } }, "workspace-invalid-response"],
    ["invalid displayName", { authenticated: true, user: { displayName: 1, id: "user-1" } }, "workspace-invalid-response"],
  ])("rejects a current User response that is %s", async (_case, body, code) => {
    const http = new WorkspaceHttp({
      cookie: "workspace_session=test",
      fetcher: async () => Response.json(body),
      origin,
      role: "client",
    });
    await expect(whoami(http)).rejects.toMatchObject({ code });
  });

  it("requests remote logout once with the supplied Session", async () => {
    let request: Request | undefined;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      request = new Request(input, init);
      return Response.json({});
    });
    const http = new WorkspaceHttp({
      cookie: "workspace_session=test",
      fetcher,
      origin,
      role: "client",
    });
    await expect(logout(http)).resolves.toEqual({ loggedOut: true, origin });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(request?.url).toBe(`${origin}/api/auth/logout`);
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("cookie")).toBe("workspace_session=test");
  });

  it("preserves result unknown for remote logout", async () => {
    const http = new WorkspaceHttp({
      cookie: "workspace_session=test",
      fetcher: async () => Promise.reject(new Error("offline")),
      origin,
      role: "client",
    });
    await expect(logout(http)).rejects.toMatchObject({ code: "workspace-result-unknown" });
  });
});

function authorizationResponse(override: Record<string, unknown> = {}): Response {
  return Response.json({
    deviceCode: "d".repeat(43),
    expiresIn: 600,
    interval: 2,
    userCode: "ABCD-EFGH",
    verificationUriComplete: "/cli-login?userCode=ABCD-EFGH",
    ...override,
  });
}

function pending(): PendingCliLogin {
  return {
    deviceCode: "d".repeat(43),
    expiresAt: fixedNow + 600_000,
    origin,
    userCode: "ABCD-EFGH",
    verificationUrl: `${origin}/cli-login?userCode=ABCD-EFGH`,
  };
}

function validUser(): Record<string, unknown> {
  return { displayName: "Alice", id: "user-1" };
}
