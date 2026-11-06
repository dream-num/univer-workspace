import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import type { EmailMessage } from "../../server/src/integrations/email/index.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
});

describe("Email sign-in HTTP API", () => {
  it("emails a code and signs a new User in with it", async () => {
    const sent: EmailMessage[] = [];
    const application = createWorkspaceApplication(
      {
        host: "127.0.0.1",
        port: 0,
        databaseFilename: ":memory:",
        collaborationDatabaseFilename: ":memory:",
        secureCookies: false,
        sessionTtlMs: 60_000,
      },
      {
        unitStore: {
          createUnit: async (input) => ({
            unitId: input.unitId,
            headRevision: 1,
          }),
        },
        emailSender: {
          send: async (message) => {
            sent.push(message);
          },
        },
      }
    );
    applications.push(application);
    const base = await serve(application);

    const codeResponse = await fetch(`${base}/api/auth/email/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Alice@Example.com" }),
    });
    expect(codeResponse.status).toBe(202);
    expect(codeResponse.headers.get("set-cookie")).toBeNull();
    expect(codeResponse.headers.get("cache-control")).toBe("no-store");
    expect(await codeResponse.json()).toEqual({
      expiresIn: 600,
      resendAfter: 60,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("alice@example.com");

    const invalidResponse = await fetch(`${base}/api/auth/email/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        code: "000000",
      }),
    });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({
      error: { code: "INVALID_EMAIL_CODE", field: "code" },
    });

    const loginResponse = await fetch(`${base}/api/auth/email/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        code: codeFrom(sent[0]!),
      }),
    });
    expect(loginResponse.status).toBe(200);
    const cookie = loginResponse.headers.get("set-cookie");
    expect(cookie).toContain("workspace_session=");
    expect(cookie).toContain("HttpOnly");
    const session = (await loginResponse.json()) as {
      readonly user: { readonly id: string; readonly username: string };
      readonly authenticationMethods: { readonly email: string | null };
    };
    expect(session).toMatchObject({
      authenticated: true,
      emailAuthEnabled: true,
      user: { username: "alice" },
      authenticationMethods: { email: "alice@example.com", password: false },
    });

    const current = await fetch(`${base}/api/session`, {
      headers: { cookie: cookie!.split(";")[0]! },
    });
    expect(await current.json()).toMatchObject({
      authenticated: true,
      user: { id: session.user.id },
    });
  });

  it("reports Email sign-in as disabled when no provider is configured", async () => {
    const application = createWorkspaceApplication(
      {
        host: "127.0.0.1",
        port: 0,
        databaseFilename: ":memory:",
        collaborationDatabaseFilename: ":memory:",
        secureCookies: false,
        sessionTtlMs: 60_000,
      },
      {
        unitStore: {
          createUnit: async (input) => ({
            unitId: input.unitId,
            headRevision: 1,
          }),
        },
      }
    );
    applications.push(application);
    const base = await serve(application);

    const session = await fetch(`${base}/api/session`);
    expect(await session.json()).toMatchObject({
      authenticated: false,
      emailAuthEnabled: false,
    });

    const response = await fetch(`${base}/api/auth/email/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "EMAIL_AUTH_DISABLED" },
    });
  });

  it("rejects a malformed address without contacting the provider", async () => {
    const sent: EmailMessage[] = [];
    const application = createWorkspaceApplication(
      {
        host: "127.0.0.1",
        port: 0,
        databaseFilename: ":memory:",
        collaborationDatabaseFilename: ":memory:",
        secureCookies: false,
        sessionTtlMs: 60_000,
      },
      {
        unitStore: {
          createUnit: async (input) => ({
            unitId: input.unitId,
            headRevision: 1,
          }),
        },
        emailSender: {
          send: async (message) => {
            sent.push(message);
          },
        },
      }
    );
    applications.push(application);
    const base = await serve(application);

    const response = await fetch(`${base}/api/auth/email/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT", field: "email" },
    });
    expect(sent).toHaveLength(0);
  });
});

async function serve(application: WorkspaceApplication): Promise<string> {
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP server did not expose a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

function codeFrom(message: EmailMessage): string {
  const match = message.text.match(/\b([0-9]{6})\b/u);
  if (!match?.[1]) throw new Error("The message does not contain a code.");
  return match[1];
}
