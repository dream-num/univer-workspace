import type { WorktreeData } from "@univerjs-pro/collaboration-worktree-service";
import { UniverType } from "@univerjs/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import { blankUnitData } from "../../server/src/integrations/univer/unit-store.js";
import type {
  WorktreeBackend,
} from "../../server/src/modules/worktrees/index.js";

const applications: WorkspaceApplication[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
});

describe("Worktrees", () => {
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
    const privateUnit = await application.worktrees.addUnit(
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
      application.worktrees.compareUnit(
        owner.id,
        created.body.id,
        privateUnit.body.unit.unitId
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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

  it("builds self-contained Trunk and new-Unit comparison packages", async () => {
    const application = createRealTestApplication();
    const user = await register(application, "comparison-user");
    const space = application.spaces.list(user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(application, user.id, space.id);
    const created = await application.worktrees.create(
      user.id,
      "create-comparison-worktree-0001",
      { kind: "user", name: "Comparison", summary: null }
    );
    const existing = await application.worktrees.addUnit(
      user.id,
      created.body.id,
      "add-comparison-trunk-unit-0001",
      { source: "trunk", resourceId: resource.id }
    );
    const local = await application.worktrees.addUnit(
      user.id,
      created.body.id,
      "add-comparison-local-unit-0001",
      {
        source: "worktree",
        name: "New comparison document",
        unitType: "doc",
        targetSpaceId: space.id,
        targetParentNodeId: null,
      }
    );

    const unchanged = await application.worktrees.compareUnit(
      user.id,
      created.body.id,
      existing.body.unit.unitId
    );
    expect(unchanged).toMatchObject({
      unit: { unitType: "sheet" },
      fidelity: "history",
      left: { present: true, revision: 1 },
      right: { present: true, revision: 1 },
      diff: { summary: { total: 0 } },
    });

    const added = await application.worktrees.compareUnit(
      user.id,
      created.body.id,
      local.body.unit.unitId
    );
    expect(added).toMatchObject({
      unit: { unitType: "doc" },
      fidelity: "snapshot",
      left: { present: false },
      right: { present: true, revision: 1 },
    });
    expect(
      (added.diff.summary as { readonly total: number }).total
    ).toBeGreaterThan(0);
  });

  it("materializes comparisons for every supported Univer Unit type", async () => {
    const application = createRealTestApplication();
    const user = await register(application, "all-comparison-types-user");
    const space = application.spaces.list(user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const created = await application.worktrees.create(
      user.id,
      "create-all-comparison-types-worktree-0001",
      { kind: "user", name: "All comparison types", summary: null }
    );

    for (const unitType of [
      "sheet",
      "doc",
      "slide",
      "board",
      "base",
    ] as const) {
      const resource = await createResource(
        application,
        user.id,
        space.id,
        unitType
      );
      const added = await application.worktrees.addUnit(
        user.id,
        created.body.id,
        `add-${unitType}-comparison-unit-0001`,
        { source: "trunk", resourceId: resource.id }
      );
      await expect(
        application.worktrees.compareUnit(
          user.id,
          created.body.id,
          added.body.unit.unitId
        )
      ).resolves.toMatchObject({
        unit: { unitType },
        left: { present: true },
        right: { present: true },
        diff: { summary: { total: 0 } },
      });
    }
  });

  it("materializes referenced Base blocks for both comparison sides", async () => {
    const application = createRealTestApplication();
    const user = await register(application, "base-block-comparison-user");
    const space = application.spaces.list(user.id).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const resource = await createResource(
      application,
      user.id,
      space.id,
      "base",
      baseWithOneRecord()
    );
    const created = await application.worktrees.create(
      user.id,
      "create-base-block-comparison-worktree-0001",
      { kind: "user", name: "Base block comparison", summary: null }
    );
    const added = await application.worktrees.addUnit(
      user.id,
      created.body.id,
      "add-base-block-comparison-unit-0001",
      { source: "trunk", resourceId: resource.id }
    );

    await expect(
      application.worktrees.compareUnit(
        user.id,
        created.body.id,
        added.body.unit.unitId
      )
    ).resolves.toMatchObject({
      unit: { unitType: "base" },
      left: { present: true },
      right: { present: true },
      diff: { summary: { total: 0 } },
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
        mergeResult: { status: "merged", trunkRevision: 2 },
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

function createRealTestApplication(): WorkspaceApplication {
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
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
  spaceId: string,
  unitType: "sheet" | "doc" | "slide" | "board" | "base" = "sheet",
  initialData?: Readonly<Record<string, unknown>>
) {
  const result = await application.resources.create(
    userId,
    `create-worktree-resource-${crypto.randomUUID()}`,
    {
      kind: "univer",
      spaceId,
      parentNodeId: null,
      name: "Existing Sheet",
      unitType,
      ...(initialData === undefined ? {} : { initialData }),
    }
  );
  if (result.status === 202) throw new Error("Resource creation is pending");
  const resource = result.body.node.resource;
  if (!resource) throw new Error("Created Resource is missing");
  return { id: resource.id, node: result.body.node };
}

function baseWithOneRecord(): Readonly<Record<string, unknown>> {
  return {
    name: "Existing Base",
    schemaVersion: 2,
    tableOrder: ["table-1"],
    tables: {
      "table-1": {
        id: "table-1",
        name: "People",
        primaryFieldId: "name",
        fieldOrder: ["__record_id", "name"],
        fields: {
          __record_id: {
            id: "__record_id",
            name: "record-id",
            type: "recordId",
            config: {},
            system: true,
            readonly: true,
          },
          name: {
            id: "name",
            name: "Name",
            type: "text",
            config: {},
          },
        },
        records: {
          "record-1": {
            id: "record-1",
            values: { __record_id: "record-1", name: "Ada" },
            orderKey: "1",
            createdAt: 1,
            updatedAt: 1,
          },
        },
        recordOrder: ["record-1"],
        rowIndex: { "record-1": 0 },
        rowId: { 0: "record-1" },
        colIndex: { __record_id: 0, name: 1 },
        colId: { 0: "__record_id", 1: "name" },
        cellData: {
          0: {
            0: { v: "record-1", t: 1 },
            1: { v: "Ada", t: 1 },
          },
        },
        resources: { attachmentSets: {}, attachments: {} },
        views: {
          "view-1": {
            id: "view-1",
            tableId: "table-1",
            name: "Grid",
            type: "grid",
            fieldOrder: ["__record_id", "name"],
            fieldSettings: { __record_id: { hidden: true } },
            config: { frozenFieldCount: 1 },
          },
        },
        viewOrder: ["view-1"],
        formulaName: "Table_1",
      },
    },
    resources: [],
    createdAt: 1,
    updatedAt: 1,
    locale: "enUS",
  };
}
