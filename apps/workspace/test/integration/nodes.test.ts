import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import { ApplicationError } from "../../server/src/middleware/errors.js";

const applications: WorkspaceApplication[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
});

describe("spaces and Nodes", () => {
  it("creates personal and team spaces and browses nested Nodes", async () => {
    const application = createTestApplication();
    const alice = await register(application, "alice");
    const listed = application.spaces.list(alice);

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

    const teamSpace = application.spaces.createTeamSpace(alice, {
      name: "Product",
    });
    expect(application.spaces.list(alice).spaces).toHaveLength(2);
    expect(teamSpace).toMatchObject({
      type: "team",
      accessRole: "owner",
    });

    const projects = application.nodes.create(alice, {
      spaceId: personalSpace.id,
        parentNodeId: null,
        name: "Projects",
      }
    );
    const planning = application.nodes.create(alice, {
      spaceId: personalSpace.id,
        parentNodeId: projects.id,
        name: "Planning",
      }
    );

    expect(
      application.nodes.listSpaceRoot(alice, personalSpace.id, {
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
      application.nodes.get(alice, planning.id)
    ).toMatchObject({
      node: { id: planning.id, resource: null },
      breadcrumbs: [
        { id: projects.id, name: "Projects" },
        { id: planning.id, name: "Planning" },
      ],
    });
  });

  it("uses one inherited access model for direct Node sharing", async () => {
    const application = createTestApplication();
    const alice = await register(application, "alice");
    const bob = await register(application, "bob");
    const aliceSpace = application.spaces.list(alice).spaces[0];
    if (!aliceSpace) throw new Error("Personal space is missing");
    const sharedRoot = application.nodes.create(alice, {
      spaceId: aliceSpace.id,
        parentNodeId: null,
        name: "Shared root",
      }
    );
    const existingChild = application.nodes.create(alice, {
      spaceId: aliceSpace.id,
        parentNodeId: sharedRoot.id,
        name: "Existing child",
      }
    );

    expect(() =>
      application.nodes.get(bob, sharedRoot.id)
    ).toThrowError(ApplicationError);

    application.database.connection
      .prepare(
        `INSERT INTO node_grants
          (node_id, user_id, role, granted_by, created_at, updated_at)
         VALUES (?, ?, 'editor', ?, ?, ?)`
      )
      .run(sharedRoot.id, bob, alice, 1_000, 1_000);

    expect(
      application.nodes.get(bob, existingChild.id)
    ).toMatchObject({
      navigationRootNodeId: sharedRoot.id,
      breadcrumbs: [
        { id: sharedRoot.id },
        { id: existingChild.id },
      ],
    });
    const bobChild = application.nodes.create(bob, {
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

    expect(() =>
      application.nodes.update(bob, sharedRoot.id, {
        parentNodeId: null,
      })
    ).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN",
        status: 403,
      })
    );
  });

  it("allows a Resource Node to own children and rejects cycles", async () => {
    const application = createTestApplication();
    const userId = await register(application, "alice");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const parent = application.nodes.create(userId, {
      spaceId: space.id,
      parentNodeId: null,
      name: "Parent",
    });
    const child = application.nodes.create(userId, {
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
    const nestedUnderResource = application.nodes.create(userId, {
      spaceId: space.id,
      parentNodeId: resource.body.node.id,
      name: "Nested",
    });
    expect(
      application.nodes.listChildren(
        userId,
        resource.body.node.id,
        { cursor: undefined, limit: undefined }
      )
    ).toMatchObject({
      nodes: [{ id: nestedUnderResource.id }],
    });

    expect(() =>
      application.nodes.update(userId, parent.id, {
        parentNodeId: child.id,
      })
    ).toThrowError(
      expect.objectContaining({
        code: "CONFLICT",
        status: 409,
      })
    );
  });
});

function createTestApplication(): WorkspaceApplication {
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: ":memory:",
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
  application: WorkspaceApplication,
  username: string
): Promise<string> {
  const session = await application.identity.registerWithPassword({
    username,
    displayName: username,
    password: "correct horse battery staple",
  });
  return session.view.user.id;
}
