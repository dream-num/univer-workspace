import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnitAction, UniverType } from "@univerjs/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];
const temporaryDirectories: string[] = [];

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
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("collaboration gateway", () => {
  it("binds the authenticated product user and Node permissions to Univer protocol", async () => {
    const { application, origin } = await startApplication();
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
              actions: [UnitAction.View, UnitAction.Edit],
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
              actions: [UnitAction.View, UnitAction.Edit],
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
          },
        }),
      }
    );
    expect(submitResponse.status).toBe(200);
    await expect(submitResponse.json()).resolves.toMatchObject({
      status: "committed",
      changeset: {
        unitID: worktreeUnit.body.unit.unitId,
        revision: 2,
        userID: issued.view.user.id,
        memberID: `product-api:${issued.view.user.id}`,
      },
    });
    const updatedWorktree = await application.worktrees.get(
      issued.view.user.id,
      worktree.body.id
    );
    expect(updatedWorktree.worktree.units[0]?.draftHeadRevision).toBe(2);

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

async function startApplication(): Promise<{
  readonly application: WorkspaceApplication;
  readonly origin: string;
}> {
  const directory = mkdtempSync(join(tmpdir(), "univer-gateway-"));
  temporaryDirectories.push(directory);
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
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
  };
}
