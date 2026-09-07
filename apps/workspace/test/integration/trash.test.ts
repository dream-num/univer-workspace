import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import { TrashRepository } from "../../server/src/modules/trash/trash.repository.js";

const applications: WorkspaceApplication[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
});

describe("Trash Batches", () => {
  it("replays a workflow deletion without repeating it after restoration", async () => {
    const application = createTestApplication();
    const owner = await register(application, "retry-trash-owner");
    const stranger = await register(application, "retry-trash-stranger");
    const space = application.spaces.list(owner.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(application, owner.id, space.id, null, "Retry Sheet");
    const nodeId = resource.node.id;
    const batchId = "workflow-trash-batch-0001";
    expect(() => application.trash.trashNodeOnce(stranger.id, nodeId, batchId)).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    application.trash.trashNodeOnce(owner.id, nodeId, batchId);
    application.trash.trashNodeOnce(owner.id, nodeId, batchId);
    expect(application.trash.list(owner.id, space.id, {}).items).toHaveLength(1);
    expect(() => application.trash.trashNodeOnce(stranger.id, nodeId, batchId)).toThrowError(
      expect.objectContaining({ code: "CONFLICT" }),
    );
    expect(() => application.trash.trashNodeOnce(owner.id, "other-node", batchId)).toThrowError(
      expect.objectContaining({ code: "CONFLICT" }),
    );

    application.trash.restore(owner.id, batchId);
    application.trash.trashNodeOnce(owner.id, nodeId, batchId);
    // The repository also protects callers that observed an absent batch before another writer.
    new TrashRepository(application.database).trashNode({
      batchId,
      nodeId,
      spaceId: space.id,
      createdBy: owner.id,
      createdAt: Date.now(),
    });
    expect(
      application.resources.get(owner.id, resource.resourceId).resource.id
    ).toBe(resource.resourceId);
    expect(application.trash.list(owner.id, space.id, {}).items).toEqual(
      []
    );
  });

  it("rolls back the workflow receipt when deleting the Node fails", async () => {
    const application = createTestApplication();
    const owner = await register(application, "atomic-trash-owner");
    const space = application.spaces.list(owner.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(application, owner.id, space.id, null, "Atomic Sheet");
    const batchId = "atomic-workflow-trash-0001";
    application.database.connection.exec(`
      CREATE TEMP TRIGGER fail_trash_write BEFORE UPDATE OF trash_batch_id ON nodes
      BEGIN SELECT RAISE(ABORT, 'Injected Trash failure'); END;
    `);
    expect(() => application.trash.trashNodeOnce(owner.id, resource.node.id, batchId)).toThrow(
      "Injected Trash failure",
    );
    expect(new TrashRepository(application.database).findBatch(batchId)).toBeNull();
    expect(
      application.resources.get(owner.id, resource.resourceId).resource.id
    ).toBe(resource.resourceId);
    application.database.connection.exec("DROP TRIGGER fail_trash_write");
    application.trash.trashNodeOnce(owner.id, resource.node.id, batchId);
    expect(application.trash.list(owner.id, space.id, {}).items).toEqual([
      expect.objectContaining({ id: batchId }),
    ]);
  });

  it("keeps nested batches independent and restores them in parent-first order", async () => {
    const application = createTestApplication();
    const owner = await register(application, "trash-owner");
    const space = application.spaces.list(owner.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const groupNode = application.nodes.create(owner.id, {
      spaceId: space.id,
      parentNodeId: null,
      name: "Parent",
    });
    const resource = await createResource(
      application,
      owner.id,
      space.id,
      groupNode.id,
      "Nested Sheet"
    );

    const resourceBatch = application.trash.trashNode(
      owner.id,
      resource.node.id
    );
    const parentBatch = application.trash.trashNode(owner.id, groupNode.id);

    expect(resourceBatch.nodeCount).toBe(1);
    expect(parentBatch.nodeCount).toBe(1);
    const listed = application.trash.list(owner.id, space.id, {});
    expect(new Set(listed.items.map((item) => item.id))).toEqual(
      new Set([parentBatch.id, resourceBatch.id])
    );
    expect(
      listed.items.find((item) => item.id === resourceBatch.id)
        ?.restoreBlockedBy
    ).toEqual({
      code: "RESTORE_PARENT_IN_TRASH",
      trashBatchId: parentBatch.id,
    });
    expect(
      listed.items.find((item) => item.id === parentBatch.id)
        ?.removeBlockedBy
    ).toEqual({
      code: "NESTED_TRASH_BATCH",
      trashBatchId: resourceBatch.id,
    });

    expect(() =>
      application.trash.restore(owner.id, resourceBatch.id)
    ).toThrowError(
      expect.objectContaining({ code: "RESTORE_PARENT_IN_TRASH" })
    );
    application.trash.restore(owner.id, parentBatch.id);
    expect(application.nodes.get(owner.id, groupNode.id)).toEqual(
      expect.objectContaining({
        node: expect.objectContaining({ id: groupNode.id }),
      })
    );
    expect(() =>
      application.resources.get(owner.id, resource.resourceId)
    ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
    application.trash.restore(owner.id, resourceBatch.id);
    expect(
      application.resources.get(owner.id, resource.resourceId).resource.id
    ).toBe(resource.resourceId);
    expect(application.trash.list(owner.id, space.id, {}).items).toEqual(
      []
    );
  });

  it("permanently removes a subtree but blocks active Worktree references", async () => {
    const application = createTestApplication();
    const owner = await register(application, "remove-owner");
    const space = application.spaces.list(owner.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(
      application,
      owner.id,
      space.id,
      null,
      "Referenced Sheet"
    );
    const batch = application.trash.trashNode(owner.id, resource.node.id);
    const timestamp = Date.now();
    application.database.connection
      .prepare(
        `INSERT INTO worktrees
          (
            id, name, summary, creator_user_id, kind, team_space_id,
            visibility, created_at, updated_at
          )
         VALUES (?, ?, NULL, ?, 'user', NULL, 'private', ?, ?)`
      )
      .run("active-worktree", "Active", owner.id, timestamp, timestamp);
    application.database.connection
      .prepare(
        `INSERT INTO worktree_units
          (worktree_id, unit_id, resource_id, source, ordinal, added_at)
         SELECT 'active-worktree', unit_id, resource_id, 'trunk', 0, ?
         FROM univer_resources WHERE resource_id = ?`
      )
      .run(timestamp, resource.resourceId);

    expect(() =>
      application.trash.removePermanently(owner.id, batch.id)
    ).toThrowError(
      expect.objectContaining({
        code: "ACTIVE_WORKTREE_RESOURCE_REFERENCE",
      })
    );
    application.database.connection
      .prepare(
        "UPDATE worktrees SET processed_at = ? WHERE id = 'active-worktree'"
      )
      .run(timestamp);
    application.trash.removePermanently(owner.id, batch.id);
    expect(
      application.database.connection
        .prepare("SELECT 1 FROM nodes WHERE id = ?")
        .get(resource.node.id)
    ).toBeUndefined();
    expect(() =>
      application.trash.removePermanently(owner.id, batch.id)
    ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
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
        async createUnit(input) {
          return { unitId: input.unitId, headRevision: 1 };
        },
      },
    }
  );
  applications.push(application);
  return application;
}

async function register(
  application: WorkspaceApplication,
  username: string
) {
  const issued = await application.identity.registerWithPassword({
    username,
    displayName: username,
    password: "correct horse battery staple",
  });
  return issued.view.user;
}

async function createResource(
  application: WorkspaceApplication,
  userId: string,
  spaceId: string,
  parentNodeId: string | null,
  name: string
) {
  const created = await application.resources.create(
    userId,
    `create-${name.toLowerCase().replaceAll(" ", "-")}-0001`,
    { kind: "univer", spaceId, parentNodeId, name, unitType: "sheet" }
  );
  if (created.status === 202) throw new Error("Resource creation is pending");
  const resourceId = created.body.node.resource?.id;
  if (!resourceId) throw new Error("Created Resource is missing");
  return { node: created.body.node, resourceId };
}
