import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "@univer-cli/config";
import { WorkspaceApplicationError as CoreWorkspaceApplicationError } from "@univerjs/univer-workspace-client-core";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceConfig, DEFAULT_ORIGIN } from "../src/config.js";
import { WorkspaceApplicationError as CliWorkspaceApplicationError } from "../src/errors.js";
import { readWorkspaceCookie, WorkspaceAuth } from "../src/features/auth/session.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("Workspace authentication and HTTP contracts", () => {
  it("keeps the CLI error shim on the Core class identity", () => {
    expect(CliWorkspaceApplicationError).toBe(CoreWorkspaceApplicationError);
    expect(new CliWorkspaceApplicationError("test", "test")).toBeInstanceOf(
      CoreWorkspaceApplicationError,
    );
  });

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

  it("persists Sessions by normalized origin with stable bytes and modes", async () => {
    const directory = await temporaryDirectory();
    const env = { UNIVER_HOME: directory };
    const config = createWorkspaceConfig(env);
    await config.setFromText({ key: "workspace.origin", text: "https://workspace.test" });
    const sessionPath = join(directory, "workspace-cli", "session.json");
    const auth = new WorkspaceAuth({
      config,
      sessionPath,
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

    await expect(
      auth.login({ password: ["test", "password"].join("-"), username: "alice" }),
    ).resolves.toMatchObject({
      origin: "https://workspace.test",
      subject: { id: "user-1", name: "Alice" },
    });
    expect(await readFile(sessionPath, "utf8")).toBe(
      [
        "{",
        '  "sessions": {',
        '    "https://workspace.test": {',
        '      "cookie": "workspace_session=test",',
        '      "subject": "user-1"',
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect((await stat(join(directory, "workspace-cli"))).mode & 0o777).toBe(0o700);
    expect((await stat(sessionPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(directory, "workspace-cli"))).toEqual(["session.json"]);
  });

  it("logs in through browser approval without sending a password", async () => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    await config.setFromText({ key: "workspace.origin", text: "https://workspace.test" });
    const requests: Array<{ readonly deviceCodeMatches: boolean; readonly path: string }> = [];
    let exchanges = 0;
    const sessionPath = join(directory, "session.json");
    const now = 1_787_878_800_000;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      requests.push({
        deviceCodeMatches: body === undefined || body["deviceCode"] === "a".repeat(43),
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
      if (exchanges === 1) return Response.json({ status: "pending" }, { status: 202 });
      return Response.json(
        { authenticated: true, user: { displayName: "GitHub Alice", id: "user-github" } },
        { headers: { "set-cookie": "workspace_session=browser-approved; Path=/; HttpOnly" } },
      );
    };
    const createAuth = () => new WorkspaceAuth({ config, fetcher, now: () => now, sessionPath });

    const pending = await createAuth().startCliLogin();
    expect(pending).toMatchObject({
      origin: "https://workspace.test",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://workspace.test/cli-login?userCode=ABCD-EFGH",
    });
    const pendingBytes = [
      "{",
      '  "sessions": {},',
      '  "pendingCliLogins": {',
      '    "https://workspace.test": {',
      `      "deviceCode": "${"a".repeat(43)}",`,
      '      "expiresAt": 1787879400000,',
      '      "origin": "https://workspace.test",',
      '      "userCode": "ABCD-EFGH",',
      '      "verificationUrl": "https://workspace.test/cli-login?userCode=ABCD-EFGH"',
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(await readFile(sessionPath, "utf8")).toBe(pendingBytes);

    const secondInvocation = createAuth();
    await expect(secondInvocation.pendingCliLogin()).resolves.toEqual(pending);
    await expect(secondInvocation.completeCliLogin(pending)).resolves.toEqual({ status: "pending" });
    expect(await readFile(sessionPath, "utf8")).toBe(pendingBytes);
    await expect(createAuth().completeCliLogin(pending)).resolves.toEqual({
      status: "authenticated",
      origin: "https://workspace.test",
      subject: { id: "user-github", name: "GitHub Alice" },
    });
    expect(requests).toEqual([
      { deviceCodeMatches: true, path: "/api/auth/cli/authorizations" },
      { deviceCodeMatches: true, path: "/api/auth/cli/authorizations/exchange" },
      { deviceCodeMatches: true, path: "/api/auth/cli/authorizations/exchange" },
    ]);
    expect(await readFile(sessionPath, "utf8")).toBe(
      [
        "{",
        '  "sessions": {',
        '    "https://workspace.test": {',
        '      "cookie": "workspace_session=browser-approved",',
        '      "subject": "user-github"',
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("clears the local Session even when remote logout is unknown", async () => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    const sessionPath = join(directory, "session.json");
    const currentOrigin = new URL(DEFAULT_ORIGIN).origin;
    await writeFile(sessionPath, JSON.stringify({
      sessions: { [currentOrigin]: { cookie: "session=x" } },
      pendingCliLogins: {
        [currentOrigin]: {
          deviceCode: "test-device-code",
          expiresAt: 1_900_000_000_000,
          origin: currentOrigin,
          userCode: "ABCD-EFGH",
          verificationUrl: `${currentOrigin}/cli-login?userCode=ABCD-EFGH`,
        },
      },
    }));
    let requests = 0;
    const auth = new WorkspaceAuth({
      config,
      sessionPath,
      fetcher: async () => {
        requests += 1;
        return await Promise.reject(new Error("offline"));
      },
    });

    await expect(auth.logout()).rejects.toMatchObject({ code: "workspace-result-unknown" });
    expect(requests).toBe(1);
    expect(await readFile(sessionPath, "utf8")).toBe('{\n  "sessions": {}\n}\n');
  });

  it("clears pending state without a remote request when no Session exists", async () => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    const sessionPath = join(directory, "session.json");
    const currentOrigin = new URL(DEFAULT_ORIGIN).origin;
    await writeFile(sessionPath, JSON.stringify({
      sessions: {},
      pendingCliLogins: {
        [currentOrigin]: {
          deviceCode: "test-device-code",
          expiresAt: 1_900_000_000_000,
          origin: currentOrigin,
          userCode: "ABCD-EFGH",
          verificationUrl: `${currentOrigin}/cli-login?userCode=ABCD-EFGH`,
        },
      },
    }));
    let requests = 0;
    const auth = new WorkspaceAuth({
      config,
      sessionPath,
      fetcher: async () => {
        requests += 1;
        return Response.json({});
      },
    });
    await expect(auth.logout()).resolves.toEqual({ loggedOut: true, origin: currentOrigin });
    expect(requests).toBe(0);
    expect(await readFile(sessionPath, "utf8")).toBe('{\n  "sessions": {}\n}\n');
  });

  it.each([
    ["invalid JSON", "{not-json"],
    ["non-record", "[]"],
    ["invalid sessions", JSON.stringify({ sessions: [] })],
    ["empty cookie", JSON.stringify({ sessions: { "https://workspace.test": { cookie: "" } } })],
    ["invalid subject", JSON.stringify({ sessions: { "https://workspace.test": { cookie: "session=x", subject: 1 } } })],
    ["unnormalized origin", JSON.stringify({ sessions: { "https://workspace.test/": { cookie: "session=x" } } })],
    ["invalid pending field", JSON.stringify({ sessions: {}, pendingCliLogins: { "https://workspace.test": { deviceCode: "", expiresAt: 1_900_000_000_000, origin: "https://workspace.test", userCode: "ABCD-EFGH", verificationUrl: "https://workspace.test/cli-login" } } })],
    ["pending origin mismatch", JSON.stringify({ sessions: {}, pendingCliLogins: { "https://workspace.test": { deviceCode: "test-device-code", expiresAt: 1_900_000_000_000, origin: "https://other.test", userCode: "ABCD-EFGH", verificationUrl: "https://workspace.test/cli-login" } } })],
  ])("rejects persisted state with %s", async (_case, source) => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    const sessionPath = join(directory, "session.json");
    await writeFile(sessionPath, source);
    const auth = new WorkspaceAuth({ config, sessionPath });
    await expect(auth.authenticatedHttp("client")).rejects.toMatchObject({
      code: "workspace-session-corrupt",
    });
  });

  it("cleans expired pending state and preserves other origins", async () => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    await config.setFromText({ key: "workspace.origin", text: "https://workspace.test" });
    const sessionPath = join(directory, "session.json");
    const expiresAt = 1_787_879_400_000;
    const source = () => JSON.stringify({
      sessions: { "https://other.test": { cookie: "session=other" } },
      pendingCliLogins: {
        "https://workspace.test": {
          deviceCode: "test-device-code",
          expiresAt,
          origin: "https://workspace.test",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://workspace.test/cli-login?userCode=ABCD-EFGH",
        },
      },
    });
    await writeFile(sessionPath, source());
    const auth = new WorkspaceAuth({ config, now: () => expiresAt, sessionPath });
    await expect(auth.pendingCliLogin()).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(sessionPath, "utf8"))).toEqual({
      sessions: { "https://other.test": { cookie: "session=other" } },
    });

    await writeFile(sessionPath, source());
    await expect(auth.completeCliLogin({
      deviceCode: "test-device-code",
      expiresAt,
      origin: "https://workspace.test",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://workspace.test/cli-login?userCode=ABCD-EFGH",
    })).rejects.toMatchObject({ code: "workspace-cli-authorization-expired" });
    expect(JSON.parse(await readFile(sessionPath, "utf8"))).toEqual({
      sessions: { "https://other.test": { cookie: "session=other" } },
    });
  });

  it("serializes concurrent Session, pending and clear mutations without losing origins", async () => {
    const directory = await temporaryDirectory();
    const sessionPath = join(directory, "session.json");
    await writeFile(sessionPath, JSON.stringify({
      sessions: { "https://three.test": { cookie: "session=three" } },
    }));
    const origins = ["https://one.test", "https://two.test", "https://three.test"];
    let configRead = 0;
    const config = {
      get: async () => ({ source: "config", value: origins[configRead++] }),
    } as unknown as Config;
    const auth = new WorkspaceAuth({
      config,
      now: () => 1_787_878_800_000,
      sessionPath,
      fetcher: async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "one.test") {
          return Response.json(
            { authenticated: true, user: { displayName: "One", id: "user-1" } },
            { headers: { "set-cookie": "session=one; Path=/" } },
          );
        }
        if (url.hostname === "two.test") {
          return Response.json({
            deviceCode: "test-device-code",
            expiresIn: 600,
            interval: 2,
            userCode: "ABCD-EFGH",
            verificationUriComplete: "/cli-login?userCode=ABCD-EFGH",
          });
        }
        return Response.json({});
      },
    });

    await Promise.all([
      auth.login({ password: ["test", "password"].join("-"), username: "one" }),
      auth.startCliLogin(),
      auth.logout(),
    ]);
    expect(JSON.parse(await readFile(sessionPath, "utf8"))).toEqual({
      sessions: { "https://one.test": { cookie: "session=one", subject: "user-1" } },
      pendingCliLogins: {
        "https://two.test": {
          deviceCode: "test-device-code",
          expiresAt: 1_787_879_400_000,
          origin: "https://two.test",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://two.test/cli-login?userCode=ABCD-EFGH",
        },
      },
    });
  });

  it("composes the stored Cookie and worker role through authenticatedHttp", async () => {
    const directory = await temporaryDirectory();
    const config = createWorkspaceConfig({ UNIVER_HOME: directory });
    await config.setFromText({ key: "workspace.origin", text: "https://workspace.test" });
    const sessionPath = join(directory, "session.json");
    await writeFile(sessionPath, JSON.stringify({
      sessions: { "https://workspace.test": { cookie: "session=test" } },
    }));
    let request: Request | undefined;
    const auth = new WorkspaceAuth({
      config,
      sessionPath,
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ ok: true });
      },
    });

    await (await auth.authenticatedHttp("worker")).json("/api/test");
    await expect(readWorkspaceCookie({ origin: "https://workspace.test", sessionPath })).resolves
      .toBe("session=test");
    expect(request?.headers.get("cookie")).toBe("session=test");
    expect(request?.headers.get("x-univer-cli-sdk-role")).toBe("worker");
    expect(request?.headers.get("x-univer-cli-sdk-worker-pid")).toBe(String(process.pid));
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "workspace-auth-"));
  temporaryDirectories.push(path);
  return path;
}
