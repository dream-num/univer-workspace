import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import {
  blankUnitData,
  collaborationCallOptions,
  createCollaborationRuntime,
  createUnitData,
  type UnitStore,
} from "../../server/src/integrations/univer/unit-store.js";
import { createWorktreeBackend } from "../../server/src/integrations/univer/worktree-store.js";
import { ApplicationError } from "../../server/src/middleware/errors.js";
import type { UnitType } from "../../server/src/modules/access/index.js";

const applications: WorkspaceApplication[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Resources", () => {
  it("creates one collaboration Unit and one Node/Resource per idempotency key", async () => {
    const createdUnits: string[] = [];
    const application = createTestApplication(async ({ unitId }) => {
      createdUnits.push(unitId);
    });
    const userId = await register(application, "alice");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const operationId = "create-resource-operation-0001";
    const input = {
      kind: "univer" as const,
      spaceId: space.id,
      parentNodeId: null,
      name: "Budget",
      unitType: "sheet",
    };

    const first = await application.resources.create(userId, operationId, input);
    expect(first).toMatchObject({
      status: 201,
      body: {
        operation: {
          id: operationId,
          kind: "createResource",
          state: "completed",
        },
        node: {
          name: "Budget",
          resource: { unitType: "sheet" },
        },
      },
    });
    const second = await application.resources.create(userId, operationId, input);
    expect(second).toMatchObject({
      status: 200,
      body: {
        operation: { id: operationId, state: "completed" },
      },
    });
    expect(createdUnits).toHaveLength(1);

    await expect(
      application.resources.create(userId, operationId, {
        ...input,
        name: "Other",
      })
    ).rejects.toMatchObject<ApplicationError>({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("records recent only after a successful Resource open", async () => {
    const application = createTestApplication(async () => {});
    const userId = await register(application, "alice");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const created = await application.resources.create(
      userId,
      "create-resource-operation-0002",
      {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: null,
        name: "Plan",
        unitType: "doc",
      }
    );
    if (created.status === 202) throw new Error("Resource creation is pending");
    const resourceId = created.body.node.resource?.id;
    if (!resourceId) throw new Error("Created Resource is missing");

    expect(
      application.views.listOwned(userId, {
        cursor: undefined,
        limit: undefined,
      })
    ).toMatchObject({
      items: [
        {
          node: { id: created.body.node.id, name: "Plan" },
          resource: { id: resourceId, unitType: "doc" },
          location: {
            space: { id: space.id },
            breadcrumbs: [],
          },
        },
      ],
      nextCursor: null,
    });

    expect(
      application.database.connection
        .prepare("SELECT COUNT(*) AS count FROM recent_resources")
        .get()
    ).toMatchObject({ count: 0 });
    expect(application.resources.open(userId, resourceId)).toMatchObject({
      resource: {
        id: resourceId,
        nodeId: created.body.node.id,
        name: "Plan",
        unitType: "doc",
        editorMode: "edit",
      },
    });
    expect(
      application.database.connection
        .prepare("SELECT COUNT(*) AS count FROM recent_resources")
        .get()
    ).toMatchObject({ count: 1 });
    expect(
      application.views.listRecent(userId, {
        cursor: undefined,
        limit: undefined,
      })
    ).toMatchObject({
      items: [
        {
          node: {
            id: created.body.node.id,
            name: "Plan",
          },
          resource: { id: resourceId, unitType: "doc" },
          location: {
            space: { id: space.id },
            breadcrumbs: [],
          },
        },
      ],
      nextCursor: null,
    });
  });

  it("keeps an operation pending when collaboration creation can be retried", async () => {
    let attempt = 0;
    const application = createTestApplication(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("temporary failure");
    });
    const userId = await register(application, "alice");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const operationId = "create-resource-operation-0003";
    const input = {
      kind: "univer" as const,
      spaceId: space.id,
      parentNodeId: null,
      name: "Retry",
      unitType: "sheet",
    };

    await expect(
      application.resources.create(userId, operationId, input)
    ).resolves.toMatchObject({
      status: 202,
      body: {
        operation: {
          state: "pending",
          error: { code: "INTERNAL_ERROR" },
        },
      },
    });
    await expect(
      application.resources.create(userId, operationId, input)
    ).resolves.toMatchObject({
      status: 202,
      body: {
        operation: { state: "pending" },
      },
    });
    expect(attempt).toBe(1);

    application.database.connection
      .prepare(
        `UPDATE operations
         SET next_attempt_at = 0, lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ?`
      )
      .run(operationId);
    await expect(
      application.resources.resumeDue("test-worker")
    ).resolves.toBe(1);
    expect(application.resources.getOperation(userId, operationId)).toMatchObject({
      state: "completed",
    });
    expect(attempt).toBe(2);
  });

  it("forwards initial Unit data with the server-reserved identity", async () => {
    let received: Parameters<UnitStore["createUnit"]>[0] | undefined;
    const application = createTestApplication(async (input) => {
      received = input;
    });
    const userId = await register(application, "importer");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");
    const initialData = {
      id: "client-unit-id",
      rev: 29,
      name: "Imported document",
    };

    const created = await application.resources.create(
      userId,
      "create-imported-resource-0001",
      {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: null,
        name: "Import target",
        unitType: "doc",
        initialData,
      }
    );

    expect(created.status).toBe(201);
    expect(received).toMatchObject({
      unitType: "doc",
      name: "Import target",
      initialData,
    });
    expect(received?.unitId).not.toBe(initialData.id);
  });

  it("does not publish a Resource when collaboration returns another Unit identity", async () => {
    const application = createWorkspaceApplication(
      testConfig(),
      {
        unitStore: {
          async createUnit() {
            return { unitId: "wrong-unit-id", headRevision: 1 };
          },
        },
      }
    );
    applications.push(application);
    const userId = await register(application, "identity-mismatch");
    const space = application.spaces.list(userId).spaces[0];
    if (!space) throw new Error("Personal space is missing");

    await expect(
      application.resources.create(
        userId,
        "create-resource-identity-mismatch-0001",
        {
          kind: "univer",
          spaceId: space.id,
          parentNodeId: null,
          name: "Must not publish",
          unitType: "sheet",
        }
      )
    ).resolves.toMatchObject({
      status: 202,
      body: {
        operation: {
          state: "failed",
          error: { code: "UNIT_ID_MISMATCH" },
        },
      },
    });
    expect(
      application.database.connection
        .prepare("SELECT COUNT(*) AS count FROM resources")
        .get()
    ).toMatchObject({ count: 0 });
  });
});

describe("Univer unit store", () => {
  it("overrides client-owned identity without mutating initial data", () => {
    const types: readonly UnitType[] = [
      "sheet",
      "doc",
      "slide",
      "board",
      "base",
    ];
    for (const unitType of types) {
      const initialData = {
        id: `client-${unitType}`,
        rev: 72,
        name: `Imported ${unitType}`,
        marker: { preserved: true },
      };
      const before = structuredClone(initialData);
      const created = createUnitData({
        unitId: `server-${unitType}`,
        unitType,
        name: `Fallback ${unitType}`,
        initialData,
      });

      expect(created.data).toMatchObject({
        id: `server-${unitType}`,
        rev: 1,
        name: `Imported ${unitType}`,
        marker: { preserved: true },
      });
      expect(initialData).toEqual(before);
    }
  });

  it("creates blank collaboration units for every supported product type", async () => {
    const directory = mkdtempSync(join(tmpdir(), "univer-collaboration-"));
    temporaryDirectories.push(directory);
    const runtime = createCollaborationRuntime(
      join(directory, "collaboration.sqlite")
    );
    const types: readonly UnitType[] = [
      "sheet",
      "doc",
      "slide",
      "board",
      "base",
    ];

    try {
      for (const unitType of types) {
        const unitId = randomUUID();
        await runtime.unitStore.createUnit({
          unitId,
          unitType,
          name: `Blank ${unitType}`,
          userId: "test-user",
        });
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("creates imported Units under the server identity for every product type", async () => {
    const directory = mkdtempSync(join(tmpdir(), "univer-imported-units-"));
    temporaryDirectories.push(directory);
    const runtime = createCollaborationRuntime(
      join(directory, "collaboration.sqlite")
    );
    const types: readonly UnitType[] = [
      "sheet",
      "doc",
      "slide",
      "board",
      "base",
    ];

    try {
      for (const unitType of types) {
        const clientUnitId = randomUUID();
        const serverUnitId = randomUUID();
        const initial = blankUnitData({
          unitId: clientUnitId,
          unitType,
          name: `Imported ${unitType}`,
        });
        const created = await runtime.unitStore.createUnit({
          unitId: serverUnitId,
          unitType,
          name: `Target ${unitType}`,
          userId: "test-user",
          initialData: initial.data as unknown as Readonly<
            Record<string, unknown>
          >,
        });
        const loaded = await runtime.service.getUnit(
          {
            unitID: serverUnitId,
            type: initial.type,
            revision: 0,
          },
          collaborationCallOptions("test-user")
        );

        expect(created).toEqual({
          unitId: serverUnitId,
          headRevision: 1,
        });
        expect(loaded.snapshot).toMatchObject({
          unitID: serverUnitId,
          type: initial.type,
          rev: 1,
        });
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("creates imported Worktree Units under the server identity", async () => {
    const directory = mkdtempSync(join(tmpdir(), "univer-worktree-units-"));
    temporaryDirectories.push(directory);
    const runtime = createCollaborationRuntime(
      join(directory, "collaboration.sqlite")
    );
    const backend = createWorktreeBackend(runtime.worktreeService);
    const worktreeId = randomUUID();
    const types: readonly UnitType[] = [
      "sheet",
      "doc",
      "slide",
      "board",
      "base",
    ];

    try {
      await backend.createWorktree(worktreeId, "test-user");
      for (const unitType of types) {
        const clientUnitId = randomUUID();
        const serverUnitId = randomUUID();
        const initial = blankUnitData({
          unitId: clientUnitId,
          unitType,
          name: `Imported ${unitType}`,
        });
        const worktree = await backend.createUnit(
          {
            worktreeId,
            unitId: serverUnitId,
            unitType,
            name: `Target ${unitType}`,
            initialData: initial.data as unknown as Readonly<
              Record<string, unknown>
            >,
          },
          "test-user"
        );
        expect(worktree.units).toContainEqual(
          expect.objectContaining({
            unitID: serverUnitId,
            type: initial.type,
            source: "worktree",
            draftHeadRevision: 1,
          })
        );
      }
    } finally {
      await runtime.dispose();
    }
  });
});

function createTestApplication(
  onCreateUnit: (
    input: Parameters<UnitStore["createUnit"]>[0]
  ) => Promise<void>
): WorkspaceApplication {
  const application = createWorkspaceApplication(
    testConfig(),
    {
      unitStore: {
        async createUnit(input) {
          await onCreateUnit(input);
          return { unitId: input.unitId, headRevision: 1 };
        },
      },
    }
  );
  applications.push(application);
  return application;
}

function testConfig() {
  return {
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    sessionTtlMs: 60_000,
  } as const;
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
