import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceConfig, DEFAULT_ORIGIN } from "../src/config.js";
import { WorkspaceAuth } from "../src/features/auth/session.js";
import { WorkspaceHttp } from "../src/transport/http.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("Workspace authentication and HTTP contracts", () => {
  it("uses the production Workspace origin by default", async () => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    const normalizedOrigin = new URL(DEFAULT_ORIGIN).origin;

    await expect(config.get({ key: "workspace.origin" })).resolves.toMatchObject({
      defaultValue: normalizedOrigin,
      source: "default",
      value: normalizedOrigin,
    });
  });

  it("persists Sessions by normalized origin and requires displayName", async () => {
    const directory = await temporaryDirectory();
    const env = { UNIVER_HOME: directory };
    const config = createWorkspaceConfig(env);
    await config.setFromText({ key: "workspace.origin", text: "https://workspace.test" });
    const auth = new WorkspaceAuth({
      config,
      sessionPath: join(directory, "session.json"),
      fetcher: async () =>
        new Response(
          JSON.stringify({ authenticated: true, user: { displayName: "Alice", id: "user-1" } }),
          {
            headers: {
              "content-type": "application/json",
              "set-cookie": "workspace_session=test; Path=/; HttpOnly",
            },
          },
        ),
    });

    await expect(auth.login({ password: "secret", username: "alice" })).resolves.toMatchObject({
      origin: "https://workspace.test",
      subject: { id: "user-1", name: "Alice" },
    });
    expect(JSON.parse(await readFile(join(directory, "session.json"), "utf8"))).toEqual({
      sessions: {
        "https://workspace.test": { cookie: "workspace_session=test", subject: "user-1" },
      },
    });

    const invalid = new WorkspaceAuth({
      config,
      sessionPath: join(directory, "invalid-session.json"),
      fetcher: async () =>
        new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", name: "Alice" } }),
          {
            headers: { "set-cookie": "workspace_session=test" },
          },
        ),
    });
    await expect(invalid.login({ password: "secret", username: "alice" })).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
  });

  it("logs in through browser approval without sending a password", async () => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    await config.setFromText({ key: "workspace.origin", text: "https://workspace.test" });
    const requests: Array<{ readonly body: unknown; readonly path: string }> = [];
    let exchanges = 0;
    const auth = new WorkspaceAuth({
      config,
      sessionPath: join(directory, "session.json"),
      fetcher: async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          path: url.pathname,
        });
        if (url.pathname === "/api/auth/cli/authorizations") {
          return Response.json(
            {
              deviceCode: "a".repeat(43),
              userCode: "ABCD-EFGH",
              verificationUri: "/cli-login",
              verificationUriComplete: "/cli-login?userCode=ABCD-EFGH",
              expiresIn: 600,
              interval: 2,
            },
            { status: 201 },
          );
        }
        exchanges += 1;
        if (exchanges === 1) {
          return Response.json({ status: "pending" }, { status: 202 });
        }
        return Response.json(
          { authenticated: true, user: { displayName: "GitHub Alice", id: "user-github" } },
          { headers: { "set-cookie": "workspace_session=browser-approved; Path=/; HttpOnly" } },
        );
      },
    });

    const pending = await auth.startCliLogin();
    expect(pending).toMatchObject({
      origin: "https://workspace.test",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://workspace.test/cli-login?userCode=ABCD-EFGH",
    });
    await expect(auth.pendingCliLogin()).resolves.toEqual(pending);
    await expect(auth.completeCliLogin(pending)).resolves.toEqual({ status: "pending" });
    await expect(auth.completeCliLogin(pending)).resolves.toEqual({
      status: "authenticated",
      origin: "https://workspace.test",
      subject: { id: "user-github", name: "GitHub Alice" },
    });
    expect(requests).toEqual([
      { body: undefined, path: "/api/auth/cli/authorizations" },
      {
        body: { deviceCode: "a".repeat(43) },
        path: "/api/auth/cli/authorizations/exchange",
      },
      {
        body: { deviceCode: "a".repeat(43) },
        path: "/api/auth/cli/authorizations/exchange",
      },
    ]);
    expect(JSON.parse(await readFile(join(directory, "session.json"), "utf8"))).toEqual({
      sessions: {
        "https://workspace.test": {
          cookie: "workspace_session=browser-approved",
          subject: "user-github",
        },
      },
    });
  });

  it("clears the local Session even when remote logout is unknown", async () => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    const sessionPath = join(directory, "session.json");
    await writeFile(
      sessionPath,
      JSON.stringify({
        sessions: { [new URL(DEFAULT_ORIGIN).origin]: { cookie: "session=x" } },
      }),
    );
    const auth = new WorkspaceAuth({
      config,
      sessionPath,
      fetcher: async () => Promise.reject(new Error("offline")),
    });

    await expect(auth.logout()).rejects.toMatchObject({ code: "workspace-result-unknown" });
    expect(JSON.parse(await readFile(sessionPath, "utf8"))).toEqual({ sessions: {} });
  });

  it("rejects a corrupt persisted Session instead of falling back to another credential source", async () => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    const sessionPath = join(directory, "session.json");
    await writeFile(sessionPath, "{not-json");
    const auth = new WorkspaceAuth({ config, sessionPath });
    await expect(auth.authenticatedHttp("client")).rejects.toMatchObject({
      code: "workspace-session-corrupt",
    });
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
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "workspace-auth-"));
  temporaryDirectories.push(path);
  return path;
}
