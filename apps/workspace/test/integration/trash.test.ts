import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSqliteTestApplication,
  type SqliteTestApplication,
} from "../support/sqlite/test-application.js";

const applications: SqliteTestApplication[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
});

describe("Trash Batches", () => {
  it("replays a workflow deletion without repeating it after restoration", async () => {
    const application = await createTestApplication();
    const owner = await register(application, "retry-trash-owner");
    const stranger = await register(application, "retry-trash-stranger");
    const space = (await application.spaces.list(owner.id)).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(application, owner.id, space.id, null, "Retry Sheet");
    const nodeId = resource.node.id;
    const batchId = "workflow-trash-batch-0001";
    await expect(application.trash.trashNodeOnce(stranger.id, nodeId, batchId)).rejects.toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    await application.trash.trashNodeOnce(owner.id, nodeId, batchId);
    await application.trash.trashNodeOnce(owner.id, nodeId, batchId);
    expect((await application.trash.list(owner.id, space.id, {})).items).toHaveLength(1);
    await expect(application.trash.trashNodeOnce(stranger.id, nodeId, batchId)).rejects.toThrowError(
      expect.objectContaining({ code: "CONFLICT" }),
    );
    await expect(application.trash.trashNodeOnce(owner.id, "other-node", batchId)).rejects.toThrowError(
      expect.objectContaining({ code: "CONFLICT" }),
    );

    await application.trash.restore(owner.id, batchId);
    await application.trash.trashNodeOnce(owner.id, nodeId, batchId);
    // The repository also protects callers that observed an absent batch before another writer.
    await application.repositories.trash.trashNode({
      batchId,
      nodeId,
      createdBy: owner.id,
      createdAt: Date.now(),
    });
    expect(
      (await application.resources.get(owner.id, resource.resourceId)).resource.id
    ).toBe(resource.resourceId);
    expect((await application.trash.list(owner.id, space.id, {})).items).toEqual(
      []
    );
  });

  it("creates a single active batch during concurrent deletion and preserves a node restored before permanent removal", async () => {
    const application = await createTestApplication();
    const owner = await register(application, "concurrent-trash");
    const space = (await application.spaces.list(owner.id)).spaces[0]!;
    const resource = await createResource(application, owner.id, space.id, null, "Concurrent Sheet");
    const results = await Promise.allSettled([
      application.trash.trashNode(owner.id, resource.node.id),
      application.trash.trashNode(owner.id, resource.node.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "NOT_FOUND" } });
    const { items } = await application.trash.list(owner.id, space.id, {});
    expect(items).toHaveLength(1);
    const repository = application.repositories.trash;
    const remove = repository.removePermanently.bind(repository);
    vi.spyOn(repository, "removePermanently").mockImplementationOnce(async (batchId, actorId, at) => {
      await application.trash.restore(owner.id, batchId);
      return remove(batchId, actorId, at);
    });
    await expect(application.trash.removePermanently(owner.id, items[0]!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await application.resources.get(owner.id, resource.resourceId)).node.id).toBe(resource.node.id);
  });

  it("checks the current actor before trashing, restoring or permanently removing nodes", async () => {
    const app = await createTestApplication();
    const owner = await register(app, "trash-space-owner");
    const admin = await register(app, "trash-space-admin");
    const space = await app.spaces.createTeamSpace(owner.id, { name: "Trash permissions" });
    await app.permissions.upsertTeamMember(owner.id, space.id, admin.id, { role: "admin" });
    const active = await createResource(app, owner.id, space.id, null, "Active sheet");
    const trashed = await createResource(app, owner.id, space.id, null, "Trashed sheet");
    const batch = await app.trash.trashNode(admin.id, trashed.node.id);
    expect((await app.trash.list(admin.id, space.id, {})).items[0]?.id).toBe(batch.id);

    await app.permissions.upsertTeamMember(owner.id, space.id, admin.id, { role: "viewer" });
    const repository = app.repositories.trash;
    await expect(repository.trashNode({
      batchId: "stale-admin", nodeId: active.node.id, createdBy: admin.id, createdAt: Date.now(),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repository.restore(batch.id, admin.id, Date.now())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repository.removePermanently(batch.id, admin.id, Date.now())).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await repository.findBatch("stale-admin")).toBeNull();
    expect((await app.resources.get(owner.id, active.resourceId)).node.id).toBe(active.node.id);
    expect((await app.trash.restore(owner.id, batch.id)).id).toBe(trashed.node.id);
  });

  it("rolls back the workflow receipt when deleting the Node fails", async () => {
    const application = await createTestApplication();
    const owner = await register(application, "atomic-trash-owner");
    const space = (await application.spaces.list(owner.id)).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(application, owner.id, space.id, null, "Atomic Sheet");
    const batchId = "atomic-workflow-trash-0001";
    application.database.connection.exec(`
      CREATE TEMP TRIGGER fail_trash_write BEFORE UPDATE OF trash_batch_id ON nodes
      BEGIN SELECT RAISE(ABORT, 'Injected Trash failure'); END;
    `);
    await expect(application.trash.trashNodeOnce(owner.id, resource.node.id, batchId)).rejects.toThrow(
      "Injected Trash failure",
    );
    expect(await application.repositories.trash.findBatch(batchId)).toBeNull();
    expect(
      (await application.resources.get(owner.id, resource.resourceId)).resource.id
    ).toBe(resource.resourceId);
    application.database.connection.exec("DROP TRIGGER fail_trash_write");
    await application.trash.trashNodeOnce(owner.id, resource.node.id, batchId);
    expect((await application.trash.list(owner.id, space.id, {})).items).toEqual([
      expect.objectContaining({ id: batchId }),
    ]);
  });

  it("keeps nested batches independent and restores them in parent-first order", async () => {
    const application = await createTestApplication();
    const owner = await register(application, "trash-owner");
    const space = (await application.spaces.list(owner.id)).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const groupNode = await application.nodes.create(owner.id, {
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

    const resourceBatch = await application.trash.trashNode(
      owner.id,
      resource.node.id
    );
    const parentBatch = await application.trash.trashNode(owner.id, groupNode.id);

    expect(resourceBatch.nodeCount).toBe(1);
    expect(parentBatch.nodeCount).toBe(1);
    const listed = await application.trash.list(owner.id, space.id, {});
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

    await expect(application.trash.restore(owner.id, resourceBatch.id)
    ).rejects.toThrowError(
      expect.objectContaining({ code: "RESTORE_PARENT_IN_TRASH" })
    );
    await application.trash.restore(owner.id, parentBatch.id);
    expect(await application.nodes.get(owner.id, groupNode.id)).toEqual(
      expect.objectContaining({
        node: expect.objectContaining({ id: groupNode.id }),
      })
    );
    await expect(application.resources.get(owner.id, resource.resourceId)
    ).rejects.toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
    await application.trash.restore(owner.id, resourceBatch.id);
    expect(
      (await application.resources.get(owner.id, resource.resourceId)).resource.id
    ).toBe(resource.resourceId);
    expect((await application.trash.list(owner.id, space.id, {})).items).toEqual(
      []
    );
  });

  it("permanently removes a subtree but blocks active Worktree references", async () => {
    const application = await createTestApplication();
    const owner = await register(application, "remove-owner");
    const space = (await application.spaces.list(owner.id)).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(
      application,
      owner.id,
      space.id,
      null,
      "Referenced Sheet"
    );
    const batch = await application.trash.trashNode(owner.id, resource.node.id);
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

    await expect(application.trash.removePermanently(owner.id, batch.id)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "ACTIVE_WORKTREE_RESOURCE_REFERENCE",
      })
    );
    application.database.connection
      .prepare(
        "UPDATE worktrees SET processed_at = ? WHERE id = 'active-worktree'"
      )
      .run(timestamp);
    await application.trash.removePermanently(owner.id, batch.id);
    expect(
      application.database.connection
        .prepare("SELECT 1 FROM nodes WHERE id = ?")
        .get(resource.node.id)
    ).toBeUndefined();
    await expect(application.trash.removePermanently(owner.id, batch.id)
    ).rejects.toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});

async function createTestApplication(): Promise<SqliteTestApplication> {
  const application = await createSqliteTestApplication(
    {
      host: "127.0.0.1",
      port: 3020,
      productDatabase: { provider: "sqlite", filename: ":memory:" },
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
  application: SqliteTestApplication,
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
  application: SqliteTestApplication,
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
