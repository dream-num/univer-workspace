import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";

let application: WorkspaceApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve()))
    );
  }
  await application?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  application = undefined;
  server = undefined;
  directory = undefined;
});

describe("CLI browser authorization", () => {
  it("requires browser authentication and exchanges approval only once", async () => {
    const origin = await startApplication();
    const browserLogin = await post(origin, "/api/auth/password/register", {
      username: "browser-user",
      displayName: "Browser User",
      password: "correct horse battery staple",
    });
    const browserCookie = cookieFrom(browserLogin);
    expect(browserLogin.status).toBe(201);

    const started = await post(origin, "/api/auth/cli/authorizations");
    expect(started.status).toBe(201);
    expect(started.headers.get("cache-control")).toBe("no-store");
    const authorization = (await started.json()) as {
      readonly deviceCode: string;
      readonly userCode: string;
      readonly verificationUriComplete: string;
    };
    expect(authorization).toMatchObject({
      userCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u),
      verificationUriComplete: `/cli-login?userCode=${authorization.userCode}`,
    });

    const pending = await post(origin, "/api/auth/cli/authorizations/exchange", {
      deviceCode: authorization.deviceCode,
    });
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ status: "pending" });

    const unauthenticatedApproval = await post(
      origin,
      "/api/auth/cli/authorizations/approve",
      { userCode: authorization.userCode }
    );
    expect(unauthenticatedApproval.status).toBe(401);

    const approved = await post(
      origin,
      "/api/auth/cli/authorizations/approve",
      { userCode: authorization.userCode },
      browserCookie
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      authenticated: true,
      user: { username: "browser-user" },
    });

    const exchanged = await post(origin, "/api/auth/cli/authorizations/exchange", {
      deviceCode: authorization.deviceCode,
    });
    expect(exchanged.status).toBe(200);
    const cliCookie = cookieFrom(exchanged);
    expect(cliCookie).toMatch(/^workspace_session=[^;]+$/u);
    expect(cliCookie).not.toBe(browserCookie);
    expect(await exchanged.json()).toMatchObject({
      authenticated: true,
      user: { username: "browser-user" },
    });

    const cliSession = await fetch(`${origin}/api/session`, {
      headers: { cookie: cliCookie },
    });
    expect(await cliSession.json()).toMatchObject({
      authenticated: true,
      user: { username: "browser-user" },
    });
    const replay = await post(origin, "/api/auth/cli/authorizations/exchange", {
      deviceCode: authorization.deviceCode,
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({
      error: { code: "CLI_AUTHORIZATION_INVALID" },
    });
  });
});

async function startApplication(): Promise<string> {
  directory = mkdtempSync(join(tmpdir(), "univer-cli-authorization-"));
  application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
  server = createServer(application.app);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => {
      server!.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function post(
  origin: string,
  path: string,
  body?: Readonly<Record<string, unknown>>,
  cookie?: string
): Promise<Response> {
  return await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function cookieFrom(response: Response): string {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}
