import { getDocsEmptySnapshot, JSONX, TextXActionType, getBasesEmptySnapshot } from "@univerjs/core";
import { getSlidesEmptySnapshot, PageTypeEnum, PageElementTypeEnum } from "@univerjs-pro/slides";
import { getBoardsEmptySnapshot, BoardElementType } from "@univerjs-pro/boards";
import { createDefaultBaseTableSnapshot } from "@univerjs-pro/bases";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  deserializeToCombResponse,
  serializeCombRequest,
} from "@univerjs-pro/collaboration-client";
import {
  CmdRspCode,
  CombCmd,
  CommentSolvedStatus,
  ErrorCode,
  UnitAction,
  UniverType,
} from "@univerjs/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";

import { httpRequestDurationSeconds } from "../../server/src/middleware/metrics.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];
const sockets: WebSocket[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    sockets.splice(0).map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          socket.addEventListener("close", () => resolve(), { once: true });
          socket.close();
        })
    )
  );
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
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("collaboration gateway", () => {
  it.each(["link", "space", "move", "trash", "trash-once"] as const)(
    "allows anonymous %s readers without granting writes or Worktree access",
    async (policy) => {
      const { application, origin } = await startApplication();
      const issued = await application.identity.registerWithPassword({
        username: "anonymous-owner",
        displayName: "Owner",
        password: "correct horse battery staple",
      });
      const ownerId = issued.view.user.id;
      const space = application.spaces.list(ownerId).spaces[0]!;
      const parent = application.nodes.create(ownerId, {
        spaceId: space.id,
        parentNodeId: null,
        name: "Private parent",
      });
      const shared = application.nodes.create(ownerId, {
        spaceId: space.id,
        parentNodeId: parent.id,
        name: "Shared folder",
      });
      const created = await application.resources.create(ownerId, "anonymous-sheet-create-0001", {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: shared.id,
        name: "Public sheet",
        unitType: "sheet",
      });
      if (created.status === 202 || created.body.node.resource?.kind !== "univer")
        throw new Error("Missing Unit");
      const node = created.body.node;
      const resource = created.body.node.resource;
      const snapshotUrl = `${origin}/universer-api/snapshot/2/unit/${resource.unitId}/rev/0`;
      expect((await fetch(`${origin}/api/nodes/${node.id}`)).status).toBe(404);
      expect((await fetch(snapshotUrl)).status).toBe(403);
      if (policy !== "space") {
        application.permissions.updateNodeLinkSharing(ownerId, shared.id, {
          enabled: true,
          role: "editor",
        });
      } else {
        application.spaces.update(ownerId, space.id, { publicRead: true });
      }

      const metadata = await fetch(`${origin}/api/nodes/${node.id}`);
      expect(metadata.status).toBe(200);
      expect(metadata.headers.get("cache-control")).toBe("private, no-store");
      await expect(metadata.json()).resolves.toMatchObject({
        node: {
          accessRole: "viewer",
          capabilities: { rename: false, createChildren: false, share: false, trash: false },
        },
        navigationRootNodeId: policy !== "space" ? shared.id : null,
      });
      const children = await fetch(`${origin}/api/nodes/${shared.id}/children`);
      await expect(children.json()).resolves.toMatchObject({ nodes: [{ id: node.id }] });
      expect((await fetch(`${origin}/api/nodes/${parent.id}`)).status).toBe(
        policy !== "space" ? 404 : 200,
      );
      expect((await fetch(`${origin}/api/spaces/${space.id}/nodes`)).status).toBe(
        policy !== "space" ? 404 : 200,
      );
      expect((await fetch(`${origin}/api/spaces/${space.id}`)).status).toBe(401);
      expect((await fetch(`${origin}/api/resources/${resource.id}`)).status).toBe(401);
      expect((await fetch(`${origin}/api/unit-resources/${resource.unitId}`)).status).toBe(200);
      const opened = await fetch(`${origin}/api/resources/${resource.id}/open`, { method: "POST" });
      await expect(opened.json()).resolves.toMatchObject({
        resource: { editorMode: "readOnly", accessRole: "viewer" },
      });
      expect(
        application.database.connection
          .prepare("SELECT COUNT(*) AS count FROM recent_resources")
          .get()?.count,
      ).toBe(0);
      expect(
        application.database.connection.prepare("SELECT COUNT(*) AS count FROM users").get()?.count,
      ).toBe(1);
      expect(
        application.database.connection
          .prepare("SELECT COUNT(*) AS count FROM login_sessions")
          .get()?.count,
      ).toBe(1);
      expect((await fetch(`${origin}/api/session`)).headers.get("set-cookie")).toBeNull();
      expect((await fetch(snapshotUrl)).status).toBe(200);
      expect((await fetch(`${snapshotUrl}?readOnly=true`)).status).toBe(200);
      expect(
        (await fetch(`${origin}/universer-api/comment/unit/${resource.unitId}/list`)).status,
      ).toBe(200);

      const authz = await fetch(`${origin}/universer-api/authz/-/object/-/batch_allowed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              unitID: resource.unitId,
              actions: [
                UnitAction.View,
                UnitAction.Edit,
                UnitAction.Comment,
                UnitAction.Share,
              ],
            },
          ],
        }),
      });
      await expect(authz.json()).resolves.toMatchObject({
        objectActions: [
          {
            actions: [
              { action: UnitAction.View, allowed: true },
              { action: UnitAction.Edit, allowed: false },
              { action: UnitAction.Comment, allowed: true },
              { action: UnitAction.Share, allowed: false },
            ],
          },
        ],
      });

      const first = await joinUnit(origin, "", resource.unitId);
      const second = await joinUnit(origin, "", resource.unitId);
      expect(second.memberId).not.toBe(first.memberId);
      expect(second.members).toHaveLength(2);
      for (const [path, method] of [
        ["/api/spaces", "GET"],
        ["/api/recent-resources", "GET"],
        ["/api/worktrees", "GET"],
        [`/api/nodes/${node.id}`, "PATCH"],
        [`/api/nodes/${node.id}/link-sharing`, "PUT"],
        ["/api/resources", "POST"],
        ["/api/blob-upload-sessions", "POST"],
        ["/universer-api/stream/file/upload", "POST"],
        [`/universer-api/comment/unit/${resource.unitId}/add`, "POST"],
        [`/universer-api/comb/2/unit/${resource.unitId}/new_changes`, "POST"],
        ["/universer-api/snapshot/-/units", "DELETE"],
        ["/universer-api/snapshot/-/units/recover", "POST"],
        ["/universer-api/worktrees/unknown", "GET"],
        ["/universer-api/snapshot/unknown", "GET"],
        [`/universer-api/history/${resource.unitId}/list/unknown`, "GET"],
        ["/universer-api/user/session-ticket", "POST"],
      ]) {
        const response = await fetch(`${origin}${path}`, { method });
        expect(response.status, `${method} ${path}`).toBe(401);
      }

      if (policy === "link") {
        application.permissions.updateNodeLinkSharing(ownerId, shared.id, {
          enabled: false,
          role: "editor",
        });
      } else if (policy === "space") {
        application.spaces.update(ownerId, space.id, { publicRead: false });
      } else if (policy === "move") {
        application.nodes.update(ownerId, node.id, { parentNodeId: parent.id });
      } else if (policy === "trash") {
        application.trash.trashNode(ownerId, shared.id);
      } else {
        application.trash.trashNodeOnce(ownerId, shared.id, "anonymous-trash-once");
      }
      expect((await fetch(snapshotUrl)).status).toBe(403);
      expect(
        (await fetch(`${origin}/api/resources/${resource.id}/open`, { method: "POST" })).status,
      ).toBe(404);
      if (policy === "link") {
        // Preserve the existing Link Sharing invalidation behavior.
        await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
        await expect.poll(() => second.socket.readyState).toBe(WebSocket.CLOSED);
      }
    },
  );

  it("serves complete Thread Comment workflows for all five Trunk Unit types", async () => {
    const { application, origin } = await startApplication();
    const owner = await application.identity.registerWithPassword({
      username: "comment-owner",
      displayName: "Comment Owner",
      password: "correct horse battery staple",
    });
    const collaborator = await application.identity.registerWithPassword({
      username: "comment-collaborator",
      displayName: "Comment Collaborator",
      password: "correct horse battery staple",
    });
    const ownerCookie =
      `${application.identity.cookieName}=${owner.cookieValue}`;
    const collaboratorCookie =
      `${application.identity.cookieName}=${collaborator.cookieValue}`;
    const space = application.spaces.list(owner.view.user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");

    for (const unitType of [
      "sheet",
      "doc",
      "slide",
      "base",
      "board",
    ] as const) {
      const created = await application.resources.create(
        owner.view.user.id,
        `comment-create-${unitType}-0001`,
        {
          kind: "univer",
          spaceId: space.id,
          parentNodeId: null,
          name: `Comment ${unitType}`,
          unitType,
        }
      );
      if (created.status === 202) {
        throw new Error("Resource creation is pending");
      }
      const resourceId = created.body.node.resource?.id;
      if (!resourceId) throw new Error("Created Resource is missing");
      const opened = application.resources.open(
        owner.view.user.id,
        resourceId
      );
      if (opened.resource.kind !== "univer") {
        throw new Error("Created Resource is not a Univer Resource");
      }
      application.permissions.updateNodeLinkSharing(
        owner.view.user.id,
        created.body.node.id,
        { enabled: true, role: "editor" }
      );

      const ownerConnection = await joinUnit(
        origin,
        ownerCookie,
        opened.resource.unitId
      );
      const collaboratorConnection = await joinUnit(
        origin,
        collaboratorCookie,
        opened.resource.unitId
      );
      const rootResponse = await commentWrite(origin, ownerCookie, "add", {
        memberId: ownerConnection.memberId,
        unitId: opened.resource.unitId,
        content: `${unitType} root`,
        mention: [],
      });
      expect(rootResponse.status).toBe(200);
      const root = (await rootResponse.json()) as {
        readonly comment: {
          readonly threadId: string;
          readonly replies: readonly [{ readonly replyId: string }];
        };
      };

      const replyResponse = await commentWrite(
        origin,
        collaboratorCookie,
        "reply",
        {
          memberId: collaboratorConnection.memberId,
          unitId: opened.resource.unitId,
          threadId: root.comment.threadId,
          content: `${unitType} reply`,
          mention: [],
        }
      );
      expect(replyResponse.status).toBe(200);
      const reply = (await replyResponse.json()) as {
        readonly reply: { readonly replyId: string };
      };

      expect(
        (
          await commentWrite(origin, collaboratorCookie, "edit", {
            memberId: collaboratorConnection.memberId,
            unitId: opened.resource.unitId,
            threadId: root.comment.threadId,
            replyId: reply.reply.replyId,
            content: `${unitType} reply edited`,
            mention: [],
          })
        ).status
      ).toBe(200);
      for (const solved of [
        CommentSolvedStatus.Solved,
        CommentSolvedStatus.OpenOrReOpen,
      ]) {
        expect(
          (
            await commentWrite(origin, collaboratorCookie, "solved", {
              memberId: collaboratorConnection.memberId,
              unitId: opened.resource.unitId,
              threadId: root.comment.threadId,
              solved,
            })
          ).status
        ).toBe(200);
      }

      const collaboratorDeleteRoot = await commentWrite(
        origin,
        collaboratorCookie,
        "delete",
        {
          memberId: collaboratorConnection.memberId,
          unitId: opened.resource.unitId,
          threadId: root.comment.threadId,
          replyId: root.comment.replies[0].replyId,
        }
      );
      expect(collaboratorDeleteRoot.status).toBe(403);

      const listed = await fetch(
        `${origin}/universer-api/comment/unit/${opened.resource.unitId}/list?threadId=${encodeURIComponent(root.comment.threadId)}`,
        { headers: { cookie: ownerCookie } }
      );
      expect(listed.status).toBe(200);
      await expect(listed.json()).resolves.toMatchObject({
        comments: {
          [root.comment.threadId]: {
            solved: CommentSolvedStatus.OpenOrReOpen,
            replies: [
              { content: `${unitType} root`, userId: owner.view.user.id },
              {
                replyId: reply.reply.replyId,
                content: `${unitType} reply edited`,
                userId: collaborator.view.user.id,
              },
            ],
          },
        },
        users: {
          [owner.view.user.id]: { name: "Comment Owner" },
          [collaborator.view.user.id]: { name: "Comment Collaborator" },
        },
      });

      expect(
        (
          await commentWrite(origin, collaboratorCookie, "delete", {
            memberId: collaboratorConnection.memberId,
            unitId: opened.resource.unitId,
            threadId: root.comment.threadId,
            replyId: reply.reply.replyId,
          })
        ).status
      ).toBe(200);
      expect(
        (
          await commentWrite(origin, ownerCookie, "delete", {
            memberId: ownerConnection.memberId,
            unitId: opened.resource.unitId,
            threadId: root.comment.threadId,
            replyId: root.comment.replies[0].replyId,
          })
        ).status
      ).toBe(200);
    }
  });

  it("serves persistent standard History for all five Trunk Unit types", async () => {
    const started = await startApplication();
    let application = started.application;
    let origin = started.origin;
    const { collaborationDatabaseFilename } = started;
    const owner = await application.identity.registerWithPassword({
      username: "history-owner",
      displayName: "History Owner",
      password: "correct horse battery staple",
    });
    const ownerId = owner.view.user.id;
    const ownerCookie =
      `${application.identity.cookieName}=${owner.cookieValue}`;
    const space = application.spaces.list(ownerId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const createdUnits: Array<{
      readonly nodeId: string;
      readonly unitId: string;
      readonly unitType: "sheet" | "doc" | "slide" | "base" | "board";
    }> = [];

    for (const unitType of [
      "sheet",
      "doc",
      "slide",
      "base",
      "board",
    ] as const) {
      const created = await application.resources.create(
        ownerId,
        `history-create-${unitType}-0001`,
        {
          kind: "univer",
          spaceId: space.id,
          parentNodeId: null,
          name: `History ${unitType}`,
          unitType,
        }
      );
      if (created.status === 202) throw new Error("Resource creation is pending");
      const resourceId = created.body.node.resource?.id;
      if (!resourceId) throw new Error("Created Resource is missing");
      const opened = application.resources.open(ownerId, resourceId);
      if (opened.resource.kind !== "univer") {
        throw new Error("Created Resource is not a Univer Resource");
      }
      createdUnits.push({
        nodeId: created.body.node.id,
        unitId: opened.resource.unitId,
        unitType,
      });

      const response = await fetch(
        `${origin}/universer-api/history/${opened.resource.unitId}/list?length=20`,
        { headers: { cookie: ownerCookie } }
      );
      const body = (await response.json()) as {
        readonly error: { readonly code: number };
        readonly historyIds: readonly string[];
        readonly entities: {
          readonly datas: Readonly<
            Record<string, { readonly unitId: string; readonly userId: string }>
          >;
          readonly users: Readonly<
            Record<string, { readonly name: string }>
          >;
        };
      };
      expect(response.status).toBe(200);
      expect(body.error.code).toBe(ErrorCode.OK);
      expect(body.historyIds).toHaveLength(1);
      expect(body.entities.datas[body.historyIds[0]!]).toMatchObject({
        unitId: opened.resource.unitId,
        userId: ownerId,
      });
      expect(body.entities.users[ownerId]).toMatchObject({
        name: "History Owner",
      });
    }

    // Simulate data created before persistent History was introduced. The
    // compatibility backfill is startup-only; a normal read must not run it.
    const database = new DatabaseSync(collaborationDatabaseFilename);
    try {
      database.prepare("DELETE FROM collaboration_history_revisions").run();
    } finally {
      database.close();
    }
    const beforeRestart = await fetch(
      `${origin}/universer-api/history/${createdUnits[0]!.unitId}/list?length=20`,
      { headers: { cookie: ownerCookie } }
    );
    expect(beforeRestart.status).toBe(200);
    await expect(beforeRestart.json()).resolves.toMatchObject({
      historyIds: [],
    });
    await stopApplication(application, started.server);
    const restarted = await startApplication(started.directory);
    application = restarted.application;
    origin = restarted.origin;

    for (const unit of createdUnits) {
      const response = await fetch(
        `${origin}/universer-api/history/${unit.unitId}/list?length=20`,
        { headers: { cookie: ownerCookie } }
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        historyIds: [expect.any(String)],
      });
    }

    const historyDatabase = new DatabaseSync(collaborationDatabaseFilename, {
      readOnly: true,
    });
    try {
      expect(
        historyDatabase
          .prepare(
            "SELECT version FROM collaboration_schema_versions WHERE component = 'history'"
          )
          .get()
      ).toMatchObject({ version: 1 });
      expect(
        historyDatabase
          .prepare(
            "SELECT COUNT(*) AS count FROM collaboration_history_revisions"
          )
          .get()
      ).toMatchObject({ count: 5 });
    } finally {
      historyDatabase.close();
    }

    const first = createdUnits[0];
    if (!first) throw new Error("History Unit is missing");
    const viewer = await application.identity.registerWithPassword({
      username: "history-viewer",
      displayName: "History Viewer",
      password: "correct horse battery staple",
    });
    application.permissions.updateNodeLinkSharing(ownerId, first.nodeId, {
      enabled: true,
      role: "viewer",
    });
    const viewerCookie =
      `${application.identity.cookieName}=${viewer.cookieValue}`;
    const viewerHistory = await fetch(
      `${origin}/universer-api/history/${first.unitId}/list?length=20`,
      { headers: { cookie: viewerCookie } }
    );
    expect(viewerHistory.status).toBe(200);
    await expect(viewerHistory.json()).resolves.toMatchObject({
      historyIds: [expect.any(String)],
    });

    const directAuthz = await fetch(
      `${origin}/universer-api/authz/4/object/${first.unitId}/allowed`,
      {
        method: "POST",
        headers: {
          cookie: viewerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          unitID: first.unitId,
          objectID: first.unitId,
          actions: [
            UnitAction.IHistory,
            UnitAction.ViewHistory,
            UnitAction.Edit,
          ],
        }),
      }
    );
    expect(directAuthz.status).toBe(200);
    await expect(directAuthz.json()).resolves.toMatchObject({
      actions: [
        { action: UnitAction.IHistory, allowed: true },
        { action: UnitAction.ViewHistory, allowed: true },
        { action: UnitAction.Edit, allowed: false },
      ],
    });

    await expect(
      fetch(`${origin}/universer-api/history/${first.unitId}/list?length=20`)
    ).resolves.toMatchObject({ status: 200 });
  });

  it("stores an authoritative server createTime for Trunk changesets", async () => {
    const { application, origin, collaborationDatabaseFilename } =
      await startApplication();
    const issued = await application.identity.registerWithPassword({
      username: "gateway-create-time-user",
      displayName: "Gateway Create Time User",
      password: "correct horse battery staple",
    });
    const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
    const space = application.spaces.list(issued.view.user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const created = await application.resources.create(
      issued.view.user.id,
      "gateway-create-time-resource-0001",
      {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: null,
        name: "Create Time Sheet",
        unitType: "sheet",
      }
    );
    if (created.status === 202) throw new Error("Resource creation is pending");
    const resourceId = created.body.node.resource?.id;
    if (!resourceId) throw new Error("Created Resource is missing");
    const unitId = application.resources.open(
      issued.view.user.id,
      resourceId
    ).resource.unitId;
    const connection = await joinUnit(origin, cookie, unitId);
    const beforeSubmit = currentUnixTimeSeconds();
    const submitResponse = await fetch(
      `${origin}/universer-api/comb/${UniverType.UNIVER_SHEET}/unit/${unitId}/new_changes`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          unitID: unitId,
          memberID: connection.memberId,
          type: UniverType.UNIVER_SHEET,
          changeset: {
            unitID: unitId,
            type: UniverType.UNIVER_SHEET,
            baseRev: 1,
            revision: 2,
            sid: "gateway-create-time-session",
            reqId: 1,
            userID: issued.view.user.id,
            memberID: connection.memberId,
            mutations: [],
            createTime: 1,
          },
        }),
      }
    );
    const afterSubmit = currentUnixTimeSeconds();
    expect(submitResponse.status).toBe(200);
    await expect(submitResponse.json()).resolves.toMatchObject({
      error: { code: ErrorCode.OK },
    });

    const stored = readStoredChangesetMetadata(
      collaborationDatabaseFilename,
      "collaboration_changesets",
      unitId
    );
    expectUnixSecondsWithin(
      stored.createTime,
      beforeSubmit,
      afterSubmit
    );
    expect(stored.mutationSize).toBe(2);
  });

  it("rejects direct SDK removal outside the product API", async () => {
    const { application, origin } = await startApplication();
    const issued = await application.identity.registerWithPassword({
      username: "removal-gateway-user",
      displayName: "Removal Gateway User",
      password: "correct horse battery staple",
    });
    const userId = issued.view.user.id;
    const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const created = await application.worktrees.create(userId, "guard-worktree-create-0001", {
      kind: "user",
      name: "Guard deletion",
      summary: null,
    });
    const added = await application.worktrees.addUnit(
      userId,
      created.body.id,
      "guard-unit-create-0001",
      {
        source: "worktree",
        name: "Guard document",
        unitType: "doc",
        targetSpaceId: space.id,
        targetParentNodeId: null,
      },
    );
    const response = await fetch(
      `${origin}/universer-api/worktrees/${created.body.id}/units/${added.body.unit.unitId}/removal`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ removed: true }),
      },
    );
    expect(response.status).toBe(403);
    await response.text();
    expect(
      (await application.worktrees.get(userId, created.body.id)).worktree.units[0]?.change,
    ).toBe("added");
    for (const removed of [true, false]) {
      const update = await fetch(
        `${origin}/api/worktrees/${created.body.id}/units/${added.body.unit.unitId}/removal`,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ removed }),
        },
      );
      expect(update.status).toBe(200);
      await expect(update.json()).resolves.toMatchObject({
        worktree: { units: [expect.objectContaining({ change: removed ? "deleted" : "added" })] },
      });
    }
  });

  it("retains Base-to-draft comparison after merge/discard and pins the recorded merge revision", async () => {
    const { application, origin } = await startApplication();
    const issued = await application.identity.registerWithPassword({
      username: "history-review", displayName: "History reviewer",
      password: "correct horse battery staple",
    });
    const userId = issued.view.user.id;
    const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
    const space = application.spaces.list(userId).spaces[0]!;
    const created = await application.resources.create(userId, "history-resource-0001", {
      kind: "univer", spaceId: space.id, parentNodeId: null, name: "History", unitType: "sheet",
    });
    if (created.status === 202) throw new Error("Resource creation pending");
    const resourceId = created.body.node.resource!.id;
    for (const status of ["merged", "discarded"] as const) {
      const worktree = await application.worktrees.create(userId, `history-${status}-0001`, {
        kind: "user", name: `History ${status}`, summary: null,
      });
      const worktreeId = worktree.body.id;
      const added = await application.worktrees.addUnit(userId, worktreeId, `history-unit-${status}-0001`, {
        source: "trunk", resourceId,
      });
      const unitId = added.body.unit.unitId;
      const endpoint = `${origin}/universer-api/worktrees/${worktreeId}/units/${unitId}/comparison`;
      const before = await fetch(`${endpoint}?baseMode=base`, { headers: { cookie } });
      expect(before.status).toBe(200);
      const baseline = await before.json();
      const revision = baseline.right.revision;
      await application.worktrees.submitChangeset(userId, worktreeId, unitId, {
        changeset: { unitID: unitId, type: UniverType.UNIVER_SHEET,
          baseRev: revision, revision: revision + 1, sid: "history-review", reqId: 1,
          userID: "", memberID: "", createTime: 1, mutations: [],
        },
      });
      if (status === "merged") {
        await application.worktrees.markReady(userId, worktreeId);
        const preview = await fetch(`${endpoint}?baseMode=base&view=preview`, { headers: { cookie } });
        expect(preview.status).toBe(200);
        expect(await preview.json()).toMatchObject({ baseMode: "base", view: "preview" });
        await application.worktrees.merge(userId, worktreeId, "history-merge-0001");
      } else {
        await application.worktrees.discard(userId, worktreeId, "history-discard-0001");
      }
      const historical = await fetch(`${endpoint}?baseMode=base`, { headers: { cookie } });
      expect(historical.status).toBe(200);
      expect(await historical.json()).toMatchObject({
        baseMode: "base", view: "draft",
        left: baseline.left,
        right: { revision: revision + 1, unitData: { id: unitId } },
      });
      if (status === "merged") {
        const result = await fetch(`${endpoint}?baseMode=base&view=merged`, { headers: { cookie } });
        expect(result.status).toBe(200);
        expect(await result.json()).toMatchObject({
          view: "merged", left: baseline.left, right: { unitData: { id: unitId } },
        });
      }
      if (status === "discarded") {
        for (const view of ["merged", "preview"]) {
          const unavailable = await fetch(`${endpoint}?baseMode=base&view=${view}`, { headers: { cookie } });
          expect(unavailable.status).toBe(409);
        }
      }
      const invalid = await fetch(`${endpoint}?baseMode=invalid`, { headers: { cookie } });
      expect(invalid.status).toBe(400);
      const unauthorized = await fetch(`${endpoint}?baseMode=base`);
      expect(unauthorized.status).toBe(401);
    }
  }, 60_000);

  it("binds the authenticated product user and Node permissions to Univer protocol", async () => {
    const { application, origin, collaborationDatabaseFilename } =
      await startApplication();
    const issued = await application.identity.registerWithPassword({
      username: "gateway-user",
      displayName: "Gateway User",
      password: "correct horse battery staple",
    });
    const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
    application.identity.updateCurrentUser(cookie, {
      avatarUrl: "https://avatars.example/gateway-user.png",
    });
    const space = application.spaces.list(issued.view.user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const created = await application.resources.create(
      issued.view.user.id,
      "gateway-create-resource-0001",
      {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: null,
        name: "Gateway Sheet",
        unitType: "sheet",
      }
    );
    if (created.status === 202) throw new Error("Resource creation is pending");
    const nodeId = created.body.node.id;
    const resourceId = created.body.node.resource?.id;
    if (!resourceId) throw new Error("Created Resource is missing");
    const opened = application.resources.open(
      issued.view.user.id,
      resourceId
    );

    await expect(
      fetch(`${origin}/universer-api/user`)
    ).resolves.toMatchObject({ status: 200 });

    const userResponse = await fetch(`${origin}/universer-api/user`, {
      headers: { cookie },
    });
    expect(userResponse.status).toBe(200);
    await expect(userResponse.json()).resolves.toMatchObject({
      user: {
        userID: issued.view.user.id,
        name: "Gateway User",
      },
    });

    const authzResponse = await fetch(
      `${origin}/universer-api/authz/-/object/-/batch_allowed`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              unitID: opened.resource.unitId,
              objectID: opened.resource.unitId,
              actions: [
                UnitAction.View,
                UnitAction.Comment,
                UnitAction.Edit,
              ],
            },
          ],
        }),
      }
    );
    expect(authzResponse.status).toBe(200);
    await expect(authzResponse.json()).resolves.toMatchObject({
      objectActions: [
        {
          unitID: opened.resource.unitId,
          actions: [
            { action: UnitAction.View, allowed: true },
            { action: UnitAction.Comment, allowed: true },
            { action: UnitAction.Edit, allowed: true },
          ],
        },
      ],
    });

    httpRequestDurationSeconds.reset();
    const snapshotResponse = await fetch(
      `${origin}/universer-api/snapshot/${UniverType.UNIVER_SHEET}/unit/${opened.resource.unitId}/rev/0`,
      { headers: { cookie } }
    );
    expect(snapshotResponse.status).toBe(200);
    const requestCounts = (await httpRequestDurationSeconds.get()).values.filter(
      (value) => value.metricName.endsWith("_count")
    );
    expect(requestCounts).toEqual([
      expect.objectContaining({
        value: 1,
        labels: {
          method: "GET",
          route: "/universer-api/snapshot/:type/unit/:unitID/rev/:revision",
          status_code: 200,
        },
      }),
    ]);
    await expect(snapshotResponse.json()).resolves.toMatchObject({
      snapshot: {
        unitID: opened.resource.unitId,
        type: UniverType.UNIVER_SHEET,
      },
    });

    const ticketResponse = await fetch(
      `${origin}/universer-api/user/session-ticket`,
      { headers: { cookie } }
    );
    expect(ticketResponse.status).toBe(200);
    const ticket = (await ticketResponse.json()) as {
      readonly ticket: string;
    };
    expect(ticket.ticket).toEqual(expect.any(String));

    await expect(
      fetch(
        `${origin}/universer-api/comment/unit/${opened.resource.unitId}/list`
      )
    ).resolves.toMatchObject({ status: 403 });
    const ownerConnection = await joinUnit(
      origin,
      cookie,
      opened.resource.unitId
    );
    expect(ownerConnection.members).toEqual([
      {
        memberID: ownerConnection.memberId,
        userID: issued.view.user.id,
        name: "Gateway User",
        avatar: "https://avatars.example/gateway-user.png",
      },
    ]);
    const addCommentResponse = await fetch(
      `${origin}/universer-api/comment/unit/${opened.resource.unitId}/add`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          memberId: ownerConnection.memberId,
          unitId: opened.resource.unitId,
          content: "Gateway comment",
          mention: [],
        }),
      }
    );
    expect(addCommentResponse.status).toBe(200);
    const added = (await addCommentResponse.json()) as {
      readonly comment: { readonly threadId: string };
    };
    expect(added.comment.threadId).toEqual(expect.any(String));
    const ownerCommentsResponse = await fetch(
      `${origin}/universer-api/comment/unit/${opened.resource.unitId}/list?threadId=${encodeURIComponent(added.comment.threadId)}`,
      { headers: { cookie } }
    );
    expect(ownerCommentsResponse.status).toBe(200);
    await expect(ownerCommentsResponse.json()).resolves.toMatchObject({
      comments: {
        [added.comment.threadId]: {
          replies: [
            { content: "Gateway comment", userId: issued.view.user.id },
          ],
        },
      },
      users: {
        [issued.view.user.id]: {
          userID: issued.view.user.id,
          name: "Gateway User",
        },
      },
    });

    const viewer = await application.identity.registerWithPassword({
      username: "gateway-viewer",
      displayName: "Gateway Viewer",
      password: "correct horse battery staple",
    });
    const unauthenticatedLinkSharingResponse = await fetch(
      `${origin}/api/nodes/${nodeId}/link-sharing`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, role: "viewer" }),
      }
    );
    expect(unauthenticatedLinkSharingResponse.status).toBe(401);
    const linkSharingResponse = await fetch(
      `${origin}/api/nodes/${nodeId}/link-sharing`,
      {
        method: "PUT",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: true, role: "viewer" }),
      }
    );
    expect(linkSharingResponse.status).toBe(200);
    await expect(linkSharingResponse.json()).resolves.toMatchObject({
      enabled: true,
      role: "viewer",
      createdBy: { id: issued.view.user.id },
    });
    const viewerCookie =
      `${application.identity.cookieName}=${viewer.cookieValue}`;
    const viewerAuthzResponse = await fetch(
      `${origin}/universer-api/authz/-/object/-/batch_allowed`,
      {
        method: "POST",
        headers: {
          cookie: viewerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              unitID: opened.resource.unitId,
              objectID: opened.resource.unitId,
              actions: [
                UnitAction.View,
                UnitAction.Comment,
                UnitAction.Edit,
              ],
            },
          ],
        }),
      }
    );
    await expect(viewerAuthzResponse.json()).resolves.toMatchObject({
      objectActions: [
        {
          actions: [
            { action: UnitAction.View, allowed: true },
            { action: UnitAction.Comment, allowed: true },
            { action: UnitAction.Edit, allowed: false },
          ],
        },
      ],
    });
    const viewerSnapshot = await fetch(
      `${origin}/universer-api/snapshot/${UniverType.UNIVER_SHEET}/unit/${opened.resource.unitId}/rev/0`,
      { headers: { cookie: viewerCookie } }
    );
    expect(viewerSnapshot.status).toBe(200);
    const viewerCommentsResponse = await fetch(
      `${origin}/universer-api/comment/unit/${opened.resource.unitId}/list`,
      { headers: { cookie: viewerCookie } }
    );
    expect(viewerCommentsResponse.status).toBe(200);
    await expect(viewerCommentsResponse.json()).resolves.toMatchObject({
      comments: {
        [added.comment.threadId]: {
          replies: [{ content: "Gateway comment" }],
        },
      },
    });
    const viewerConnection = await joinUnit(
      origin,
      viewerCookie,
      opened.resource.unitId
    );
    const viewerAddCommentResponse = await fetch(
      `${origin}/universer-api/comment/unit/${opened.resource.unitId}/add`,
      {
        method: "POST",
        headers: {
          cookie: viewerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          memberId: viewerConnection.memberId,
          unitId: opened.resource.unitId,
          content: "Viewer comment",
          mention: [],
        }),
      }
    );
    expect(viewerAddCommentResponse.status).toBe(200);
    const viewerAdded = (await viewerAddCommentResponse.json()) as {
      readonly comment: {
        readonly threadId: string;
        readonly replies: readonly [{ readonly replyId: string }];
      };
    };
    const viewerEditOwnerResponse = await fetch(
      `${origin}/universer-api/comment/unit/${opened.resource.unitId}/edit`,
      {
        method: "POST",
        headers: {
          cookie: viewerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          memberId: viewerConnection.memberId,
          unitId: opened.resource.unitId,
          threadId: added.comment.threadId,
          replyId: added.comment.threadId,
          content: "Viewer must not edit the owner",
          mention: [],
        }),
      }
    );
    expect(viewerEditOwnerResponse.status).toBe(403);
    const viewerEditOwnResponse = await fetch(
      `${origin}/universer-api/comment/unit/${opened.resource.unitId}/edit`,
      {
        method: "POST",
        headers: {
          cookie: viewerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          memberId: viewerConnection.memberId,
          unitId: opened.resource.unitId,
          threadId: viewerAdded.comment.threadId,
          replyId: viewerAdded.comment.replies[0].replyId,
          content: "Viewer comment edited",
          mention: [],
        }),
      }
    );
    expect(viewerEditOwnResponse.status).toBe(200);
    const viewerDeleteOwnerResponse = await fetch(
      `${origin}/universer-api/comment/unit/${opened.resource.unitId}/delete`,
      {
        method: "POST",
        headers: {
          cookie: viewerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          memberId: viewerConnection.memberId,
          unitId: opened.resource.unitId,
          threadId: added.comment.threadId,
          replyId: added.comment.threadId,
        }),
      }
    );
    expect(viewerDeleteOwnerResponse.status).toBe(403);

    const ownerDeleteConnection = await joinUnit(
      origin,
      cookie,
      opened.resource.unitId
    );
    const ownerDeleteCommentResponse = await fetch(
      `${origin}/universer-api/comment/unit/${opened.resource.unitId}/delete`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          memberId: ownerDeleteConnection.memberId,
          unitId: opened.resource.unitId,
          threadId: added.comment.threadId,
          replyId: added.comment.threadId,
        }),
      }
    );
    const ownerDeleteCommentBody = await ownerDeleteCommentResponse.text();
    expect(ownerDeleteCommentResponse.status, ownerDeleteCommentBody).toBe(200);
    const commentsAfterDeleteResponse = await fetch(
      `${origin}/universer-api/comment/unit/${opened.resource.unitId}/list?threadId=${encodeURIComponent(added.comment.threadId)}`,
      { headers: { cookie } }
    );
    await expect(commentsAfterDeleteResponse.json()).resolves.toMatchObject({
      comments: {},
    });

    const disabledLinkSharingResponse = await fetch(
      `${origin}/api/nodes/${nodeId}/link-sharing`,
      {
        method: "PUT",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false, role: "viewer" }),
      }
    );
    expect(disabledLinkSharingResponse.status).toBe(200);
    const revokedAuthzResponse = await fetch(
      `${origin}/universer-api/authz/-/object/-/batch_allowed`,
      {
        method: "POST",
        headers: {
          cookie: viewerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              unitID: opened.resource.unitId,
              objectID: opened.resource.unitId,
              actions: [UnitAction.View],
            },
          ],
        }),
      }
    );
    await expect(revokedAuthzResponse.json()).resolves.toMatchObject({
      objectActions: [
        {
          actions: [{ action: UnitAction.View, allowed: false }],
        },
      ],
    });

    const worktree = await application.worktrees.create(
      issued.view.user.id,
      "gateway-create-worktree-0001",
      {
        kind: "user",
        name: "Gateway Worktree",
        summary: null,
      }
    );
    const worktreeUnit = await application.worktrees.addUnit(
      issued.view.user.id,
      worktree.body.id,
      "gateway-add-worktree-unit-0001",
      {
        source: "trunk",
        resourceId,
      }
    );
    const worktreeResponse = await fetch(
      `${origin}/universer-api/worktrees/${worktree.body.id}`,
      { headers: { cookie } }
    );
    expect(worktreeResponse.status).toBe(200);
    await expect(worktreeResponse.json()).resolves.toMatchObject({
      worktree: {
        worktreeID: worktree.body.id,
        status: "draft",
      },
    });
    const worktreeSnapshot = await fetch(
      `${origin}/universer-api/worktrees/${worktree.body.id}/snapshot/${UniverType.UNIVER_SHEET}/unit/${worktreeUnit.body.unit.unitId}/rev/0`,
      { headers: { cookie } }
    );
    expect(worktreeSnapshot.status).toBe(200);
    await expect(worktreeSnapshot.json()).resolves.toMatchObject({
      snapshot: {
        unitID: worktreeUnit.body.unit.unitId,
        type: UniverType.UNIVER_SHEET,
      },
    });

    const localUnit = await application.worktrees.addUnit(
      issued.view.user.id,
      worktree.body.id,
      "gateway-create-local-unit-0001",
      {
        source: "worktree",
        name: "Gateway Document",
        unitType: "doc",
        targetSpaceId: space.id,
        targetParentNodeId: null,
      }
    );
    const localSnapshot = await fetch(
      `${origin}/universer-api/worktrees/${worktree.body.id}/snapshot/${UniverType.UNIVER_DOC}/unit/${localUnit.body.unit.unitId}/rev/0`,
      { headers: { cookie } }
    );
    expect(localSnapshot.status).toBe(200);

    const beforeWorktreeSubmit = currentUnixTimeSeconds();
    const submitResponse = await fetch(
      `${origin}/api/worktrees/${worktree.body.id}/units/${worktreeUnit.body.unit.unitId}/changesets`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          changeset: {
            unitID: worktreeUnit.body.unit.unitId,
            type: UniverType.UNIVER_SHEET,
            baseRev: 1,
            revision: 2,
            sid: "product-api-submit",
            reqId: 1,
            userID: "",
            memberID: "",
            mutations: [],
            createTime: 1,
          },
        }),
      }
    );
    const afterWorktreeSubmit = currentUnixTimeSeconds();
    expect(submitResponse.status).toBe(200);
    const submitBody = (await submitResponse.json()) as {
      readonly changeset: { readonly createTime?: number; readonly mutationSize?: number };
    };
    expect(submitBody).toMatchObject({
      status: "committed",
      changeset: {
        unitID: worktreeUnit.body.unit.unitId,
        revision: 2,
        userID: issued.view.user.id,
        memberID: `product-api:${issued.view.user.id}`,
        createTime: expect.any(Number),
        mutationSize: 2,
      },
    });
    expectUnixSecondsWithin(
      submitBody.changeset.createTime,
      beforeWorktreeSubmit,
      afterWorktreeSubmit
    );
    const stored = readStoredChangesetMetadata(
      collaborationDatabaseFilename,
      "collaboration_worktree_changesets",
      worktreeUnit.body.unit.unitId,
      worktree.body.id
    );
    expectUnixSecondsWithin(
      stored.createTime,
      beforeWorktreeSubmit,
      afterWorktreeSubmit
    );
    expect(stored.mutationSize).toBe(2);
    const updatedWorktree = await application.worktrees.get(
      issued.view.user.id,
      worktree.body.id
    );
    expect(updatedWorktree.worktree.units[0]?.draftHeadRevision).toBe(2);

    const comparisonResponse = await fetch(
      `${origin}/universer-api/worktrees/${worktree.body.id}/units/${worktreeUnit.body.unit.unitId}/comparison`,
      { headers: { cookie } }
    );
    expect(comparisonResponse.status).toBe(200);
    await expect(comparisonResponse.json()).resolves.toMatchObject({
      result: {
        schemaVersion: 1,
        unit: {
          unitId: worktreeUnit.body.unit.unitId,
          type: UniverType.UNIVER_SHEET,
        },
        page: { hasMore: false },
        productContext: { kind: "sheet" },
      },
      left: {
        revision: 1,
        unitData: { id: worktreeUnit.body.unit.unitId },
      },
      right: {
        revision: 2,
        unitData: { id: worktreeUnit.body.unit.unitId },
      },
    });

    await application.worktrees.markReady(
      issued.view.user.id,
      worktree.body.id
    );
    const merged = await application.worktrees.merge(
      issued.view.user.id,
      worktree.body.id,
      "gateway-merge-worktree-0001"
    );
    expect(merged.operation.state).toBe("completed");
    expect(
      application.resources.get(
        issued.view.user.id,
        localUnit.body.unit.resourceId
      ).node
    ).toMatchObject({
      name: "Gateway Document",
      resource: { unitType: "doc" },
    });
  });
});

function commentWrite(
  origin: string,
  cookie: string,
  action: "add" | "reply" | "solved" | "edit" | "delete",
  body: Readonly<Record<string, unknown>>
) {
  return fetch(
    `${origin}/universer-api/comment/unit/${String(body.unitId)}/${action}`,
    {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
}

async function joinUnit(
  origin: string,
  cookie: string,
  unitId: string
) {
  const ticketResponse = await fetch(
    `${origin}/universer-api/user/session-ticket`,
    { headers: { cookie } }
  );
  const ticket = (await ticketResponse.json()) as { readonly ticket: string };
  const socket = new WebSocket(
    `${origin.replace(/^http/, "ws")}/universer-api/comb/connect?sessionTicket=${encodeURIComponent(ticket.ticket)}`
  );
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed")), {
      once: true,
    });
  });
  socket.send(
    serializeCombRequest({
      cmd: CombCmd.HELLO,
      routeKey: "hello",
      routeType: "",
    })
  );
  const hello = await nextCombResponse(socket);
  expect(hello).toMatchObject({ cmd: CombCmd.HELLO, code: CmdRspCode.OK });
  if (hello.cmd !== CombCmd.HELLO) throw new Error("HELLO response missing");
  socket.send(
    serializeCombRequest({
      cmd: CombCmd.JOIN,
      routeKey: unitId,
      routeType: "",
      data: { rooms: [{ roomID: unitId, args: "" }] },
    })
  );
  const joined = await nextCombResponse(socket);
  expect(joined).toMatchObject({
    cmd: CombCmd.JOIN,
    code: CmdRspCode.OK,
  });
  if (joined.cmd !== CombCmd.JOIN) throw new Error("JOIN response missing");
  return {
    memberId: hello.data.memberID,
    socket,
    members: joined.data.roomInfos[unitId]?.members,
  };
}

function nextCombResponse(socket: WebSocket) {
  return new Promise<ReturnType<typeof deserializeToCombResponse>>(
    (resolve, reject) => {
      socket.addEventListener(
        "message",
        (event) => {
          try {
            resolve(deserializeToCombResponse(event));
          } catch (error) {
            reject(error);
          }
        },
        { once: true }
      );
    }
  );
}

async function startApplication(): Promise<{
  readonly application: WorkspaceApplication;
  readonly origin: string;
  readonly collaborationDatabaseFilename: string;
  readonly directory: string;
  readonly server: Server;
}>;
async function startApplication(existingDirectory: string): Promise<{
  readonly application: WorkspaceApplication;
  readonly origin: string;
  readonly collaborationDatabaseFilename: string;
  readonly directory: string;
  readonly server: Server;
}>;
async function startApplication(existingDirectory?: string): Promise<{
  readonly application: WorkspaceApplication;
  readonly origin: string;
  readonly collaborationDatabaseFilename: string;
  readonly directory: string;
  readonly server: Server;
}> {
  const directory =
    existingDirectory ?? mkdtempSync(join(tmpdir(), "univer-gateway-"));
  if (!existingDirectory) temporaryDirectories.push(directory);
  const collaborationDatabaseFilename = join(
    directory,
    "collaboration.sqlite"
  );
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename,
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
  await application.initialize();
  applications.push(application);
  const server = createServer(application.app);
  application.attachWebSocket(server);
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
    throw new Error("Server did not expose a TCP address");
  }
  return {
    application,
    origin: `http://127.0.0.1:${address.port}`,
    collaborationDatabaseFilename,
    directory,
    server,
  };
}

async function stopApplication(
  application: WorkspaceApplication,
  server: Server
): Promise<void> {
  const serverIndex = servers.indexOf(server);
  if (serverIndex >= 0) servers.splice(serverIndex, 1);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  const applicationIndex = applications.indexOf(application);
  if (applicationIndex >= 0) applications.splice(applicationIndex, 1);
  await application.close();
}

function currentUnixTimeSeconds() {
  return Math.floor(Date.now() / 1_000);
}

function expectUnixSecondsWithin(
  value: number | undefined,
  minimum: number,
  maximum: number
) {
  expect(value).toEqual(expect.any(Number));
  expect(value).toBeGreaterThanOrEqual(minimum);
  expect(value).toBeLessThanOrEqual(maximum);
}

function readStoredChangesetMetadata(
  filename: string,
  table:
    | "collaboration_changesets"
    | "collaboration_worktree_changesets",
  unitId: string,
  worktreeId?: string
) {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    const row = worktreeId
      ? database
          .prepare(
            `SELECT payload_json FROM ${table} WHERE worktree_id = ? AND unit_id = ?`
          )
          .get(worktreeId, unitId)
      : database
          .prepare(`SELECT payload_json FROM ${table} WHERE unit_id = ?`)
          .get(unitId);
    if (!row) throw new Error("Stored changeset is missing");
    return JSON.parse(String(row.payload_json)) as {
      readonly createTime?: number;
      readonly mutationSize?: number;
    };
  } finally {
    database.close();
  }
}

// These tests use the real application, published SDK and authenticated HTTP/WS.
describe("content permission integration", () => {
  async function fixture(
    type: "sheet" | "doc" | "slide" | "board" | "base" = "sheet",
    initialData?: object,
  ) {
    const setup = await startApplication();
    const { application, origin } = setup;
    async function account(username: string) {
      const issued = await application.identity.registerWithPassword({
        username,
        displayName: username,
        password: "content permission test password",
      });
      return {
        id: issued.view.user.id,
        cookie: `${application.identity.cookieName}=${issued.cookieValue}`,
      };
    }
    const owner = await account("protection-owner");
    const editor = await account("protection-editor");
    const viewer = await account("protection-viewer");
    const outsider = await account("protection-outsider");
    const space = application.spaces.list(owner.id).spaces[0]!;
    const created = await application.resources.create(
      owner.id,
      "content-permission-resource-0001",
      {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: null,
        name: "Protected",
        unitType: type,
        ...(initialData ? { initialData } : {}),
      },
    );
    if (created.status === 202 || created.body.node.resource?.kind !== "univer")
      throw new Error("Missing Unit");
    const node = created.body.node;
    const unitId = created.body.node.resource.unitId;
    application.permissions.upsertNodeGrant(owner.id, node.id, editor.id, { role: "editor" });
    application.permissions.upsertNodeGrant(owner.id, node.id, viewer.id, { role: "viewer" });
    async function authz(cookie: string, path: string, body?: unknown, method = "POST") {
      return fetch(`${origin}/universer-api/authz${path}`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    return {
      ...setup,
      owner,
      editor,
      viewer,
      outsider,
      unitId,
      node,
      authz,
      protocolType: {
        sheet: UniverType.UNIVER_SHEET,
        doc: UniverType.UNIVER_DOC,
        slide: UniverType.UNIVER_SLIDE,
        board: UniverType.UNIVER_BOARD,
        base: UniverType.UNIVER_BASE,
      }[type],
    };
  }

  it.each([
    ["sheet", 2, "worksheetObject"],
    ["sheet", 3, "selectRangeObject"],
    ["doc", 9, "documentObject"],
    ["doc", 10, "documentObject"],
    ["doc", 11, "documentObject"],
    ["slide", 12, "slideObject"],
    ["slide", 13, "slideObject"],
    ["slide", 14, "slideObject"],
    ["base", 15, "baseObject"],
    ["base", 16, "baseObject"],
    ["base", 17, "baseObject"],
    ["base", 18, "baseObject"],
    ["base", 19, "baseObject"],
    ["board", 20, "boardObject"],
  ] as const)(
    "persists and enforces %s object type %s with the SDK Authz contract",
    async (type, objectType, key) => {
      const f = await fixture(type);
      const input = {
        objectType,
        [key]: {
          unitID: f.unitId,
          name: "Protection",
          strategies: [],
          collaborators: [],
          scope: { read: 1, edit: 2 },
        },
      };
      expect((await f.authz(f.viewer.cookie, `/${objectType}/object`, input)).status).toBe(403);
      const created = await f.authz(f.editor.cookie, `/${objectType}/object`, input);
      expect(created.status).toBe(200);
      const { objectID } = (await created.json()) as { objectID: string };
      const query = {
        unitID: f.unitId,
        objectID,
        objectType,
        actions: [UnitAction.Edit, UnitAction.ManageCollaborator, UnitAction.View],
      };
      for (const [user, edit, manage, view] of [
        [f.owner, true, true, true],
        [f.editor, true, true, true],
        [f.viewer, false, false, true],
        [f.outsider, false, false, false],
      ] as const) {
        const response = await f.authz(user.cookie, "/-/object/-/batch_allowed", {
          requests: [query],
        });
        expect(await response.json()).toMatchObject({
          objectActions: [
            {
              actions: [
                { action: UnitAction.Edit, allowed: edit },
                { action: UnitAction.ManageCollaborator, allowed: manage },
                { action: UnitAction.View, allowed: view },
              ],
            },
          ],
        });
      }
      // Owner can take over an editor-created rule. An object grant never promotes a Viewer.
      const update = {
        ...query,
        name: "Owner managed",
        strategies: [],
        scope: { read: 1, edit: 0 },
        collaborators: { collaborators: [{ id: f.viewer.id, role: 1 }] },
      };
      expect(
        (await f.authz(f.owner.cookie, `/${objectType}/object/${objectID}`, update, "PUT")).status,
      ).toBe(200);
      expect(
        (await f.authz(f.viewer.cookie, `/${objectType}/object/${objectID}`, update, "PUT")).status,
      ).toBe(403);
      expect(
        (
          await f.authz(
            f.owner.cookie,
            `/${objectType}/object/${objectID}`,
            { ...update, scope: { read: 2, edit: 0 } },
            "PUT",
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await f.authz(
            f.owner.cookie,
            `/${objectType}/object/${objectID}`,
            { ...update, unitID: "another-unit" },
            "PUT",
          )
        ).status,
      ).toBe(403);
      const listed = await f.authz(f.owner.cookie, "/-/object/list", {
        unitID: f.unitId,
        objectIDs: [objectID],
        actions: [UnitAction.Edit],
      });
      expect(await listed.json()).toMatchObject({
        objects: [{ objectID, name: "Owner managed", scope: { read: 1, edit: 0 } }],
      });
      const candidates = await f.authz(
        f.editor.cookie,
        `/collaborator?unitID=${f.unitId}&objectID=${f.unitId}`,
        undefined,
        "GET",
      );
      const members = (await candidates.json()) as { collaborators: { id: string }[] };
      expect(members.collaborators.map((member) => member.id).sort()).toEqual(
        [f.owner.id, f.editor.id, f.viewer.id].sort(),
      );
      f.application.permissions.removeNodeGrant(f.owner.id, f.node.id, f.editor.id);
      expect(
        (await f.authz(f.editor.cookie, `/${objectType}/object/${objectID}`, update, "PUT")).status,
      ).toBe(403);
      await stopApplication(f.application, f.server);
      const restarted = await startApplication(f.directory);
      const response = await fetch(`${restarted.origin}/universer-api/authz/-/object/list`, {
        method: "POST",
        headers: { cookie: f.owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ unitID: f.unitId, objectIDs: [objectID], actions: [] }),
      });
      expect(await response.json()).toMatchObject({
        objects: [{ objectID, name: "Owner managed" }],
      });
    },
  );

  async function sheetSubmit(f: Awaited<ReturnType<typeof fixture>>, cookie: string) {
    const connection = await joinUnit(f.origin, cookie, f.unitId);
    const snapshot = await fetch(
      `${f.origin}/universer-api/snapshot/${f.protocolType}/unit/${f.unitId}/rev/0`,
      { headers: { cookie } },
    );
    const loaded = (await snapshot.json()) as { snapshot: { workbook?: { sheetOrder: string[] } } };
    const sheetId = loaded.snapshot.workbook?.sheetOrder[0] ?? "p1";
    let requestId = 0;
    return {
      sheetId,
      async submit(baseRev: number, id: string, params: object) {
        const reqId = ++requestId;
        const event = new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            connection.socket.removeEventListener("message", listener);
            reject(new Error("No submission acknowledgement"));
          }, 5000);
          function listener(raw: MessageEvent) {
            const message = deserializeToCombResponse(raw) as unknown as {
              collaMsg?: {
                eventID: string;
                csAckEvent?: { cs: { reqId: number } };
                permissionRejEvent?: { cs: { reqId: number } };
                csRejEvent?: { cs: { reqId: number } };
                csShouldRetryEvent?: { cs: { reqId: number } };
              };
            };
            const payload = message.collaMsg;
            const cs =
              payload?.csAckEvent?.cs ??
              payload?.permissionRejEvent?.cs ??
              payload?.csRejEvent?.cs ??
              payload?.csShouldRetryEvent?.cs;
            if (cs?.reqId !== reqId || !payload) return;
            clearTimeout(timer);
            connection.socket.removeEventListener("message", listener);
            resolve(payload.eventID);
          }
          connection.socket.addEventListener("message", listener);
        });
        const response = await fetch(
          `${f.origin}/universer-api/comb/${f.protocolType}/unit/${f.unitId}/new_changes`,
          {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({
              unitID: f.unitId,
              memberID: connection.memberId,
              type: f.protocolType,
              changeset: {
                unitID: f.unitId,
                type: f.protocolType,
                baseRev,
                revision: baseRev + 1,
                sid: connection.memberId,
                reqId,
                userID: "untrusted-user",
                memberID: connection.memberId,
                mutations: [
                  { id, data: JSON.stringify({ unitId: f.unitId, subUnitId: sheetId, ...params }) },
                ],
              },
            }),
          },
        );
        expect(await response.json()).toMatchObject({ error: { code: ErrorCode.OK } });
        // HTTP acknowledges receipt; only the WS ACK proves that the edit committed.
        return event;
      },
    };
  }

  it("rejects protected cell writes server-side while allowing unprotected cells and new ACL grants", async () => {
    const f = await fixture();
    const owner = await sheetSubmit(f, f.owner.cookie);
    const editor = await sheetSubmit(f, f.editor.cookie);
    const created = await f.authz(f.owner.cookie, "/3/object", {
      objectType: 3,
      selectRangeObject: {
        unitID: f.unitId,
        name: "B2",
        collaborators: [],
        scope: { read: 1, edit: 2 },
      },
    });
    const { objectID } = (await created.json()) as { objectID: string };
    const bind = await owner.submit(1, "sheet.mutation.add-range-protection", {
      rules: [
        {
          id: "protected-b2",
          permissionId: objectID,
          unitId: f.unitId,
          subUnitId: owner.sheetId,
          unitType: 3,
          ranges: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }],
          viewState: "othersCanView",
          editState: "onlyMe",
        },
      ],
    });
    expect(bind).toBe("changeset_ack");
    expect(
      await editor.submit(2, "sheet.mutation.set-range-values", {
        cellValue: { 1: { 1: { v: "denied" } } },
      }),
    ).toBe("permission_rej");
    expect(
      await editor.submit(2, "sheet.mutation.set-range-values", {
        cellValue: { 0: { 0: { v: "allowed" } } },
      }),
    ).toBe("changeset_ack");
    expect(
      (
        await f.authz(
          f.owner.cookie,
          `/3/object/${objectID}`,
          {
            unitID: f.unitId,
            objectID,
            objectType: 3,
            name: "B2",
            strategies: [],
            scope: { read: 1, edit: 0 },
            collaborators: { collaborators: [{ id: f.editor.id, role: 1 }] },
          },
          "PUT",
        )
      ).status,
    ).toBe(200);
    expect(
      await editor.submit(3, "sheet.mutation.set-range-values", {
        cellValue: { 1: { 1: { v: "now allowed" } } },
      }),
    ).toBe("changeset_ack");
    expect(
      await editor.submit(4, "sheet.mutation.delete-range-protection", {
        ruleIds: ["protected-b2"],
      }),
    ).toBe("permission_rej");
    const database = new DatabaseSync(f.collaborationDatabaseFilename, { readOnly: true });
    try {
      expect(
        database
          .prepare("SELECT head_revision FROM collaboration_units WHERE unit_id = ?")
          .get(f.unitId),
      ).toMatchObject({ head_revision: 4 });
    } finally {
      database.close();
    }
  });

  it.each(["doc", "slide", "board", "base"] as const)(
    "enforces real %s content edits and keeps unrelated edits working",
    async (kind) => {
      let data: object;
      let objectType: number;
      let objectId: string;
      let edit: (protectedTarget: boolean) => { id: string; params: object };
      if (kind === "doc") {
        const snapshot = getDocsEmptySnapshot("seed");
        snapshot.body = {
          dataStream: "One\rTwo\r\n",
          paragraphs: [
            { startIndex: 3, paragraphId: "para_p1" },
            { startIndex: 7, paragraphId: "para_p2" },
          ],
          sectionBreaks: [{ startIndex: 8, sectionId: "s1" }],
        };
        data = snapshot;
        objectType = 10;
        objectId = "paragraph//para_p2";
        edit = (protectedTarget) => ({
          id: "doc.mutation.rich-text-editing",
          params: {
            actions: JSONX.getInstance().editOp([
              ...(protectedTarget ? [{ t: TextXActionType.RETAIN, len: 4 }] : []),
              { t: TextXActionType.INSERT, len: 1, body: { dataStream: "X" } },
            ]),
          },
        });
      } else if (kind === "slide") {
        const snapshot = getSlidesEmptySnapshot("seed");
        snapshot.activeSlideId = "p1";
        snapshot.slideOrder = ["p1"];
        snapshot.slides = {
          p1: {
            id: "p1",
            name: "Page",
            pageType: PageTypeEnum.Slide,
            elementOrder: ["e1", "e2"],
            elements: Object.fromEntries(
              ["e1", "e2"].map((id) => [
                id,
                {
                  id,
                  type: PageElementTypeEnum.Shape,
                  transform: { left: 0, top: 0, width: 100, height: 50 },
                  shapeData: { shapeType: "rect" },
                },
              ]),
            ) as never,
          },
        };
        data = snapshot;
        objectType = 13;
        objectId = "element/slide/p1/e1";
        edit = (protectedTarget) => ({
          id: "slide.mutation.remove-slide-element",
          params: { subUnitId: "p1", drawingId: protectedTarget ? "e1" : "e2" },
        });
      } else if (kind === "board") {
        const snapshot = getBoardsEmptySnapshot("seed");
        snapshot.activePageId = "p1";
        snapshot.pageOrder = ["p1"];
        snapshot.pages = {
          p1: {
            id: "p1",
            name: "Page",
            pageType: "page",
            elementOrder: ["e1", "e2"],
            elements: Object.fromEntries(
              ["e1", "e2"].map((id) => [
                id,
                {
                  id,
                  type: BoardElementType.Shape,
                  transform: { left: 0, top: 0, width: 100, height: 50 },
                  shapeData: { shapeType: "rect" },
                },
              ]),
            ) as never,
          },
        };
        snapshot.slides = snapshot.pages;
        snapshot.slideOrder = snapshot.pageOrder;
        snapshot.activeSlideId = "p1";
        data = snapshot;
        objectType = 20;
        objectId = "element/p1/e1";
        edit = (protectedTarget) => ({
          id: "board.mutation.remove-element",
          params: { subUnitId: "p1", elementId: protectedTarget ? "e1" : "e2" },
        });
      } else {
        const snapshot = getBasesEmptySnapshot("seed");
        const table = createDefaultBaseTableSnapshot({
          id: "t1",
          name: "Table",
          gridViewId: "e1",
          recordCount: 2,
          now: 1,
        });
        table.views.e2 = { ...table.views.e1!, id: "e2", name: "Other" };
        table.viewOrder.push("e2");
        snapshot.tableOrder = ["t1"];
        snapshot.tables = { t1: table };
        data = snapshot;
        objectType = 18;
        objectId = "view/t1/e1";
        edit = (protectedTarget) => ({
          id: "base.mutation.apply-base-json1",
          params: {
            op: [
              "tables",
              "t1",
              "views",
              protectedTarget ? "e1" : "e2",
              "name",
              { r: protectedTarget ? "Grid" : "Other", i: "Changed" },
            ],
          },
        });
      }
      const f = await fixture(kind, data);
      const owner = await sheetSubmit(f, f.owner.cookie);
      const editor = await sheetSubmit(f, f.editor.cookie);
      const key = kind === "doc" ? "documentObject" : `${kind}Object`;
      const created = await f.authz(f.owner.cookie, `/${objectType}/object`, {
        objectType,
        [key]: {
          unitID: f.unitId,
          name: "Protected object",
          strategies: [],
          collaborators: [],
          scope: { read: 1, edit: 2 },
        },
      });
      const { objectID: permissionId } = (await created.json()) as { objectID: string };
      expect(
        await owner.submit(1, `${kind}.mutation.set-permission-rule`, {
          objectId,
          objectType,
          rule: { objectId, objectType, permissionId },
        }),
      ).toBe("changeset_ack");
      const protectedEdit = edit(true);
      expect(await editor.submit(2, protectedEdit.id, protectedEdit.params)).toBe("permission_rej");
      const unrelatedEdit = edit(false);
      expect(await editor.submit(2, unrelatedEdit.id, unrelatedEdit.params)).toBe("changeset_ack");
      expect(await owner.submit(3, protectedEdit.id, protectedEdit.params)).toBe("changeset_ack");
    },
  );

  it("inherits Trunk protection in drafts, forbids rule management, and merges ordinary edits", async () => {
    const f = await fixture();
    const owner = await sheetSubmit(f, f.owner.cookie);
    const created = await f.authz(f.owner.cookie, "/3/object", {
      objectType: 3,
      selectRangeObject: {
        unitID: f.unitId,
        name: "B2",
        collaborators: [],
        scope: { read: 1, edit: 2 },
      },
    });
    const { objectID } = (await created.json()) as { objectID: string };
    expect(
      await owner.submit(1, "sheet.mutation.add-range-protection", {
        rules: [
          {
            id: "draft-b2",
            permissionId: objectID,
            unitId: f.unitId,
            subUnitId: owner.sheetId,
            unitType: 3,
            ranges: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }],
            viewState: "othersCanView",
            editState: "onlyMe",
          },
        ],
      }),
    ).toBe("changeset_ack");
    const tree = await f.application.worktrees.create(f.editor.id, "protected-draft-create-0001", {
      kind: "user",
      name: "Draft",
      summary: null,
    });
    const worktreeId = tree.body.id;
    await f.application.worktrees.addUnit(f.editor.id, worktreeId, "protected-draft-add-0001", {
      source: "trunk",
      resourceId: f.node.resource!.id,
    });
    const scoped = `${f.origin}/universer-api/worktrees/${worktreeId}/authz`;
    const headers = { cookie: f.editor.cookie, "content-type": "application/json" };
    const query = await fetch(`${scoped}/-/object/-/batch_allowed`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requests: [
          {
            unitID: f.unitId,
            objectID: f.unitId,
            objectType: 1,
            actions: [UnitAction.Edit, UnitAction.CreatePermissionObject],
          },
          { unitID: f.unitId, objectID, objectType: 3, actions: [UnitAction.Edit] },
        ],
      }),
    });
    expect(await query.json()).toMatchObject({
      objectActions: [
        { actions: [{ allowed: true }, { allowed: false }] },
        { actions: [{ allowed: false }] },
      ],
    });
    expect(
      (await fetch(`${scoped}/3/object`, { method: "POST", headers, body: "{}" })).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${scoped}/-/object/list`, {
          method: "POST",
          headers: { ...headers, cookie: f.outsider.cookie },
          body: JSON.stringify({ unitID: f.unitId, objectIDs: [objectID] }),
        })
      ).status,
    ).toBe(403);
    let reqId = 0;
    const submit = (id: string, params: object) =>
      f.application.worktrees.submitChangeset(f.editor.id, worktreeId, f.unitId, {
        changeset: {
          unitID: f.unitId,
          type: UniverType.UNIVER_SHEET,
          baseRev: 2,
          revision: 3,
          sid: "content-draft",
          reqId: ++reqId,
          userID: "",
          memberID: "",
          createTime: 1,
          mutations: [
            { id, data: JSON.stringify({ unitId: f.unitId, subUnitId: owner.sheetId, ...params }) },
          ],
        },
      });
    await expect(
      submit("sheet.mutation.set-range-values", { cellValue: { 1: { 1: { v: "denied" } } } }),
    ).resolves.toMatchObject({ status: "rejected", error: { code: "PERMISSION_DENIED" } });
    await expect(
      submit("sheet.mutation.delete-range-protection", { ruleIds: ["draft-b2"] }),
    ).resolves.toMatchObject({ status: "rejected", error: { code: "PERMISSION_DENIED" } });
    expect(
      await submit("sheet.mutation.set-range-values", { cellValue: { 0: { 0: { v: "merged" } } } }),
    ).toMatchObject({ status: "committed" });
    await f.application.worktrees.markReady(f.editor.id, worktreeId);
    expect(
      await f.application.worktrees.merge(f.editor.id, worktreeId, "protected-draft-merge-0001"),
    ).toMatchObject({ worktree: { state: "merged" }, operation: { state: "completed" } });
  });

  it("rechecks revoked content grants when merging a previously editable draft", async () => {
    const f = await fixture();
    const owner = await sheetSubmit(f, f.owner.cookie);
    const created = await f.authz(f.owner.cookie, "/3/object", {
      objectType: 3,
      selectRangeObject: {
        unitID: f.unitId,
        name: "B2",
        collaborators: [{ id: f.editor.id, role: 1 }],
        scope: { read: 1, edit: 0 },
      },
    });
    const { objectID } = (await created.json()) as { objectID: string };
    expect(
      await owner.submit(1, "sheet.mutation.add-range-protection", {
        rules: [
          {
            id: "revoked-b2",
            permissionId: objectID,
            unitId: f.unitId,
            subUnitId: owner.sheetId,
            unitType: 3,
            ranges: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }],
            viewState: "othersCanView",
            editState: "specificUsers",
          },
        ],
      }),
    ).toBe("changeset_ack");
    const tree = await f.application.worktrees.create(f.editor.id, "revoked-draft-create-0001", {
      kind: "user",
      name: "Revoked",
      summary: null,
    });
    const worktreeId = tree.body.id;
    await f.application.worktrees.addUnit(f.editor.id, worktreeId, "revoked-draft-add-0001", {
      source: "trunk",
      resourceId: f.node.resource!.id,
    });
    expect(
      await f.application.worktrees.submitChangeset(f.editor.id, worktreeId, f.unitId, {
        changeset: {
          unitID: f.unitId,
          type: UniverType.UNIVER_SHEET,
          baseRev: 2,
          revision: 3,
          sid: "revoked-draft",
          reqId: 1,
          userID: "",
          memberID: "",
          createTime: 1,
          mutations: [
            {
              id: "sheet.mutation.set-range-values",
              data: JSON.stringify({
                unitId: f.unitId,
                subUnitId: owner.sheetId,
                cellValue: { 1: { 1: { v: "before revocation" } } },
              }),
            },
          ],
        },
      }),
    ).toMatchObject({ status: "committed" });
    expect(
      (
        await f.authz(
          f.owner.cookie,
          `/3/object/${objectID}`,
          {
            unitID: f.unitId,
            objectID,
            objectType: 3,
            scope: { read: 1, edit: 2 },
            collaborators: { collaborators: [] },
          },
          "PUT",
        )
      ).status,
    ).toBe(200);
    await f.application.worktrees.markReady(f.editor.id, worktreeId);
    const merged = await f.application.worktrees.merge(
      f.editor.id,
      worktreeId,
      "revoked-draft-merge-0001",
    );
    expect(merged.worktree.state).not.toBe("merged");
    const database = new DatabaseSync(f.collaborationDatabaseFilename, { readOnly: true });
    try {
      expect(
        database
          .prepare("SELECT head_revision FROM collaboration_units WHERE unit_id = ?")
          .get(f.unitId),
      ).toMatchObject({ head_revision: 2 });
    } finally {
      database.close();
    }
  });

  // Deliberately red on 1.0.0-rc.0. Do not skip/xfail or weaken the assertion.
  // Merge gate: publish and adopt the fix for univer-collaboration-sdk#82 first.
  it("SDK #82: ordinary Editor can change tab color without collaborator-management rights", async () => {
    const f = await fixture();
    const editor = await sheetSubmit(f, f.editor.cookie);
    expect(
      await editor.submit(1, "sheet.mutation.set-range-values", {
        cellValue: { 0: { 0: { v: "control" } } },
      }),
    ).toBe("changeset_ack");
    expect(await editor.submit(2, "sheet.mutation.set-tab-color", { color: "#ff0000" })).toBe(
      "changeset_ack",
    );
  });
});
