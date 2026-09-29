import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { shutdownServer } from "../../server/src/server-lifecycle.js";

describe("Issue change feed", () => {
  it("tells Space members to refetch after a write and nobody else", async () => {
    const directory = mkdtempSync(join(tmpdir(), "univer-issue-feed-"));
    const application = createWorkspaceApplication({
      host: "127.0.0.1",
      port: 3020,
      databaseFilename: join(directory, "product.sqlite"),
      collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
      secureCookies: false,
      sessionTtlMs: 60_000,
    });
    const server = createServer(application.app);
    application.attachWebSocket(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const register = (username: string) =>
        application.identity.registerWithPassword({
          username,
          displayName: username,
          password: "correct horse battery staple",
        });
      const owner = await register("issue-feed-owner");
      const member = await register("issue-feed-member");
      const visitor = await register("issue-feed-visitor");
      const space = application.spaces.createTeamSpace(owner.view.user.id, { name: "Feed", publicRead: true });
      application.permissions.upsertTeamMember(owner.view.user.id, space.id, member.view.user.id, { role: "viewer" });

      const cookie = (session: { cookieValue: string }) => `${application.identity.cookieName}=${session.cookieValue}`;
      const memberSocket = await connect(origin, cookie(member));
      const visitorSocket = await connect(origin, cookie(visitor));

      const memberMessage = nextMessage(memberSocket);
      const visitorQuiet = noMessage(visitorSocket, 300);
      application.issues.create(owner.view.user.id, space.id, { title: "Announce" });
      await expect(memberMessage).resolves.toEqual({ event: "issuesChanged", spaceId: space.id });
      // Public read gives the visitor access to read Issues, but not a push.
      await expect(visitorQuiet).resolves.toBe(true);

      const rejectedQuiet = noMessage(memberSocket, 300);
      expect(() => application.issues.create(owner.view.user.id, space.id, { title: "" })).toThrow();
      await expect(rejectedQuiet).resolves.toBe(true);
    } finally {
      await shutdownServer(server, { dispose: async () => {} }, application);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

async function connect(origin: string, cookie: string): Promise<WebSocket> {
  const ticketResponse = await fetch(`${origin}/universer-api/user/session-ticket`, { headers: { cookie } });
  expect(ticketResponse.status).toBe(200);
  const body = (await ticketResponse.json()) as { readonly ticket: string };
  const socket = new WebSocket(
    `${origin.replace("http:", "ws:")}/api/worktree-events?sessionTicket=${encodeURIComponent(body.ticket)}`,
  );
  const ready = nextMessage(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(socket), { once: true });
  });
  expect(await ready).toEqual({ event: "worktreeChangeFeedReady" });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.addEventListener(
      "message",
      (event) => {
        if (typeof event.data !== "string") {
          reject(new Error("Change feed returned a non-text frame"));
          return;
        }
        resolve(JSON.parse(event.data) as unknown);
      },
      { once: true },
    );
  });
}

function noMessage(socket: WebSocket, milliseconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    const received = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      socket.removeEventListener("message", received);
      resolve(true);
    }, milliseconds);
    socket.addEventListener("message", received, { once: true });
  });
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}
