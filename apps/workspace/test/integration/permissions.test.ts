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

describe("permissions", () => {
  it("can enable public read while creating a Team Space", async () => {
    const application = createTestApplication();
    const owner = await register(application, "public-team-owner");
    const visitor = await register(application, "public-team-visitor");

    const team = application.spaces.createTeamSpace(owner, {
      name: "Public team",
      publicRead: true,
    });

    expect(team).toMatchObject({ publicRead: true, accessRole: "owner" });
    expect(application.access.resolveSpace(visitor, team.id)).toMatchObject({
      publicRead: true,
      role: "viewer",
    });
  });

  it("lets every signed-in user read an opted-in Space without an invitation", async () => {
    const application = createTestApplication();
    const owner = await register(application, "public-owner");
    const visitor = await register(application, "public-visitor");
    const space = application.spaces.list(owner).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const created = await application.resources.create(
      owner,
      "public-read-create-resource-0001",
      {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: null,
        name: "Public sheet",
        unitType: "sheet",
      }
    );
    if (created.status === 202) throw new Error("Resource creation is pending");
    const resourceId = created.body.node.resource?.id;
    if (!resourceId) throw new Error("Created Resource is missing");

    expect(application.access.resolveSpace(visitor, space.id)).toBeNull();
    expect(application.access.resolveResource(visitor, resourceId)).toBeNull();

    expect(
      application.spaces.update(owner, space.id, { publicRead: true })
    ).toMatchObject({ publicRead: true });
    expect(application.spaces.list(visitor).spaces).toContainEqual(
      expect.objectContaining({
        id: space.id,
        publicRead: true,
        accessRole: "viewer",
        capabilities: expect.objectContaining({
          createAtRoot: false,
          renameSpace: false,
        }),
      })
    );
    expect(application.access.resolveResource(visitor, resourceId)).toMatchObject({
      node: {
        role: "viewer",
        navigationRootNodeId: null,
        capabilities: { createChildren: false, rename: false, trash: false },
      },
      capabilities: { openContent: true, editContent: false },
    });
    expect(application.resources.open(visitor, resourceId)).toMatchObject({
      resource: { accessRole: "viewer", editorMode: "readOnly" },
    });
    expect(() =>
      application.spaces.update(visitor, space.id, { publicRead: false })
    ).toThrowError(
      expect.objectContaining<ApplicationError>({ code: "FORBIDDEN", status: 403 })
    );

    application.spaces.update(owner, space.id, { publicRead: false });
    expect(application.access.resolveResource(visitor, resourceId)).toBeNull();
  });

  it("manages team membership through the same space access resolver", async () => {
    const application = createTestApplication();
    const owner = await register(application, "owner");
    const member = await register(application, "member");
    const other = await register(application, "other");
    const contributor = await register(application, "contributor");
    const team = application.spaces.createTeamSpace(owner, {
      name: "Product",
    });

    expect(
      application.permissions.searchUsers(owner, "mem")
    ).toMatchObject({
      users: [{ id: member, username: "member" }],
    });
    expect(
      application.permissions.upsertTeamMember(
        owner,
        team.id,
        member,
        { role: "viewer" }
      )
    ).toMatchObject({
      user: { id: member },
      role: "viewer",
      grantedBy: { id: owner },
    });
    expect(application.access.resolveSpace(member, team.id)?.role).toBe(
      "viewer"
    );
    expect(
      application.permissions.listTeamMembers(member, team.id)
    ).toMatchObject({
      owner: { id: owner },
      members: [{ user: { id: member }, role: "viewer" }],
    });
    expect(() =>
      application.permissions.upsertTeamMember(
        member,
        team.id,
        other,
        { role: "editor" }
      )
    ).toThrowError(
      expect.objectContaining<ApplicationError>({
        code: "FORBIDDEN",
        status: 403,
      })
    );

    application.permissions.upsertTeamMember(
      owner,
      team.id,
      member,
      { role: "admin" }
    );
    application.permissions.upsertTeamMember(
      owner,
      team.id,
      other,
      { role: "admin" }
    );
    expect(() =>
      application.permissions.upsertTeamMember(
        member,
        team.id,
        other,
        { role: "viewer" }
      )
    ).toThrowError(
      expect.objectContaining<ApplicationError>({ code: "FORBIDDEN" })
    );
    expect(() =>
      application.permissions.upsertTeamMember(
        member,
        team.id,
        contributor,
        { role: "admin" }
      )
    ).toThrowError(
      expect.objectContaining<ApplicationError>({ code: "FORBIDDEN" })
    );
    expect(
      application.permissions.upsertTeamMember(
        member,
        team.id,
        contributor,
        { role: "editor" }
      ).role
    ).toBe("editor");

    application.permissions.removeTeamMember(member, team.id, member);
    expect(application.access.resolveSpace(member, team.id)).toBeNull();
  });

  it("applies direct group Node grants to Resource access and editor mode", async () => {
    const application = createTestApplication();
    const owner = await register(application, "alice");
    const recipient = await register(application, "bob");
    const space = application.spaces.list(owner).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const groupNode = application.nodes.create(owner, {
      spaceId: space.id,
      parentNodeId: null,
      name: "Shared group",
    });
    const created = await application.resources.create(
      owner,
      "permission-create-resource-0001",
      {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: groupNode.id,
        name: "Shared sheet",
        unitType: "sheet",
      }
    );
    if (created.status === 202) throw new Error("Resource creation is pending");
    const resourceId = created.body.node.resource?.id;
    if (!resourceId) throw new Error("Created Resource is missing");

    expect(
      application.permissions.upsertNodeGrant(
        owner,
        groupNode.id,
        recipient,
        { role: "viewer" }
      )
    ).toMatchObject({
      user: { id: recipient },
      role: "viewer",
      effectiveRole: "viewer",
    });
    expect(
      application.views.listShared(recipient, {
        cursor: undefined,
        limit: undefined,
      })
    ).toMatchObject({
      items: [
        {
          node: { id: groupNode.id, name: "Shared group" },
          sharedBy: { id: owner },
        },
      ],
      nextCursor: null,
    });
    expect(
      application.resources.open(recipient, resourceId)
    ).toMatchObject({
      resource: {
        accessRole: "viewer",
        editorMode: "readOnly",
      },
    });

    expect(
      application.permissions.upsertNodeGrant(
        owner,
        created.body.node.id,
        recipient,
        { role: "editor" }
      )
    ).toMatchObject({
      role: "editor",
      effectiveRole: "editor",
    });
    expect(
      application.resources.open(recipient, resourceId).resource.editorMode
    ).toBe("edit");
    expect(
      application.permissions.removeNodeGrant(
        owner,
        created.body.node.id,
        recipient
      )
    ).toEqual({ effectiveRole: "viewer" });
    expect(
      application.resources.open(recipient, resourceId).resource.editorMode
    ).toBe("readOnly");

    expect(
      application.permissions.removeNodeGrant(
        owner,
        groupNode.id,
        recipient
      )
    ).toEqual({ effectiveRole: null });
    expect(
      application.access.resolveNode(recipient, groupNode.id)
    ).toBeNull();
    expect(
      application.views.listShared(recipient, {
        cursor: undefined,
        limit: undefined,
      }).items
    ).toEqual([]);
  });

  it("applies one mutable Link Sharing policy to a personal Node subtree", async () => {
    const application = createTestApplication();
    const owner = await register(application, "link-owner");
    const visitor = await register(application, "link-visitor");
    const space = application.spaces.list(owner).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const groupNode = application.nodes.create(owner, {
      spaceId: space.id,
      parentNodeId: null,
      name: "Linked group",
    });
    const created = await application.resources.create(
      owner,
      "link-sharing-create-resource-0001",
      {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: groupNode.id,
        name: "Linked sheet",
        unitType: "sheet",
      }
    );
    if (created.status === 202) throw new Error("Resource creation is pending");
    const resourceId = created.body.node.resource?.id;
    if (!resourceId) throw new Error("Created Resource is missing");

    expect(
      application.permissions.getNodeLinkSharing(owner, groupNode.id)
    ).toEqual({
      enabled: false,
      role: "viewer",
      createdBy: null,
      updatedBy: null,
      createdAt: null,
      updatedAt: null,
    });
    expect(application.access.resolveNode(visitor, groupNode.id)).toBeNull();

    expect(
      application.permissions.updateNodeLinkSharing(
        owner,
        groupNode.id,
        { enabled: true, role: "viewer" }
      )
    ).toMatchObject({
      enabled: true,
      role: "viewer",
      createdBy: { id: owner },
      updatedBy: { id: owner },
    });
    expect(
      application.access.resolveNode(visitor, groupNode.id)
    ).toMatchObject({
      role: "viewer",
      navigationRootNodeId: groupNode.id,
      capabilities: {
        browseChildren: true,
        createChildren: false,
        rename: false,
        move: false,
        trash: false,
        share: false,
      },
    });
    expect(application.resources.open(visitor, resourceId)).toMatchObject({
      resource: { accessRole: "viewer", editorMode: "readOnly" },
    });
    expect(
      application.views.listRecent(visitor, {
        cursor: undefined,
        limit: undefined,
      }).items
    ).toMatchObject([{ resource: { id: resourceId } }]);
    expect(
      application.views.listShared(visitor, {
        cursor: undefined,
        limit: undefined,
      }).items
    ).toEqual([]);
    expect(
      application.views.listOwned(visitor, {
        cursor: undefined,
        limit: undefined,
      }).items
    ).toEqual([]);

    application.permissions.updateNodeLinkSharing(owner, groupNode.id, {
      enabled: true,
      role: "editor",
    });
    expect(application.access.resolveResource(visitor, resourceId)).toMatchObject({
      node: {
        role: "editor",
        navigationRootNodeId: groupNode.id,
      },
      capabilities: {
        openContent: true,
        editContent: true,
      },
    });
    expect(application.resources.open(visitor, resourceId).resource.editorMode).toBe(
      "edit"
    );

    application.permissions.updateNodeLinkSharing(owner, groupNode.id, {
      enabled: false,
      role: "editor",
    });
    expect(application.access.resolveResource(visitor, resourceId)).toBeNull();
    expect(
      application.views.listRecent(visitor, {
        cursor: undefined,
        limit: undefined,
      }).items
    ).toEqual([]);
  });
});

function createTestApplication(): WorkspaceApplication {
  const application = createWorkspaceApplication(
    {
      host: "127.0.0.1",
      port: 3020,
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
  return application;
}

async function register(
  application: WorkspaceApplication,
  username: string
): Promise<string> {
  return (
    await application.identity.registerWithPassword({
      username,
      displayName: username,
      password: "correct horse battery staple",
    })
  ).view.user.id;
}
