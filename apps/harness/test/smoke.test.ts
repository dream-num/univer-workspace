import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, writeFile, lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import * as host from "../src/index.js";
import { UWH_SESSION_PROMPT_PATH } from "../src/contract.js";
import {
  completeDeviceAuthorization,
  startDeviceAuthorization,
  type DeviceAuthorizationStart,
} from "../src/device-authorization.js";
import {
  workspacePathFor,
  isDirectSha256Child,
  workspacePathName,
  workspacePathForOrigin,
  spaceDirectoryPath,
  isUserScopedPath,
} from "../src/identity.js";
import { migrateLegacyUserDirectory } from "../src/workspace-migration.js";

describe("univer-workspace-harness plugin", () => {
  it("exports a loadable cordis host plugin", () => {
    expect(host.name).toBe("univer-workspace-harness");
    expect(typeof host.apply).toBe("function");
  });

  it("has a local Device-only configuration with no OAuth or session-cookie options", () => {
    const config = (host.Config as unknown as (input: unknown) => host.Config)({
      workspaceOrigin: "https://workspace.example",
      publicOrigin: "http://127.0.0.1:3081",
      connectionStatePath: "/tmp/uwh-test/connection.json",
    });
    expect(config).not.toHaveProperty("authMode");
    expect(config).not.toHaveProperty("oauthClientId");
    expect(config).not.toHaveProperty("sessionSecret");
  });

  it("composes the local Session prompt route through the alpha.4 gateway", async () => {
    const invoke = vi.fn(async () => ({ accepted: true }));
    const routes = host.localRouteDefinitions(
      {
        get: (name: string) => (name === "typertGateway" ? { invoke } : undefined),
      } as never,
      new Map(),
    );
    const route = routes.find((candidate) => candidate.path === UWH_SESSION_PROMPT_PATH);
    expect(route).toBeDefined();
    if (route === undefined) return;

    const response = new FakeResponse();
    await route.handler(
      new FakeRequest("POST", {
        sessionId: "session-1",
        mode: "queue",
        content: [{ type: "text", text: "hello" }],
      }) as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, value: { accepted: true } });
    expect(invoke).toHaveBeenCalledWith({
      namespace: "session",
      method: "prompt",
      args: {
        request: {
          requestId: expect.any(String),
          sessionId: "session-1",
          mode: "queue",
          content: [{ type: "text", text: "hello" }],
        },
      },
    });
  });

  it("stages Device login for the next process without setting a Harness cookie", async () => {
    const authorization: DeviceAuthorizationStart = {
      deviceCode: "device-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://workspace.example/cli-login",
      expiresAt: Date.now() + 60_000,
      intervalMs: 5_000,
      origin: "https://workspace.example",
    };
    const stageConnection = vi.fn(async () => undefined);
    const response = new FakeResponse();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ user: { id: "u-1", username: "alice" } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "workspace_session=opaque-token; Path=/; HttpOnly",
        },
      });
    try {
      await host.createDeviceCompleteHandler(
        {
          workspaceAuth: {
            loginOrigin: () => "https://workspace.example",
            stageConnection,
          },
        } as never,
        new Map([[authorization.deviceCode, authorization]]),
      )(
        new FakeRequest("POST", {
          deviceCode: authorization.deviceCode,
        }) as unknown as IncomingMessage,
        response as unknown as ServerResponse,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(stageConnection).toHaveBeenCalledWith(
      { userId: "u-1", username: "alice" },
      "opaque-token",
      "https://workspace.example",
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      status: "restart_required",
      restartRequired: true,
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("derives a direct SHA-256-named workspace path", () => {
    const derived = workspacePathFor("/root", "u-1");
    expect(derived.ok).toBe(true);
    if (derived.ok) {
      expect(isDirectSha256Child("/root", derived.path)).toBe(true);
      expect(workspacePathName("u-1")).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("keeps the same user isolated across Workspace origins", () => {
    const local = workspacePathForOrigin("/root", "http://workspace-a.test", "u-1");
    const remote = workspacePathForOrigin("/root", "https://workspace-b.test", "u-1");
    expect(local.ok).toBe(true);
    expect(remote.ok).toBe(true);
    if (local.ok && remote.ok) expect(local.path).not.toBe(remote.path);
  });

  it("keeps the identity matrix isolated by both origin and user", () => {
    const aliceA = workspacePathForOrigin("/root", "https://workspace-a.test", "alice");
    const bobA = workspacePathForOrigin("/root", "https://workspace-a.test", "bob");
    const aliceB = workspacePathForOrigin("/root", "https://workspace-b.test", "alice");
    expect(aliceA.ok && bobA.ok && aliceB.ok).toBe(true);
    if (aliceA.ok && bobA.ok && aliceB.ok) {
      expect(new Set([aliceA.path, bobA.path, aliceB.path]).size).toBe(3);
    }
  });

  it("moves a legacy user root into the origin-aware root only when the target is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-migration-"));
    const legacy = workspacePathFor(root, "u-legacy");
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    await mkdir(legacy.path, { recursive: true });
    await writeFile(join(legacy.path, "session.jsonl"), "legacy");
    await migrateLegacyUserDirectory(root, "https://workspace.example", "u-legacy");
    const current = workspacePathForOrigin(root, "https://workspace.example", "u-legacy");
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    await expect(lstat(current.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(realpath(legacy.path)).resolves.toBe(current.path);
  });

  it("runs the Device Authorization start and exchange contract without leaking the token", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Request[] = [];
    globalThis.fetch = async (input, init) => {
      requests.push(new Request(input, init));
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            deviceCode: "device-1",
            userCode: "ABCD-EFGH",
            verificationUri: "/cli-login",
            expiresIn: 120,
            interval: 5,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ user: { id: "u-1", username: "alice" } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "workspace_session=u-1.secret=value; Path=/; HttpOnly",
        },
      });
    };
    try {
      const pending = await startDeviceAuthorization("https://workspace.example/", () => 10_000);
      expect(pending.origin).toBe("https://workspace.example");
      expect(pending.verificationUrl).toBe("https://workspace.example/cli-login");
      expect(pending.expiresAt).toBe(130_000);
      const result = await completeDeviceAuthorization(pending, () => 11_000);
      expect(result).toEqual({
        status: "authenticated",
        identity: { userId: "u-1", username: "alice" },
        sessionToken: "u-1.secret=value",
      });
      expect(requests[0]?.url).toBe("https://workspace.example/api/auth/cli/authorizations");
      expect(requests[1]?.url).toBe(
        "https://workspace.example/api/auth/cli/authorizations/exchange",
      );
      expect(await requests[1]?.text()).toContain("device-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps an unapproved Device Authorization request pending", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 202 });
    try {
      const pending: DeviceAuthorizationStart = {
        deviceCode: "device-2",
        userCode: "IJKL-MNOP",
        verificationUrl: "https://workspace.example/cli-login",
        expiresAt: Date.now() + 60_000,
        intervalMs: 5_000,
        origin: "https://workspace.example",
      };
      await expect(completeDeviceAuthorization(pending)).resolves.toEqual({ status: "pending" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("scopes a per-Space directory under the user directory", () => {
    const spaceDir = spaceDirectoryPath("/root", "u-1", "sp-1");
    expect(isUserScopedPath("/root", "u-1", spaceDir)).toBe(true);
    expect(isUserScopedPath("/root", "u-2", spaceDir)).toBe(false);
    expect(isUserScopedPath("/root", "u-1", "/root/elsewhere")).toBe(false);
    // The user directory itself is in scope (template-fork container).
    expect(
      isUserScopedPath(
        "/root",
        "u-1",
        workspacePathFor("/root", "u-1").ok
          ? (workspacePathFor("/root", "u-1") as { path: string }).path
          : "",
      ),
    ).toBe(true);
  });
});

class FakeResponse {
  status = 0;
  body = "";
  headers: Record<string, string | string[]> = {};

  writeHead(status: number, headers?: Record<string, string | string[]>): this {
    this.status = status;
    if (headers !== undefined) Object.assign(this.headers, headers);
    return this;
  }

  getHeader(name: string): string | string[] | undefined {
    return this.headers[name] ?? this.headers[name.toLowerCase()];
  }

  setHeader(name: string, value: string | string[]): this {
    this.headers[name] = value;
    return this;
  }

  end(body?: string | Uint8Array): void {
    this.body =
      body === undefined
        ? ""
        : typeof body === "string"
          ? body
          : Buffer.from(body).toString("utf8");
  }
}

class FakeRequest {
  readonly headers: Record<string, string>;

  constructor(
    readonly method: string,
    private readonly body: unknown,
  ) {
    const serialized = JSON.stringify(body);
    this.headers = { "content-length": String(Buffer.byteLength(serialized)) };
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<Buffer> {
    yield Buffer.from(JSON.stringify(this.body), "utf8");
  }
}
