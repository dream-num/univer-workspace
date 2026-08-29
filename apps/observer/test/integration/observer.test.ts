import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createObserverApplication,
  type ObserverApplication,
} from "../../server/src/app.js";

let application: ObserverApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve()))
    );
  }
  application?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  application = undefined;
  server = undefined;
  directory = undefined;
});

describe("standalone Observer HTTP boundary", () => {
  it("uses its own identity and reads Workspace databases without writing them", async () => {
    const origin = await startApplication();
    const initial = await fetch(`${origin}/api/status`);
    await expect(initial.json()).resolves.toMatchObject({
      initialized: false,
      authenticated: false,
      setupTokenConfigured: true,
      githubOAuthEnabled: true,
    });

    const workspaceCookie = "workspace_session=not-an-observer-session";
    expect(
      (
        await fetch(`${origin}/api/overview`, {
          headers: { cookie: workspaceCookie },
        })
      ).status
    ).toBe(401);

    expect(() =>
      application!.productDatabase.connection
        .prepare("INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)")
        .run("forbidden", "forbidden", "Forbidden")
    ).toThrow();

    const rejected = await fetch(`${origin}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "x".repeat(32) }),
    });
    expect(rejected.status).toBe(403);

    const setup = await fetch(`${origin}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "s".repeat(32) }),
    });
    expect(setup.status).toBe(200);
    const authorization = (await setup.json()) as {
      readonly authorizationUrl: string;
    };
    const state = new URL(authorization.authorizationUrl).searchParams.get(
      "state"
    );
    const oauthCookie = cookieValue(
      setup.headers.getSetCookie(),
      "univer_observer_github_oauth"
    );
    const callback = await fetch(
      `${origin}/api/auth/github/callback?code=accepted&state=${encodeURIComponent(state ?? "")}`,
      { headers: { cookie: oauthCookie }, redirect: "manual" }
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
    const sessionCookie = cookieValue(
      callback.headers.getSetCookie(),
      "univer_observer_session"
    );

    const overview = await fetch(`${origin}/api/overview`, {
      headers: { cookie: sessionCookie },
    });
    expect(overview.status).toBe(200);
    await expect(overview.json()).resolves.toMatchObject({
      counts: { users: 1, spaces: 1 },
    });
    const filters = await fetch(
      `${origin}/api/filter-options?search=workspace`,
      { headers: { cookie: sessionCookie } }
    );
    expect(filters.status).toBe(200);
    await expect(filters.json()).resolves.toMatchObject({
      users: [{ username: "workspace-only-user" }],
    });
    const changesets = await fetch(`${origin}/api/changesets`, {
      headers: { cookie: sessionCookie },
    });
    expect(changesets.status).toBe(200);
    expect(changesets.headers.get("server-timing")).toContain(
      "collaboration;dur="
    );
    await expect(changesets.json()).resolves.toMatchObject({
      totals: { changesetCount: 0, mutationCount: 0, mutationSize: 0 },
      meta: { totalServerMs: expect.any(Number) },
    });
  });
});

async function startApplication(): Promise<string> {
  directory = mkdtempSync(join(tmpdir(), "observer-http-"));
  const productDatabaseFilename = join(directory, "product.sqlite");
  const collaborationDatabaseFilename = join(directory, "collaboration.sqlite");
  createProductDatabase(productDatabaseFilename);
  createCollaborationDatabase(collaborationDatabaseFilename);
  application = createObserverApplication(
    {
      host: "127.0.0.1",
      port: 3030,
      productDatabaseFilename,
      collaborationDatabaseFilename,
      observerDatabaseFilename: join(directory, "observer.sqlite"),
      blobDirectory: join(directory, "blobs"),
      setupToken: "s".repeat(32),
      secureCookies: false,
      sessionTtlMs: 60_000,
      queryTimeoutMs: 5_000,
      maxConcurrentQueries: 1,
      githubOAuth: null,
    },
    {
      oauthStateSecret: "o".repeat(32),
      githubOAuthProvider: {
        authorizationUrl({ state }) {
          return `https://github.test/authorize?state=${encodeURIComponent(state)}`;
        },
        async exchangeCode() {
          return {
            subject: "101",
            username: "observer-member",
            displayName: "Observer Member",
            avatarUrl: null,
          };
        },
      },
    }
  );
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

function createProductDatabase(filename: string): void {
  const database = new DatabaseSync(filename);
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, display_name TEXT, avatar_url TEXT);
    CREATE TABLE spaces (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, space_id TEXT);
    CREATE TABLE resources (id TEXT PRIMARY KEY, node_id TEXT);
    CREATE TABLE univer_resources (unit_id TEXT, resource_id TEXT, unit_type TEXT);
    CREATE TABLE worktree_node_intents (unit_id TEXT, name TEXT, target_space_id TEXT, unit_type TEXT);
    CREATE TABLE worktrees (id TEXT PRIMARY KEY);
    CREATE TABLE operations (state TEXT, lease_expires_at INTEGER, next_attempt_at INTEGER, kind TEXT, last_error_code TEXT);
    CREATE TABLE blob_resources (byte_size INTEGER, availability TEXT);
    CREATE TABLE blob_upload_sessions (state TEXT);
    CREATE TABLE object_deletion_jobs (id TEXT);
    CREATE TABLE univer_assets (byte_size INTEGER);
    INSERT INTO users VALUES ('user-1', 'workspace-only-user', 'Workspace Only', NULL);
    INSERT INTO spaces VALUES ('space-1', 'Workspace');
    PRAGMA user_version = 6;
  `);
  database.close();
}

function createCollaborationDatabase(filename: string): void {
  const database = new DatabaseSync(filename);
  database.exec(`
    CREATE TABLE collaboration_changesets (unit_id TEXT, payload_json TEXT);
    CREATE TABLE collaboration_worktree_changesets (worktree_id TEXT, unit_id TEXT, payload_json TEXT);
  `);
  database.close();
}

function cookieValue(setCookies: readonly string[], name: string): string {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Missing ${name} cookie`);
  return cookie.split(";", 1)[0]!;
}
