import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";

const API_KEY = "discord-bot-test-api-key-32-characters";

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

describe("Discord Bot login", () => {
  it("requires the API key, creates a User once, and returns a normal session", async () => {
    const started = await startApplication(API_KEY);

    const missingKey = await fetch(
      `${started.origin}/api/auth/discord/bot-login`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordUserId: "123456789012345678" }),
      }
    );
    expect(missingKey.status).toBe(401);
    expect(await missingKey.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });

    const invalidKey = await fetch(
      `${started.origin}/api/auth/discord/bot-login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "not-the-configured-api-key",
        },
        body: JSON.stringify({ discordUserId: "123456789012345678" }),
      }
    );
    expect(invalidKey.status).toBe(401);
    expect(count("users")).toBe(0);

    const first = await botLogin(started.origin, {
      discordUserId: "123456789012345678",
      username: "discord.alice",
      displayName: "Alice on Discord",
      avatarUrl: "https://cdn.discordapp.com/avatar.png",
    });
    expect(first.response.status).toBe(200);
    expect(first.cookie).toMatch(/^workspace_session=[^;]+$/u);
    expect(first.body).toMatchObject({
      authenticated: true,
      user: {
        username: "discord.alice",
        displayName: "Alice on Discord",
      },
      authenticationMethods: {
        password: false,
        externalIdentities: [
          { provider: "discord", providerUsername: "discord.alice" },
        ],
      },
    });

    const second = await botLogin(started.origin, {
      discordUserId: "123456789012345678",
      username: "alice.updated",
    });
    expect(second.response.status).toBe(200);
    expect(second.body).toMatchObject({
      user: { id: first.body.user.id },
      authenticationMethods: {
        externalIdentities: [
          { provider: "discord", providerUsername: "alice.updated" },
        ],
      },
    });

    const restored = await fetch(`${started.origin}/api/session`, {
      headers: { cookie: second.cookie },
    });
    expect(await restored.json()).toMatchObject({
      authenticated: true,
      user: { id: first.body.user.id },
    });

    expect(count("users")).toBe(1);
    expect(count("spaces")).toBe(1);
    expect(count("external_identities")).toBe(1);
    expect(count("login_sessions")).toBe(2);
  });

  it("is unavailable when the Workspace API key is not configured", async () => {
    const started = await startApplication();
    const response = await fetch(
      `${started.origin}/api/auth/discord/bot-login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({ discordUserId: "123456789012345678" }),
      }
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DISCORD_BOT_AUTH_UNAVAILABLE" },
    });
  });
});

async function startApplication(discordBotApiKey?: string): Promise<{
  readonly origin: string;
}> {
  directory = mkdtempSync(join(tmpdir(), "univer-discord-bot-login-"));
  application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    sessionTtlMs: 60_000,
    ...(discordBotApiKey ? { discordBotApiKey } : {}),
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
  return { origin: `http://127.0.0.1:${address.port}` };
}

async function botLogin(
  origin: string,
  body: Readonly<Record<string, unknown>>
): Promise<{
  readonly response: Response;
  readonly cookie: string;
  readonly body: {
    readonly user: { readonly id: string };
  } & Record<string, unknown>;
}> {
  const response = await fetch(`${origin}/api/auth/discord/bot-login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify(body),
  });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  return {
    response,
    cookie,
    body: (await response.json()) as {
      readonly user: { readonly id: string };
    } & Record<string, unknown>,
  };
}

function count(table: string): number {
  const row = application!.database.connection
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { readonly count: number };
  return row.count;
}
