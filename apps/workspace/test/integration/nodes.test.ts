import { interactivePrincipal } from "../fixtures/principal.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSqliteTestApplication,
  type SqliteTestApplication,
} from "../support/sqlite/test-application.js";
import { ApplicationError } from "../../server/src/middleware/errors.js";

const applications: SqliteTestApplication[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
});

describe("spaces and Nodes", () => {
  it("creates personal and team spaces and browses nested Nodes", async () => {
    const application = await createTestApplication();
    const alice = await register(application, "alice");
    const listed = await application.spaces.list(alice);

    expect(listed.spaces).toHaveLength(1);
    expect(listed.spaces[0]).toMatchObject({
      type: "personal",
      accessRole: "owner",
      capabilities: {
        browseRoot: true,
        createAtRoot: true,
      },
    });
    const personalSpace = listed.spaces[0];
    if (!personalSpace) throw new Error("Personal space is missing");

    const teamSpace = await application.spaces.createTeamSpace(alice, {
      name: "Product",
    });
    expect((await application.spaces.list(alice)).spaces).toHaveLength(2);
    expect(teamSpace).toMatchObject({
      type: "team",
      accessRole: "owner",
    });

    const projects = await application.nodes.create(alice, {
      spaceId: personalSpace.id,
        parentNodeId: null,
        name: "Projects",
      }
    );
    const planning = await application.nodes.create(alice, {
      spaceId: personalSpace.id,
        parentNodeId: projects.id,
        name: "Planning",
      }
    );

    expect(
      await application.nodes.listSpaceRoot(alice, personalSpace.id, {
        cursor: undefined,
        limit: undefined,
      })
    ).toMatchObject({
      parentNode: null,
      navigationRootNodeId: null,
      breadcrumbs: [],
      nodes: [
        {
          id: projects.id,
          name: "Projects",
          resource: null,
          hasChildren: true,
        },
      ],
    });
    expect(
      await application.nodes.get(alice, planning.id)
    ).toMatchObject({
      node: { id: planning.id, resource: null },
      breadcrumbs: [
        { id: projects.id, name: "Projects" },
        { id: planning.id, name: "Planning" },
      ],
    });
  });

  it("uses one inherited access model for direct Node sharing", async () => {
    const application = await createTestApplication();
    const alice = await register(application, "alice");
    const bob = await register(application, "bob");
    const aliceSpace = (await application.spaces.list(alice)).spaces[0];
    if (!aliceSpace) throw new Error("Personal space is missing");
    const sharedRoot = await application.nodes.create(alice, {
      spaceId: aliceSpace.id,
        parentNodeId: null,
        name: "Shared root",
      }
    );
    const existingChild = await application.nodes.create(alice, {
      spaceId: aliceSpace.id,
        parentNodeId: sharedRoot.id,
        name: "Existing child",
      }
    );

    await expect(application.nodes.get(bob, sharedRoot.id)
    ).rejects.toThrowError(ApplicationError);

    application.database.connection
      .prepare(
        `INSERT INTO node_grants
          (node_id, user_id, role, granted_by, created_at, updated_at)
         VALUES (?, ?, 'editor', ?, ?, ?)`
      )
      .run(sharedRoot.id, bob, alice, 1_000, 1_000);

    expect(
      await application.nodes.get(bob, existingChild.id)
    ).toMatchObject({
      navigationRootNodeId: sharedRoot.id,
      breadcrumbs: [
        { id: sharedRoot.id },
        { id: existingChild.id },
      ],
    });
    const bobChild = await application.nodes.create(bob, {
      spaceId: aliceSpace.id,
      parentNodeId: sharedRoot.id,
      name: "Bob child",
    });
    expect(bobChild).toMatchObject({
      accessRole: "editor",
      capabilities: {
        createChildren: true,
        trash: false,
        share: false,
      },
    });

    await expect(application.nodes.update(interactivePrincipal(bob), sharedRoot.id, {
        parentNodeId: null,
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN",
        status: 403,
      })
    );
  });

  it("serializes opposing moves and preserves independent patches", async () => {
    const app = await createTestApplication();
    const owner = await register(app, "node-moves");
    const actor = interactivePrincipal(owner);
    const [space] = (await app.spaces.list(owner)).spaces;
    if (!space) throw new Error("Personal space is missing");
    const [left, right] = await Promise.all(["Left", "Right"].map((name) =>
      app.nodes.create(owner, { spaceId: space.id, parentNodeId: null, name }),
    ));

    const moves = await Promise.allSettled([
      app.nodes.update(actor, left.id, { parentNodeId: right.id }),
      app.nodes.update(actor, right.id, { parentNodeId: left.id }),
    ]);
    expect(moves.filter((move) => move.status === "fulfilled")).toHaveLength(1);
    expect(moves.find((move) => move.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });

    const moved = moves[0].status === "fulfilled" ? left : right;
    await Promise.all([
      app.nodes.update(actor, moved.id, { name: "Renamed" }),
      app.nodes.update(actor, moved.id, { parentNodeId: null }),
    ]);
    expect((await app.nodes.get(owner, moved.id)).node).toMatchObject({
      name: "Renamed", parentNodeId: null,
    });
  });

  it("allows a Resource Node to own children and rejects cycles", async () => {
    const application = await createTestApplication();
    const userId = await register(application, "alice");
    const space = (await application.spaces.list(userId)).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const parent = await application.nodes.create(userId, {
      spaceId: space.id,
      parentNodeId: null,
      name: "Parent",
    });
    const child = await application.nodes.create(userId, {
      spaceId: space.id,
      parentNodeId: parent.id,
      name: "Child",
    });
    const resource = await application.resources.create(
      userId,
      "resource-parent-operation-0001",
      {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: null,
        name: "Document parent",
        unitType: "doc",
      }
    );
    if (resource.status === 202) throw new Error("Resource is pending");
    const nestedUnderResource = await application.nodes.create(userId, {
      spaceId: space.id,
      parentNodeId: resource.body.node.id,
      name: "Nested",
    });
    expect(
      await application.nodes.listChildren(
        userId,
        resource.body.node.id,
        { cursor: undefined, limit: undefined }
      )
    ).toMatchObject({
      nodes: [{ id: nestedUnderResource.id }],
    });

    await expect(application.nodes.update(interactivePrincipal(userId), parent.id, {
        parentNodeId: child.id,
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "CONFLICT",
        status: 409,
      })
    );
  });
});

async function createTestApplication(): Promise<SqliteTestApplication> {
  const application = await createSqliteTestApplication({
    host: "127.0.0.1",
    port: 3020,
    productDatabase: { provider: "sqlite", filename: ":memory:" },
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    sessionTtlMs: 60_000,
  }, {
    unitStore: {
      async createUnit(input) {
        return { unitId: input.unitId, headRevision: 1 };
      },
    },
  });
  applications.push(application);
  return application;
}

async function register(
  application: SqliteTestApplication,
  username: string
): Promise<string> {
  const session = await application.identity.registerWithPassword({
    username,
    displayName: username,
    password: "correct horse battery staple",
  });
  return session.view.user.id;
}
