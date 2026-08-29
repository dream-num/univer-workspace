import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import * as host from "../src/index.js";
import { WORKSPACE_MANIFEST_JSON } from "../src/favicon.js";
import { parseSessionCookie, signSessionCookie, type LoginAttempt } from "../src/auth.js";
import {
  workspacePathFor, isDirectSha256Child, workspacePathName,
  spaceDirectoryPath, isUserScopedPath,
} from "../src/identity.js";

describe("univer-workspace-harness plugin", () => {
  it("exports a loadable cordis host plugin", () => {
    expect(host.name).toBe("univer-workspace-harness");
    expect(typeof host.apply).toBe("function");
  });

  it("round-trips the signed session cookie", () => {
    const identity = { userId: "u-1", username: "alice", displayName: "Alice" };
    const cookie = signSessionCookie(identity, "secret", 60_000);
    expect(parseSessionCookie(cookie, "secret")).toMatchObject(identity);
    expect(parseSessionCookie(cookie, "wrong")).toBeUndefined();
  });

  it("rewrites only the published DSH index title", () => {
    expect(host.rewriteHarnessIndexTitle("<title>DeepSeek Harness</title>")).toBe(
      "<title>Univer Workspace Harness</title>",
    );
    expect(host.rewriteHarnessIndexTitle("<title>Other product</title>")).toBe(
      "<title>Other product</title>",
    );
  });

  it("replaces the stock favicon on the server-rendered first paint", () => {
    const html = '<html><head><title>DeepSeek Harness</title><link rel="icon" href="/favicon.svg"><link rel="shortcut icon" href="/deepseek.svg"></head><body />';
    const branded = host.rewriteHarnessIndexBranding(html);
    expect(branded).toContain('<title');
    expect(branded).toContain("Univer Workspace Harness");
    expect(branded).toContain('id="uwh-workspace-favicon"');
    expect(branded).toContain("data:image/svg+xml,");
    expect(branded).not.toContain("/deepseek.svg");
    expect((branded.match(/uwh-workspace-favicon/gu) ?? []).length).toBe(1);
  });

  it("ships Workspace-owned PWA metadata instead of the stock DSH manifest", () => {
    const manifest = JSON.parse(WORKSPACE_MANIFEST_JSON) as {
      name?: string;
      short_name?: string;
      icons?: readonly { src?: string }[];
    };
    expect(manifest.name).toBe("Univer Workspace Harness");
    expect(manifest.short_name).toBe("Univer Workspace");
    expect(manifest.icons?.[0]?.src).toBe("/favicon.svg");
    expect(WORKSPACE_MANIFEST_JSON).not.toContain("DeepSeek Harness");
  });

  it("does not expose token-exchange internals in the OAuth callback response", async () => {
    const state = "test-state";
    const loginAttempts = new Map<string, LoginAttempt>([[state, {
      verifier: "test-verifier",
      returnTo: "/",
      expiresAt: Date.now() + 60_000,
    }]]);
    const config = {
      workspaceRoot: "/tmp/uwh-test",
      workspaceOrigin: "http://workspace.test",
      publicOrigin: "http://127.0.0.1:3081",
      oauthClientId: "client",
      oauthClientSecret: "secret",
      sessionSecret: "session-secret",
      authorizeScope: "identity session",
      adminUsernames: [],
      loginPath: "/auth/login",
      callbackPath: "/auth/callback",
      mePath: "/api/uwh/me",
      templateForkPath: "/api/uwh/template-fork",
      sessionCookieName: "dsh_session",
      sessionTtlMs: 900_000,
      stateTtlMs: 120_000,
      secureCookies: false,
      modelSettingsEnabled: false,
      templates: [],
    } satisfies host.Config;
    const request = {
      method: "GET",
      url: `/auth/callback?state=${state}&code=test-code`,
      headers: {
        host: "127.0.0.1:3081",
        cookie: `dsh_session_state=${state}`,
      },
    } as unknown as IncomingMessage;
    const response = new FakeResponse();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 401 });
    try {
      await host.createCallbackHandler(
        { get: () => undefined } as never,
        config,
        loginAttempts,
        "http://127.0.0.1:3081/auth/callback",
      )(request, response as unknown as ServerResponse);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toMatchObject({ error: "oauth_token_exchange_failed" });
    expect(JSON.parse(response.body).diagnosticId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).not.toContain("workspace token endpoint");
    expect(response.body).not.toContain("at ");
    expect(response.body).not.toContain("/root/");
  });

  it("canonicalizes a login request before setting the state cookie", async () => {
    const config = {
      workspaceRoot: "/tmp/uwh-test",
      workspaceOrigin: "http://workspace.test",
      publicOrigin: "http://127.0.0.1:3081",
      oauthClientId: "client",
      oauthClientSecret: "secret",
      sessionSecret: "session-secret",
      authorizeScope: "identity session",
      adminUsernames: [],
      loginPath: "/auth/login",
      callbackPath: "/auth/callback",
      mePath: "/api/uwh/me",
      templateForkPath: "/api/uwh/template-fork",
      sessionCookieName: "dsh_session",
      sessionTtlMs: 900_000,
      stateTtlMs: 120_000,
      secureCookies: false,
      modelSettingsEnabled: false,
      templates: [],
    } satisfies host.Config;
    const response = new FakeResponse();
    await host.createLoginHandler(config, new Map(), "http://127.0.0.1:3081/auth/callback")(
      {
        method: "GET",
        url: "/auth/login",
        headers: { host: "localhost:3081" },
      } as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://127.0.0.1:3081/auth/login");
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

  it("scopes a per-Space directory under the user directory", () => {
    const spaceDir = spaceDirectoryPath("/root", "u-1", "sp-1");
    expect(isUserScopedPath("/root", "u-1", spaceDir)).toBe(true);
    expect(isUserScopedPath("/root", "u-2", spaceDir)).toBe(false);
    expect(isUserScopedPath("/root", "u-1", "/root/elsewhere")).toBe(false);
    // The user directory itself is in scope (template-fork container).
    expect(isUserScopedPath("/root", "u-1", workspacePathFor("/root", "u-1").ok ? (workspacePathFor("/root", "u-1") as { path: string }).path : "")).toBe(true);
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
    this.body = body === undefined
      ? ""
      : typeof body === "string" ? body : Buffer.from(body).toString("utf8");
  }
}
