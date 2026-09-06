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
    ).resolves.toMatchObject({ status: 401 });
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

  it("binds the authenticated product user and Node permissions to Univer protocol", async () => {
    const { application, origin, collaborationDatabaseFilename } =
      await startApplication();
    const issued = await application.identity.registerWithPassword({
      username: "gateway-user",
      displayName: "Gateway User",
      password: "correct horse battery staple",
    });
    const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
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
    ).resolves.toMatchObject({ status: 401 });

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

    const snapshotResponse = await fetch(
      `${origin}/universer-api/snapshot/${UniverType.UNIVER_SHEET}/unit/${opened.resource.unitId}/rev/0`,
      { headers: { cookie } }
    );
    expect(snapshotResponse.status).toBe(200);
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
    ).resolves.toMatchObject({ status: 401 });
    const ownerConnection = await joinUnit(
      origin,
      cookie,
      opened.resource.unitId
    );
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
          content: "Viewer must not write",
          mention: [],
        }),
      }
    );
    expect(viewerAddCommentResponse.status).toBe(403);

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
): Promise<{ readonly memberId: string; readonly socket: WebSocket }> {
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
  await expect(nextCombResponse(socket)).resolves.toMatchObject({
    cmd: CombCmd.JOIN,
    code: CmdRspCode.OK,
  });
  return { memberId: hello.data.memberID, socket };
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
