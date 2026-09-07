import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeData } from "@univerjs-pro/collaboration-worktree-service";
import { UniverType } from "@univerjs/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import { blankUnitData } from "../../server/src/integrations/univer/unit-store.js";
import type {
  WorktreeBackend,
} from "../../server/src/modules/worktrees/index.js";

const applications: WorkspaceApplication[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Worktrees", () => {
  it("paginates authorized summaries before hydration, with stable ordering and literal search", async () => {
    const backend = new MemoryWorktreeBackend();
    const application = createTestApplication(backend);
    const owner = await register(application, "page-owner");
    const viewer = await register(application, "page-viewer");
    const outsider = await register(application, "page-outsider");
    const team = application.spaces.createTeamSpace(owner.id, { name: "Pagination team" });
    application.permissions.upsertTeamMember(owner.id, team.id, viewer.id, { role: "viewer" });
    const visibleIds: string[] = [];
    for (let i = 0; i < 110; i += 1) {
      const visible = i < 55;
      const created = await application.worktrees.create(owner.id, `page-create-worktree-${i}`, {
        kind: "team", teamSpaceId: team.id, visibility: visible ? "space" : "private",
        name: visible ? `Visible 100%_ ${i}` : `Hidden ${i}`, summary: null,
      });
      application.database.connection.prepare("UPDATE worktrees SET created_at = ?, updated_at = ? WHERE id = ?")
        .run(visible ? 100 : 200, visible ? 100 : 200, created.body.id);
      if (visible) visibleIds.push(created.body.id);
    }
    const get = vi.spyOn(backend, "getWorktree");
    const query = { scope: "all", order: "createdAtDesc", limit: 50, kind: "team", teamSpaceId: team.id };
    const first = await application.worktrees.list(viewer.id, query);
    expect(first.items.map((item) => item.id)).toEqual(visibleIds.sort().slice(0, 50));
    expect(get).toHaveBeenCalledTimes(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await application.worktrees.list(viewer.id, { ...query, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id)).toEqual(visibleIds.slice(50));
    expect(second.nextCursor).toBeNull();
    const legacyCursor = Buffer.from(JSON.stringify({ updatedAt: 100, id: visibleIds[49] })).toString("base64url");
    expect((await application.worktrees.list(viewer.id, { scope: "active", cursor: legacyCursor })).items.map((item) => item.id))
      .toEqual(visibleIds.slice(50));
    expect((await application.worktrees.list(outsider.id, query)).items).toEqual([]);
    expect((await application.worktrees.list(owner.id, { ...query, limit: 200 })).items).toHaveLength(110);
    expect((await application.worktrees.list(viewer.id, { ...query, search: "100%_", limit: 200 })).items).toHaveLength(55);
    expect((await application.worktrees.list(viewer.id, { ...query, search: "100__", limit: 200 })).items).toEqual([]);
    expect((await application.worktrees.list(viewer.id, { ...query, search: "PAGINATION TEAM", limit: 200 })).items).toHaveLength(55);
    expect((await application.worktrees.list(viewer.id, { ...query, scope: "processed" })).items).toEqual([]);
    await expect(application.worktrees.list(viewer.id, { ...query, cursor: first.nextCursor, search: "Visible" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(application.worktrees.list(viewer.id, { ...query, search: "x".repeat(201) }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does not trash a removed Unit until all content merge results succeed", async () => {
    const backend = new MemoryWorktreeBackend();
    const application = createTestApplication(backend);
    const user = await register(application, "partial-removal-user");
    const space = application.spaces.list(user.id).spaces[0]!;
    const resource = await createResource(application, user.id, space.id);
    const created = await application.worktrees.create(user.id, "partial-removal-create-0001", {
      kind: "user",
      name: "Partial merge",
      summary: null,
    });
    const id = created.body.id;
    const removed = await application.worktrees.addUnit(user.id, id, "partial-removal-add-0001", {
      source: "trunk",
      resourceId: resource.id,
    });
    await application.worktrees.addUnit(user.id, id, "partial-removal-local-0001", {
      source: "worktree",
      name: "Blocked publication",
      unitType: "doc",
      targetSpaceId: space.id,
      targetParentNodeId: null,
    });
    await application.worktrees.setUnitRemoved(user.id, id, removed.body.unit.unitId, {
      removed: true,
    });
    await application.worktrees.markReady(user.id, id);
    vi.spyOn(backend, "merge").mockImplementationOnce(async () => {
      const current = await backend.getWorktree(id);
      return {
        ...current,
        status: "ready",
        units: current.units.map((unit) => ({
          ...unit,
          mergeResult: unit.removed
            ? { status: "removed" }
            : {
                status: "failed",
                error: {
                  code: "INTERNAL_ERROR",
                  message: "Injected publication failure",
                  retryable: true,
                },
              },
        })),
      };
    });
    const partial = await application.worktrees.merge(user.id, id, "partial-removal-merge-0001");
    expect(partial.worktree.state).toBe("ready");
    expect(application.trash.list(user.id, space.id, {}).items).toEqual([]);
    expect(application.resources.get(user.id, resource.id).resource.id).toBe(resource.id);
    await expect(
      application.worktrees.merge(user.id, id, "partial-removal-merge-0002"),
    ).resolves.toMatchObject({ worktree: { state: "merged" }, operation: { state: "completed" } });
    expect(application.trash.list(user.id, space.id, {}).items).toHaveLength(1);
  });

  it("recovers persisted removal finalization after closing and reopening both databases", async () => {
    const directory = mkdtempSync(join(tmpdir(), "workspace-removal-restart-"));
    temporaryDirectories.push(directory);
    const application = createRealTestApplication(directory);
    await application.initialize();
    const user = await register(application, "restart-removal-user");
    const space = application.spaces.list(user.id).spaces[0]!;
    const resource = await createResource(application, user.id, space.id);
    const created = await application.worktrees.create(user.id, "restart-removal-create-0001", {
      kind: "user",
      name: "Recover removal",
      summary: null,
    });
    const id = created.body.id;
    const added = await application.worktrees.addUnit(user.id, id, "restart-removal-add-0001", {
      source: "trunk",
      resourceId: resource.id,
    });
    await application.worktrees.setUnitRemoved(user.id, id, added.body.unit.unitId, {
      removed: true,
    });
    await application.worktrees.markReady(user.id, id);
    application.database.connection.exec(`
      CREATE TEMP TRIGGER fail_restart_trash BEFORE UPDATE OF trash_batch_id ON nodes
      BEGIN SELECT RAISE(ABORT, 'Stop before product deletion'); END;
    `);
    const operationId = "restart-removal-merge-0001";
    await expect(application.worktrees.merge(user.id, id, operationId)).rejects.toThrow(
      "Stop before product deletion",
    );
    expect(application.trash.list(user.id, space.id, {}).items).toEqual([]);
    expect((await application.worktrees.get(user.id, id)).worktree.state).toBe("merged");
    await application.close();
    applications.splice(applications.indexOf(application), 1);

    const reopened = createRealTestApplication(directory);
    await reopened.initialize();
    expect(reopened.operations.get(user.id, operationId).state).toBe("failed");
    await expect(reopened.operations.retry(user.id, operationId)).resolves.toMatchObject({
      state: "completed",
    });
    const batches = reopened.trash.list(user.id, space.id, {}).items;
    expect(batches).toHaveLength(1);
    await reopened.worktrees.merge(user.id, id, operationId);
    expect(reopened.trash.list(user.id, space.id, {}).items.map((batch) => batch.id)).toEqual(
      batches.map((batch) => batch.id),
    );
  });

  it("finalizes real SDK removal through Trash and preserves restoration across merge recovery", async () => {
    const application = createRealTestApplication();
    const user = await register(application, "real-removal-user");
    const space = application.spaces.list(user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(application, user.id, space.id);
    const created = await application.worktrees.create(user.id, "real-removal-create-0001", {
      kind: "user",
      name: "Review removals",
      summary: null,
    });
    const worktreeId = created.body.id;
    const trunk = await application.worktrees.addUnit(
      user.id,
      worktreeId,
      "real-removal-trunk-0001",
      { source: "trunk", resourceId: resource.id },
    );
    const local = await application.worktrees.addUnit(
      user.id,
      worktreeId,
      "real-removal-local-0001",
      {
        source: "worktree",
        name: "Canceled document",
        unitType: "doc",
        targetSpaceId: space.id,
        targetParentNodeId: null,
      },
    );
    for (const unitId of [trunk.body.unit.unitId, local.body.unit.unitId]) {
      await application.worktrees.setUnitRemoved(user.id, worktreeId, unitId, { removed: true });
      expect(
        await application.worktrees.authorizeProtocol({
          userId: user.id,
          worktreeId,
          unitId,
          write: true,
        }),
      ).toBe(false);
    }
    expect(application.resources.get(user.id, resource.id).resource.id).toBe(resource.id);
    await application.worktrees.markReady(user.id, worktreeId);
    application.database.connection.exec(`
      CREATE TEMP TRIGGER fail_after_trash BEFORE UPDATE OF processed_at ON worktrees
      BEGIN SELECT RAISE(ABORT, 'Injected finalization failure'); END;
    `);
    const operationId = "real-removal-merge-0001";
    await expect(application.worktrees.merge(user.id, worktreeId, operationId)).rejects.toThrow(
      "Injected finalization failure",
    );
    const batches = application.trash.list(user.id, space.id, {}).items;
    expect(batches).toHaveLength(1);
    await expect(application.worktrees.get(user.id, worktreeId)).resolves.toMatchObject({
      worktree: {
        state: "merged",
        units: [
          expect.objectContaining({ change: "deleted", mergeResult: "removed" }),
          expect.objectContaining({ change: "deleted", activationState: "discarded" }),
        ],
      },
    });
    await expect(
      application.worktrees.openUnit(
        user.id,
        worktreeId,
        trunk.body.unit.unitId,
        { mode: "draft" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await application.worktrees.authorizeProtocol({
        userId: user.id,
        worktreeId,
        unitId: trunk.body.unit.unitId,
        write: false,
      }),
    ).toBe(false);
    application.trash.restore(user.id, batches[0]!.id);
    application.database.connection.exec("DROP TRIGGER fail_after_trash");
    await expect(
      application.operations.retry(user.id, operationId)
    ).resolves.toMatchObject({
      state: "completed",
    });
    await expect(
      application.worktrees.merge(user.id, worktreeId, operationId),
    ).resolves.toMatchObject({ operation: { state: "completed" } });
    expect(application.trash.list(user.id, space.id, {}).items).toEqual([]);
    expect(application.resources.get(user.id, resource.id).resource.id).toBe(resource.id);
    expect(() => application.resources.get(user.id, local.body.unit.resourceId)).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    const permanentBatch = application.trash.trashNode(user.id, trunk.body.unit.nodeId!);
    application.trash.removePermanently(user.id, permanentBatch.id);
    const history = await application.worktrees.get(user.id, worktreeId);
    expect(
      history.worktree.units.find((unit) => unit.unitId === trunk.body.unit.unitId),
    ).toMatchObject({
      nodeId: null,
      name: "Removed resource",
      change: "deleted",
      mergeResult: "removed",
    });
    await expect(
      application.worktrees.merge(user.id, worktreeId, operationId),
    ).resolves.toMatchObject({ operation: { state: "completed" } });
  });

  it("cancels a new Unit after its target disappears and prevents undo until the target is restored", async () => {
    const application = createRealTestApplication();
    const user = await register(application, "canceled-target-user");
    const space = application.spaces.list(user.id).spaces[0]!;
    const folder = application.nodes.create(user.id, {
      spaceId: space.id,
      parentNodeId: null,
      name: "Target",
    });
    const created = await application.worktrees.create(user.id, "cancel-target-create-0001", {
      kind: "user",
      name: "Cancel unpublished Unit",
      summary: null,
    });
    const id = created.body.id;
    const added = await application.worktrees.addUnit(user.id, id, "cancel-target-add-0001", {
      source: "worktree",
      name: "Canceled",
      unitType: "doc",
      targetSpaceId: space.id,
      targetParentNodeId: folder.id,
    });
    const batch = application.trash.trashNode(user.id, folder.id);
    await application.worktrees.setUnitRemoved(user.id, id, added.body.unit.unitId, {
      removed: true,
    });
    await expect(
      application.worktrees.setUnitRemoved(user.id, id, added.body.unit.unitId, { removed: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    application.trash.restore(user.id, batch.id);
    await application.worktrees.setUnitRemoved(user.id, id, added.body.unit.unitId, {
      removed: false,
    });
    await application.worktrees.setUnitRemoved(user.id, id, added.body.unit.unitId, {
      removed: true,
    });
    application.trash.trashNode(user.id, folder.id);
    await application.worktrees.markReady(user.id, id);
    await expect(
      application.worktrees.merge(user.id, id, "cancel-target-merge-0001"),
    ).resolves.toMatchObject({ operation: { state: "completed" } });
    expect((await application.worktrees.get(user.id, id)).worktree.units[0]).toMatchObject({
      mergeResult: "removed",
      activationState: "discarded",
    });
  });

  it("rechecks membership before merging a deletion and discards without trashing the live Unit", async () => {
    const application = createRealTestApplication();
    const owner = await register(application, "removal-team-owner");
    const editor = await register(application, "removal-team-editor");
    const team = application.spaces.createTeamSpace(owner.id, { name: "Removal review" });
    application.permissions.upsertTeamMember(owner.id, team.id, editor.id, { role: "editor" });
    const resource = await createResource(application, editor.id, team.id);
    const created = await application.worktrees.create(editor.id, "removal-team-create-0001", {
      kind: "team",
      teamSpaceId: team.id,
      visibility: "private",
      name: "Delete",
      summary: null,
    });
    const id = created.body.id;
    const added = await application.worktrees.addUnit(editor.id, id, "removal-team-add-0001", {
      source: "trunk",
      resourceId: resource.id,
    });
    await expect(
      application.worktrees.setUnitRemoved(editor.id, id, added.body.unit.unitId, {
        removed: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    application.permissions.upsertTeamMember(owner.id, team.id, editor.id, { role: "admin" });
    await application.worktrees.setUnitRemoved(editor.id, id, added.body.unit.unitId, {
      removed: true,
    });
    await application.worktrees.markReady(editor.id, id);
    application.permissions.upsertTeamMember(owner.id, team.id, editor.id, { role: "editor" });
    await expect(
      application.worktrees.merge(editor.id, id, "removal-team-merge-0001"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(application.trash.list(owner.id, team.id, {}).items).toEqual([]);
    application.permissions.upsertTeamMember(owner.id, team.id, editor.id, { role: "editor" });
    await application.worktrees.discard(editor.id, id, "removal-team-discard-0001");
    expect(application.resources.get(owner.id, resource.id).resource.id).toBe(resource.id);
    expect(application.trash.list(owner.id, team.id, {}).items).toEqual([]);
  });

  it("records reversible deletion intent without changing the live document", async () => {
    const application = createTestApplication();
    const user = await register(application, "removal-intent-user");
    const space = application.spaces.list(user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(application, user.id, space.id);
    const created = await application.worktrees.create(user.id, "create-removal-intent-0001", {
      kind: "user",
      name: "Review deletion",
      summary: null,
    });
    const worktreeId = created.body.id;
    const added = await application.worktrees.addUnit(
      user.id,
      worktreeId,
      "add-removal-intent-0001",
      { source: "trunk", resourceId: resource.id },
    );
    const unitId = added.body.unit.unitId;
    await expect(
      application.worktrees.setUnitRemoved(user.id, worktreeId, unitId, { removed: true }),
    ).resolves.toMatchObject({
      worktree: { units: [expect.objectContaining({ change: "deleted" })] },
    });
    expect(application.resources.get(user.id, resource.id).resource.id).toBe(resource.id);
    await expect(
      application.worktrees.setUnitRemoved(user.id, worktreeId, unitId, { removed: false }),
    ).resolves.toMatchObject({
      worktree: { units: [expect.objectContaining({ change: "unchanged" })] },
    });
    await application.worktrees.markReady(user.id, worktreeId);
    await expect(
      application.worktrees.setUnitRemoved(user.id, worktreeId, unitId, { removed: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates, edits, readies and merges trunk and local Units", async () => {
    const application = createTestApplication();
    const user = await register(application, "worktree-user");
    const space = application.spaces.list(user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(application, user.id, space.id);

    const created = await application.worktrees.create(
      user.id,
      "create-user-worktree-0001",
      {
        kind: "user",
        name: "Quarterly update",
        summary: "Prepare both resources",
      }
    );
    const worktreeId = created.body.id;
    const trunk = await application.worktrees.addUnit(
      user.id,
      worktreeId,
      "add-trunk-worktree-unit-0001",
      { source: "trunk", resourceId: resource.id }
    );
    const local = await application.worktrees.addUnit(
      user.id,
      worktreeId,
      "add-local-worktree-unit-0001",
      {
        source: "worktree",
        name: "New Document",
        unitType: "doc",
        targetSpaceId: space.id,
        targetParentNodeId: null,
      }
    );

    expect(
      (
        await application.worktrees.get(user.id, worktreeId)
      ).worktree.units
    ).toEqual([
      expect.objectContaining({
        source: "trunk",
        change: "unchanged",
      }),
      expect.objectContaining({
        source: "worktree",
        change: "added",
      }),
    ]);
    await expect(
      application.worktrees.openUnit(
        user.id,
        worktreeId,
        trunk.body.unit.unitId,
        { mode: "draft" }
      )
    ).resolves.toMatchObject({
      unit: { editorMode: "edit" },
      collaborationScope: { kind: "worktree", worktreeId },
    });

    const ready = await application.worktrees.markReady(
      user.id,
      worktreeId
    );
    expect(ready.worktree.state).toBe("ready");
    expect(ready.worktree.capabilities.merge).toBe(true);
    await expect(
      application.worktrees.openUnit(
        user.id,
        worktreeId,
        local.body.unit.unitId,
        { mode: "draft" }
      )
    ).resolves.toMatchObject({
      unit: { editorMode: "readOnly" },
    });

    const merged = await application.worktrees.merge(
      user.id,
      worktreeId,
      "merge-user-worktree-0001"
    );
    expect(merged.worktree.state).toBe("merged");
    expect(merged.operation.state).toBe("completed");
    expect(
      application.resources.get(user.id, local.body.unit.resourceId)
    ).toMatchObject({
      resource: {
        id: local.body.unit.resourceId,
        unitType: "doc",
      },
      node: {
        id: local.body.unit.nodeId,
        name: "New Document",
      },
    });
    expect(
      (
        await application.worktrees.list(user.id, {
          scope: "processed",
        })
      ).items.map((item) => item.id)
    ).toContain(worktreeId);
  });

  it.each(["failed", "pending"] as const)(
    "resumes %s product activation without merging content twice",
    async (operationState) => {
      const backend = new MemoryWorktreeBackend();
      const merge = vi.spyOn(backend, "merge");
      const application = createTestApplication(backend);
      const user = await register(application, "merge-recovery-user");
      const space = application.spaces.list(user.id).spaces[0]!;
      const created = await application.worktrees.create(user.id, "create-merge-recovery-0001", {
        kind: "user",
        name: "Recover publication",
        summary: null,
      });
      const worktreeId = created.body.id;
      const local = await application.worktrees.addUnit(
        user.id,
        worktreeId,
        "add-merge-recovery-unit-0001",
        {
          source: "worktree",
          name: "Recovered document",
          unitType: "doc",
          targetSpaceId: space.id,
          targetParentNodeId: null,
        },
      );
      await application.worktrees.markReady(user.id, worktreeId);
      application.database.connection.exec(`
      CREATE TEMP TRIGGER fail_worktree_activation BEFORE INSERT ON nodes
      BEGIN SELECT RAISE(ABORT, 'Injected activation failure'); END;
    `);
      const operationId = "merge-recovery-operation-0001";
      await expect(application.worktrees.merge(user.id, worktreeId, operationId)).rejects.toThrow(
        "Injected activation failure",
      );
      expect((await backend.getWorktree(worktreeId)).status).toBe("merged");
      expect(application.operations.get(user.id, operationId).state).toBe("failed");
      application.database.connection.exec("DROP TRIGGER fail_worktree_activation");

      await expect(
        application.worktrees.merge(user.id, worktreeId, "unrelated-merge-operation-0001"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      if (operationState === "pending") {
        // A process exit can leave the operation pending after the SDK commits.
        application.database.connection
          .prepare("UPDATE operations SET state = 'pending' WHERE id = ?")
          .run(operationId);
        await expect(
          application.worktrees.merge(user.id, worktreeId, operationId),
        ).resolves.toMatchObject({ operation: { state: "completed" } });
      } else {
        await expect(application.operations.retry(user.id, operationId)).resolves.toMatchObject({
          state: "completed",
        });
      }
      expect(application.resources.get(user.id, local.body.unit.resourceId)).toMatchObject({
        node: { id: local.body.unit.nodeId, name: "Recovered document" },
      });
      await expect(
        application.worktrees.merge(user.id, worktreeId, operationId),
      ).resolves.toMatchObject({ operation: { state: "completed" } });
      expect(merge).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps private Team Worktree Units hidden from administrators", async () => {
    const application = createTestApplication();
    const owner = await register(application, "team-owner");
    const creator = await register(application, "team-editor");
    const viewer = await register(application, "team-viewer");
    const team = application.spaces.createTeamSpace(owner.id, {
      name: "Product",
    });
    application.permissions.upsertTeamMember(
      owner.id,
      team.id,
      creator.id,
      { role: "editor" }
    );
    application.permissions.upsertTeamMember(
      owner.id,
      team.id,
      viewer.id,
      { role: "viewer" }
    );
    const resource = await createResource(application, creator.id, team.id);
    const created = await application.worktrees.create(
      creator.id,
      "create-private-team-worktree-0001",
      {
        kind: "team",
        teamSpaceId: team.id,
        visibility: "private",
        name: "Private changes",
        summary: null,
      }
    );
    await application.worktrees.addUnit(
      creator.id,
      created.body.id,
      "add-private-team-unit-0001",
      { source: "trunk", resourceId: resource.id }
    );

    const ownerView = await application.worktrees.get(
      owner.id,
      created.body.id
    );
    expect(ownerView.worktree.unitCount).toBe(1);
    expect(ownerView.worktree.units).toEqual([]);
    expect(ownerView.worktree.capabilities.review).toBe(false);
    await expect(
      application.worktrees.get(viewer.id, created.body.id)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await application.worktrees.update(owner.id, created.body.id, {
      visibility: "space",
    });
    const viewerView = await application.worktrees.get(
      viewer.id,
      created.body.id
    );
    expect(viewerView.worktree.units).toHaveLength(1);
    expect(viewerView.worktree.capabilities.review).toBe(true);
    expect(viewerView.worktree.capabilities.editDraft).toBe(false);
  });

  it("records failed Worktree operations and retries their immutable input", async () => {
    const backend = new FailOnceCreateWorktreeBackend();
    const application = createTestApplication(backend);
    const user = await register(application, "retry-user");
    const operationId = "retry-create-worktree-0001";

    await expect(
      application.worktrees.create(user.id, operationId, {
        kind: "user",
        name: "Retry draft",
        summary: null,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(application.operations.get(user.id, operationId)).toMatchObject({
      kind: "createWorktree",
      state: "failed",
      error: { code: "CONFLICT" },
    });

    await expect(
      application.operations.retry(user.id, operationId)
    ).resolves.toMatchObject({
      kind: "createWorktree",
      state: "completed",
    });
    expect(
      (
        await application.worktrees.list(user.id, { scope: "active" })
      ).items
    ).toEqual([
      expect.objectContaining({ name: "Retry draft", state: "draft" }),
    ]);
  });

  it("rejects a backend-created Unit with an identity different from the reservation", async () => {
    const application = createTestApplication(
      new WrongIdentityCreateUnitBackend()
    );
    const user = await register(application, "wrong-unit-user");
    const space = application.spaces.list(user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const created = await application.worktrees.create(
      user.id,
      "create-wrong-unit-worktree-0001",
      { kind: "user", name: "Identity check", summary: null }
    );
    const operationId = "add-wrong-identity-unit-0001";

    await expect(
      application.worktrees.addUnit(
        user.id,
        created.body.id,
        operationId,
        {
          source: "worktree",
          name: "Must not publish",
          unitType: "doc",
          targetSpaceId: space.id,
          targetParentNodeId: null,
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(application.operations.get(user.id, operationId)).toMatchObject({
      state: "failed",
      error: { code: "CONFLICT" },
    });
    await expect(
      application.worktrees.get(user.id, created.body.id)
    ).resolves.toMatchObject({ worktree: { units: [] } });
  });

  it("creates, retries and activates an imported Unit with one stable server identity", async () => {
    const application = createRealTestApplication();
    const user = await register(application, "real-import-user");
    const space = application.spaces.list(user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const created = await application.worktrees.create(
      user.id,
      "create-real-import-worktree-0001",
      { kind: "user", name: "Real import", summary: null }
    );
    const clientUnitId = "client-owned-unit-id";
    const initial = blankUnitData({
      unitId: clientUnitId,
      unitType: "doc",
      name: "Imported document content",
    });
    const operationId = "add-real-imported-unit-0001";
    const input = {
      source: "worktree" as const,
      name: "Imported document",
      unitType: "doc" as const,
      targetSpaceId: space.id,
      targetParentNodeId: null,
      initialData: initial.data as unknown as Readonly<
        Record<string, unknown>
      >,
    };

    const first = await application.worktrees.addUnit(
      user.id,
      created.body.id,
      operationId,
      input
    );
    const second = await application.worktrees.addUnit(
      user.id,
      created.body.id,
      operationId,
      input
    );
    expect(first.body.unit).toMatchObject({
      source: "worktree",
      unitType: "doc",
      draftHeadRevision: 1,
    });
    expect(first.body.unit.unitId).not.toBe(clientUnitId);
    expect(second.body.unit.unitId).toBe(first.body.unit.unitId);
    expect(
      (await application.worktrees.get(user.id, created.body.id)).worktree
        .units
    ).toHaveLength(1);

    await application.worktrees.markReady(user.id, created.body.id);
    const merged = await application.worktrees.merge(
      user.id,
      created.body.id,
      "merge-real-import-worktree-0001"
    );
    expect(merged.operation.state).toBe("completed");
    expect(
      application.resources.open(user.id, first.body.unit.resourceId)
    ).toMatchObject({
      resource: {
        id: first.body.unit.resourceId,
        unitId: first.body.unit.unitId,
        nodeId: first.body.unit.nodeId,
      },
    });
  });
});

class MemoryWorktreeBackend implements WorktreeBackend {
  private readonly _worktrees = new Map<string, WorktreeData>();

  async createWorktree(worktreeId: string): Promise<WorktreeData> {
    const existing = this._worktrees.get(worktreeId);
    if (existing) return existing;
    const value: WorktreeData = {
      worktreeID: worktreeId,
      status: "draft",
      units: [],
    };
    this._worktrees.set(worktreeId, value);
    return value;
  }

  async getWorktree(worktreeId: string): Promise<WorktreeData> {
    return this._require(worktreeId);
  }

  async addUnit(
    worktreeId: string,
    unitId: string
  ): Promise<WorktreeData> {
    const current = this._require(worktreeId);
    if (current.units.some((unit) => unit.unitID === unitId)) {
      return current;
    }
    return this._set(worktreeId, {
      ...current,
      units: [
        ...current.units,
        {
          unitID: unitId,
          type: UniverType.UNIVER_SHEET,
          source: "trunk",
          baselineTrunkRevision: 1,
          draftHeadRevision: 1,
        },
      ],
    });
  }

  async createUnit(
    input: Parameters<WorktreeBackend["createUnit"]>[0]
  ): Promise<WorktreeData> {
    const current = this._require(input.worktreeId);
    const types = {
      sheet: UniverType.UNIVER_SHEET,
      doc: UniverType.UNIVER_DOC,
      slide: UniverType.UNIVER_SLIDE,
      board: UniverType.UNIVER_BOARD,
      base: UniverType.UNIVER_BASE,
    };
    return this._set(input.worktreeId, {
      ...current,
      units: [
        ...current.units,
        {
          unitID: input.unitId,
          type: types[input.unitType],
          source: "worktree",
          draftHeadRevision: 1,
        },
      ],
    });
  }

  async markReady(worktreeId: string): Promise<WorktreeData> {
    return this._transition(worktreeId, "ready");
  }

  async setUnitRemoved(
    worktreeId: string,
    unitId: string,
    removed: boolean,
  ): Promise<WorktreeData> {
    const current = this._require(worktreeId);
    if (current.status !== "draft") throw new Error("Worktree is frozen");
    return this._set(worktreeId, {
      ...current,
      units: current.units.map((unit) => (unit.unitID === unitId ? { ...unit, removed } : unit)),
    });
  }

  async reopen(worktreeId: string): Promise<WorktreeData> {
    return this._transition(worktreeId, "draft");
  }

  async merge(worktreeId: string): Promise<WorktreeData> {
    const current = this._require(worktreeId);
    return this._set(worktreeId, {
      ...current,
      status: "merged",
      units: current.units.map((unit) => ({
        ...unit,
        mergeResult: unit.removed ? { status: "removed" } : { status: "merged", trunkRevision: 2 },
      })),
    });
  }

  async discard(worktreeId: string): Promise<WorktreeData> {
    return this._transition(worktreeId, "discarded");
  }

  async submitChangeset(
    _worktreeId: string,
    changeset: Parameters<WorktreeBackend["submitChangeset"]>[1],
    userId: string
  ): ReturnType<WorktreeBackend["submitChangeset"]> {
    return {
      status: "committed",
      changeset: {
        ...changeset,
        userID: userId,
        memberID: `product-api:${userId}`,
      },
    };
  }

  private _transition(
    worktreeId: string,
    status: WorktreeData["status"]
  ): WorktreeData {
    return this._set(worktreeId, {
      ...this._require(worktreeId),
      status,
    });
  }

  private _set(worktreeId: string, value: WorktreeData): WorktreeData {
    this._worktrees.set(worktreeId, value);
    return value;
  }

  private _require(worktreeId: string): WorktreeData {
    const value = this._worktrees.get(worktreeId);
    if (!value) {
      const error = new Error("Worktree not found") as Error & {
        code: string;
      };
      error.code = "WORKTREE_NOT_FOUND";
      throw error;
    }
    return value;
  }
}

class FailOnceCreateWorktreeBackend extends MemoryWorktreeBackend {
  private _failed = false;

  override async createWorktree(
    worktreeId: string
  ): Promise<WorktreeData> {
    if (!this._failed) {
      this._failed = true;
      throw new Error("Temporary Worktree service failure");
    }
    return super.createWorktree(worktreeId);
  }
}

class WrongIdentityCreateUnitBackend extends MemoryWorktreeBackend {
  override async createUnit(
    input: Parameters<WorktreeBackend["createUnit"]>[0]
  ): Promise<WorktreeData> {
    const current = await this.getWorktree(input.worktreeId);
    return {
      ...current,
      units: [
        ...current.units,
        {
          unitID: "wrong-unit-id",
          type: UniverType.UNIVER_DOC,
          source: "worktree",
          draftHeadRevision: 1,
        },
      ],
    };
  }
}

function createTestApplication(
  worktreeBackend: WorktreeBackend = new MemoryWorktreeBackend()
): WorkspaceApplication {
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
      worktreeBackend,
    }
  );
  applications.push(application);
  return application;
}

function createRealTestApplication(directory?: string): WorkspaceApplication {
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: directory ? join(directory, "product.sqlite") : ":memory:",
    collaborationDatabaseFilename: directory ? join(directory, "collaboration.sqlite") : ":memory:",
    ...(directory ? { blobDirectory: join(directory, "blobs") } : {}),
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
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
  spaceId: string
) {
  const result = await application.resources.create(
    userId,
    `create-worktree-resource-${crypto.randomUUID()}`,
    {
      kind: "univer",
      spaceId,
      parentNodeId: null,
      name: "Existing Sheet",
      unitType: "sheet",
    }
  );
  if (result.status === 202) throw new Error("Resource creation is pending");
  const resource = result.body.node.resource;
  if (!resource) throw new Error("Created Resource is missing");
  return { id: resource.id, node: result.body.node };
}
