import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UniverType } from "@univerjs/protocol";
import { describe, expect, it } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { shutdownServer } from "../../server/src/server-lifecycle.js";

describe("worktree change feed", () => {
  it("notifies the product audience after every committed Worktree change", async () => {
    const directory = mkdtempSync(join(tmpdir(), "univer-worktree-feed-"));
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
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a TCP address");
    }
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      const creator = await application.identity.registerWithPassword({
        username: "worktree-feed-creator",
        displayName: "Worktree Feed Creator",
        password: "correct horse battery staple",
      });
      const other = await application.identity.registerWithPassword({
        username: "worktree-feed-other",
        displayName: "Worktree Feed Other",
        password: "correct horse battery staple",
      });
      const creatorSocket = await connect(
        origin,
        `${application.identity.cookieName}=${creator.cookieValue}`
      );
      const otherSocket = await connect(
        origin,
        `${application.identity.cookieName}=${other.cookieValue}`
      );
      const creatorMessages: unknown[] = [];
      const otherMessages: unknown[] = [];
      creatorSocket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          creatorMessages.push(JSON.parse(event.data) as unknown);
        }
      });
      otherSocket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          otherMessages.push(JSON.parse(event.data) as unknown);
        }
      });

      const creatorChange = nextMessage(creatorSocket);
      const created = await application.worktrees.create(
        creator.view.user.id,
        "worktree-feed-create-operation-0001",
        {
          kind: "user",
          name: "Realtime Worktree",
          summary: null,
          visibility: "private",
          teamSpaceId: null,
        }
      );

      await expect(creatorChange).resolves.toEqual({
        event: "worktreesChanged",
      });
      await expect(
        application.worktrees.list(creator.view.user.id, {
          scope: "active",
          kind: undefined,
          teamSpaceId: undefined,
          cursor: undefined,
          limit: undefined,
        })
      ).resolves.toMatchObject({
        items: [{ id: created.body.id, name: "Realtime Worktree" }],
      });

      await expectChange(creatorSocket, async () => {
        await application.worktrees.update(
          creator.view.user.id,
          created.body.id,
          { name: "Updated Realtime Worktree" }
        );
      });
      const personalSpace = application.spaces.list(
        creator.view.user.id
      ).spaces[0];
      if (!personalSpace) throw new Error("Personal space is missing");
      let unitId = "";
      await expectChange(creatorSocket, async () => {
        const added = await application.worktrees.addUnit(
          creator.view.user.id,
          created.body.id,
          "worktree-feed-add-unit-operation-0001",
          {
            source: "worktree",
            name: "Realtime Sheet",
            unitType: "sheet",
            targetSpaceId: personalSpace.id,
            targetParentNodeId: null,
          }
        );
        unitId = added.body.unit.unitId;
      });
      await expectChange(creatorSocket, async () => {
        await application.worktrees.submitChangeset(
          creator.view.user.id,
          created.body.id,
          unitId,
          {
            changeset: {
              unitID: unitId,
              type: UniverType.UNIVER_SHEET,
              baseRev: 1,
              revision: 2,
              sid: "worktree-feed-submit",
              reqId: 1,
              userID: "",
              memberID: "",
              mutations: [],
            },
          }
        );
      });
      await expectChange(creatorSocket, async () => {
        await application.worktrees.markReady(
          creator.view.user.id,
          created.body.id
        );
      });
      await expectChange(creatorSocket, async () => {
        await application.worktrees.reopen(
          creator.view.user.id,
          created.body.id
        );
      });
      await expectChange(creatorSocket, async () => {
        await application.worktrees.markReady(
          creator.view.user.id,
          created.body.id
        );
      });
      await expectChange(creatorSocket, async () => {
        await application.worktrees.merge(
          creator.view.user.id,
          created.body.id,
          "worktree-feed-merge-operation-0001"
        );
      });
      await expect(
        application.worktrees.list(creator.view.user.id, {
          scope: "processed",
          kind: undefined,
          teamSpaceId: undefined,
          cursor: undefined,
          limit: undefined,
        })
      ).resolves.toMatchObject({
        items: [{ id: created.body.id, state: "merged" }],
      });

      let discardedWorktreeId = "";
      await expectChange(creatorSocket, async () => {
        const discardable = await application.worktrees.create(
          creator.view.user.id,
          "worktree-feed-create-discard-operation-0001",
          {
            kind: "user",
            name: "Discardable Realtime Worktree",
            summary: null,
            visibility: "private",
            teamSpaceId: null,
          }
        );
        discardedWorktreeId = discardable.body.id;
      });
      const discardedChange = nextMessage(creatorSocket);
      await application.worktrees.discard(
        creator.view.user.id,
        discardedWorktreeId,
        "worktree-feed-discard-operation-0001"
      );
      await expect(discardedChange).resolves.toEqual({
        event: "worktreesChanged",
      });
      await expect(
        application.worktrees.list(creator.view.user.id, {
          scope: "processed",
          kind: undefined,
          teamSpaceId: undefined,
          cursor: undefined,
          limit: undefined,
        })
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: discardedWorktreeId,
            state: "discarded",
          }),
        ]),
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(creatorMessages).toHaveLength(10);
      expect(creatorMessages).toEqual(
        Array.from({ length: 10 }, () => ({ event: "worktreesChanged" }))
      );
      expect(otherMessages).toEqual([]);
    } finally {
      await shutdownServer(server, { dispose: async () => {} }, application);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("notifies both the previous and next audience when Team visibility changes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "univer-worktree-feed-"));
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
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose a TCP address");
    }
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      const owner = await application.identity.registerWithPassword({
        username: "worktree-feed-team-owner",
        displayName: "Worktree Feed Team Owner",
        password: "correct horse battery staple",
      });
      const viewer = await application.identity.registerWithPassword({
        username: "worktree-feed-team-viewer",
        displayName: "Worktree Feed Team Viewer",
        password: "correct horse battery staple",
      });
      const team = application.spaces.createTeamSpace(owner.view.user.id, {
        name: "Realtime Team",
      });
      application.permissions.upsertTeamMember(
        owner.view.user.id,
        team.id,
        viewer.view.user.id,
        { role: "viewer" }
      );
      const ownerSocket = await connect(
        origin,
        `${application.identity.cookieName}=${owner.cookieValue}`
      );
      const viewerSocket = await connect(
        origin,
        `${application.identity.cookieName}=${viewer.cookieValue}`
      );
      const ownerMessages: unknown[] = [];
      const viewerMessages: unknown[] = [];
      ownerSocket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          ownerMessages.push(JSON.parse(event.data) as unknown);
        }
      });
      viewerSocket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          viewerMessages.push(JSON.parse(event.data) as unknown);
        }
      });

      const ownerCreated = nextMessage(ownerSocket);
      const viewerCreated = noMessage(viewerSocket, 100);
      const created = await application.worktrees.create(
        owner.view.user.id,
        "worktree-feed-private-team-create-0001",
        {
          kind: "team",
          name: "Private Realtime Worktree",
          summary: null,
          visibility: "private",
          teamSpaceId: team.id,
        }
      );
      await expect(ownerCreated).resolves.toEqual({
        event: "worktreesChanged",
      });
      await expect(viewerCreated).resolves.toBe(true);

      const ownerPublished = nextMessage(ownerSocket);
      const viewerPublished = nextMessage(viewerSocket);
      await application.worktrees.update(
        owner.view.user.id,
        created.body.id,
        { visibility: "space" }
      );
      await expect(ownerPublished).resolves.toEqual({
        event: "worktreesChanged",
      });
      await expect(viewerPublished).resolves.toEqual({
        event: "worktreesChanged",
      });

      const ownerPrivatized = nextMessage(ownerSocket);
      const viewerPrivatized = nextMessage(viewerSocket);
      await application.worktrees.update(
        owner.view.user.id,
        created.body.id,
        { visibility: "private" }
      );
      await expect(ownerPrivatized).resolves.toEqual({
        event: "worktreesChanged",
      });
      await expect(viewerPrivatized).resolves.toEqual({
        event: "worktreesChanged",
      });
      await expect(
        application.worktrees.get(viewer.view.user.id, created.body.id)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(ownerMessages).toHaveLength(3);
      expect(viewerMessages).toHaveLength(2);
    } finally {
      await shutdownServer(server, { dispose: async () => {} }, application);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

async function expectChange(
  socket: WebSocket,
  action: () => Promise<void>
): Promise<void> {
  const message = nextMessage(socket);
  await action();
  await expect(message).resolves.toEqual({ event: "worktreesChanged" });
}

async function connect(origin: string, cookie: string): Promise<WebSocket> {
  const ticketResponse = await fetch(
    `${origin}/universer-api/user/session-ticket`,
    { headers: { cookie } }
  );
  expect(ticketResponse.status).toBe(200);
  const body = (await ticketResponse.json()) as { readonly ticket: string };
  const socket = new WebSocket(
    `${origin.replace("http:", "ws:")}/api/worktree-events?sessionTicket=${encodeURIComponent(body.ticket)}`
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
          reject(new Error("Worktree change feed returned a non-text frame"));
          return;
        }
        resolve(JSON.parse(event.data) as unknown);
      },
      { once: true }
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
