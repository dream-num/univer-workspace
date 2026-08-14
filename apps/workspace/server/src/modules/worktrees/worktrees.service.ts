import { randomUUID } from "node:crypto";
import { UniverType, type IChangeset } from "@univerjs/protocol";
import { ApplicationError } from "../../middleware/errors.js";
import type {
  AccessResolver,
  ResourceAccess,
  UniverResourceAccess,
  UnitType,
} from "../access/index.js";
import {
  WorktreesRepository,
  type WorktreeCursor,
  type WorktreeOperationDatabaseKind,
  type WorktreeOperationRow,
  type WorktreeRow,
  type WorktreeUnitRow,
} from "./worktrees.repository.js";
import type {
  ActivationState,
  WorktreeBackend,
  WorktreeCapabilities,
  WorktreeDetail,
  WorktreeOperationKind,
  WorktreeOperationView,
  WorktreesModule,
  WorktreeState,
  WorktreeSummary,
  WorktreeUnit,
  WorktreeVisibility,
} from "./worktrees.types.js";

interface WorktreeContext {
  readonly row: WorktreeRow;
  readonly state: WorktreeState;
  readonly units: readonly WorktreeUnit[];
  readonly capabilities: WorktreeCapabilities;
  readonly canSeeUnits: boolean;
}

export function createWorktreesModule(options: {
  readonly repository: WorktreesRepository;
  readonly access: AccessResolver;
  readonly backend: WorktreeBackend;
  readonly publishMergedAssets: (
    worktreeId: string,
    unitIds: readonly string[]
  ) => void;
  readonly now?: () => number;
}): WorktreesModule {
  const now = options.now ?? Date.now;

  async function executeReserved<T>(
    operationId: string,
    action: () => Promise<T>
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      options.repository.failOperation(
        operationId,
        operationFailure(error),
        now()
      );
      throw error;
    }
  }

  async function context(
    userId: string,
    worktreeId: string
  ): Promise<WorktreeContext> {
    const row = options.repository.get(worktreeId, userId);
    if (!row || !isDiscoverable(userId, row)) throw notFound();
    const data = await backendCall(() =>
      options.backend.getWorktree(worktreeId, userId)
    );
    const unitRows = options.repository.units(worktreeId);
    const units = mapUnits(unitRows, data.units);
    const access = worktreeCapabilities(
      userId,
      row,
      data.status,
      unitRows,
      options.access
    );
    return {
      row,
      state: data.status,
      units,
      capabilities: access.capabilities,
      canSeeUnits: access.canSeeUnits,
    };
  }

  return {
    async list(userId, query) {
      const limit = validLimit(query.limit);
      const scope = validScope(query.scope);
      const kind = validOptionalKind(query.kind);
      const teamSpaceId = validOptionalId(
        query.teamSpaceId,
        "teamSpaceId"
      );
      const rows = options.repository.listCandidates({
        userId,
        scope,
        kind,
        teamSpaceId,
        cursor: decodeCursor(query.cursor),
        limit: limit + 1,
      });
      const visible: Array<{
        readonly row: WorktreeRow;
        readonly summary: WorktreeSummary;
      }> = [];
      for (const row of rows) {
        if (!isDiscoverable(userId, row)) continue;
        const data = await backendCall(() =>
          options.backend.getWorktree(row.id, userId)
        );
        const unitRows = options.repository.units(row.id);
        const access = worktreeCapabilities(
          userId,
          row,
          data.status,
          unitRows,
          options.access
        );
        visible.push({
          row,
          summary: summaryView(row, data.status, access.capabilities),
        });
      }
      const hasNext = visible.length > limit;
      const page = hasNext ? visible.slice(0, limit) : visible;
      const last = page.at(-1);
      return {
        items: page.map((item) => item.summary),
        nextCursor:
          hasNext && last
            ? encodeCursor({
                updatedAt: last.row.updated_at,
                id: last.row.id,
              })
            : null,
      };
    },

    async create(userId, operationIdValue, inputValue) {
      const operationId = validOperationId(operationIdValue);
      const input = validCreate(inputValue);
      if (input.kind === "team") {
        if (!input.teamSpaceId) {
          throw invalidInput("teamSpaceId is required.", "teamSpaceId");
        }
        const space = options.access.resolveSpace(
          userId,
          input.teamSpaceId
        );
        if (!space || space.type !== "team") throw notFound();
        if (!space.capabilities.createAtRoot) throw forbidden();
      }
      const payload = {
        ...input,
        worktreeId: randomUUID(),
      };
      const reserved = options.repository.reserveOperation({
        id: operationId,
        kind: "create_worktree",
        actorUserId: userId,
        payload,
        createdAt: now(),
      });
      const stable = operationPayload<{
        readonly kind: "user" | "team";
        readonly name: string;
        readonly summary: string | null;
        readonly visibility: WorktreeVisibility;
        readonly teamSpaceId: string | null;
        readonly worktreeId: string;
      }>(reserved.row, "create_worktree", userId);
      assertSameCreate(input, stable);
      if (reserved.row.state !== "completed") {
        await executeReserved(operationId, async () => {
          await backendCall(() =>
            options.backend.createWorktree(stable.worktreeId, userId)
          );
          options.repository.create({
            id: stable.worktreeId,
            name: stable.name,
            summary: stable.summary,
            creatorUserId: userId,
            kind: stable.kind,
            teamSpaceId: stable.teamSpaceId,
            visibility: stable.visibility,
            createdAt: now(),
          });
          options.repository.completeOperation(
            operationId,
            { worktreeId: stable.worktreeId },
            now()
          );
        });
      }
      const created = await context(userId, stable.worktreeId);
      return {
        status: 201,
        body: summaryView(
          created.row,
          created.state,
          created.capabilities
        ),
      };
    },

    async get(userId, worktreeId) {
      const value = await context(userId, worktreeId);
      return { worktree: detailView(value) };
    },

    async update(userId, worktreeId, inputValue) {
      const value = await context(userId, worktreeId);
      if (!canManageSummary(userId, value.row)) throw forbidden();
      const patch = validPatch(inputValue);
      if (
        patch.visibility !== undefined &&
        value.row.kind !== "team"
      ) {
        throw invalidInput(
          "User Worktree visibility is always private.",
          "visibility"
        );
      }
      options.repository.update({
        id: worktreeId,
        name: patch.name ?? value.row.name,
        summary:
          patch.summary === undefined
            ? value.row.summary
            : patch.summary,
        visibility: patch.visibility ?? value.row.visibility,
        updatedAt: now(),
      });
      return {
        worktree: detailView(await context(userId, worktreeId)),
      };
    },

    async addUnit(
      userId,
      worktreeId,
      operationIdValue,
      inputValue
    ) {
      const operationId = validOperationId(operationIdValue);
      const input = validAddUnit(inputValue);
      const value = await context(userId, worktreeId);
      if (!value.capabilities.addUnit) throw forbidden();
      if (input.source === "trunk") {
        const resource = requireEditableResource(
          userId,
          input.resourceId,
          options.access
        );
        assertTeamResource(value.row, resource);
        const resourceUnit = options.repository.resourceUnit(resource.id);
        if (!resourceUnit) throw notFound();
        const unitId = resourceUnit.unitId;
        const payload = {
          source: input.source,
          resourceId: input.resourceId,
          unitId,
          worktreeId,
        };
        const reserved = options.repository.reserveOperation({
          id: operationId,
          kind: "add_worktree_unit",
          actorUserId: userId,
          payload,
          createdAt: now(),
        });
        const stable = operationPayload<typeof payload>(
          reserved.row,
          "add_worktree_unit",
          userId
        );
        assertJsonIntent(input, {
          source: stable.source,
          resourceId: stable.resourceId,
        });
        if (reserved.row.state !== "completed") {
          await executeReserved(operationId, async () => {
            await backendCall(() =>
              options.backend.addUnit(
                worktreeId,
                stable.unitId,
                userId
              )
            );
            options.repository.addTrunkUnit({
              worktreeId,
              unitId: stable.unitId,
              resourceId: stable.resourceId,
              addedAt: now(),
            });
            options.repository.completeOperation(
              operationId,
              { worktreeId, unitId: stable.unitId },
              now()
            );
          });
        }
        return {
          status: 201,
          body: {
            unit: requireMappedUnit(
              await context(userId, worktreeId),
              stable.unitId
            ),
          },
        };
      }

      validateTarget(
        userId,
        value.row,
        input.targetSpaceId,
        input.targetParentNodeId,
        options.access
      );
      const payload = {
        ...input,
        worktreeId,
        unitId: randomUUID(),
        resourceId: randomUUID(),
        nodeId: randomUUID(),
      };
      const reserved = options.repository.reserveOperation({
        id: operationId,
        kind: "create_worktree_unit",
        actorUserId: userId,
        payload,
        createdAt: now(),
      });
      const stable = operationPayload<typeof payload>(
        reserved.row,
        "create_worktree_unit",
        userId
      );
      assertJsonIntent(input, {
        source: stable.source,
        name: stable.name,
        unitType: stable.unitType,
        targetSpaceId: stable.targetSpaceId,
        targetParentNodeId: stable.targetParentNodeId,
        ...(stable.initialData === undefined
          ? {}
          : { initialData: stable.initialData }),
      });
      if (reserved.row.state !== "completed") {
        await executeReserved(operationId, async () => {
          const created = await backendCall(() =>
            options.backend.createUnit(
              {
                worktreeId,
                unitId: stable.unitId,
                unitType: stable.unitType,
                name: stable.name,
                ...(stable.initialData === undefined
                  ? {}
                  : { initialData: stable.initialData }),
              },
              userId
            )
          );
          const createdUnit = created.units.find(
            (unit) => unit.unitID === stable.unitId
          );
          if (
            !createdUnit ||
            createdUnit.type !== protocolUnitType(stable.unitType)
          ) {
            throw conflict(
              "Collaboration Worktree Unit identity did not match the reserved Unit."
            );
          }
          options.repository.addLocalUnit({
            worktreeId,
            unitId: stable.unitId,
            resourceId: stable.resourceId,
            nodeId: stable.nodeId,
            targetSpaceId: stable.targetSpaceId,
            targetParentNodeId: stable.targetParentNodeId,
            name: stable.name,
            unitType: stable.unitType,
            createdBy: userId,
            createdAt: now(),
          });
          options.repository.completeOperation(
            operationId,
            { worktreeId, unitId: stable.unitId },
            now()
          );
        });
      }
      return {
        status: 201,
        body: {
          unit: requireMappedUnit(
            await context(userId, worktreeId),
            stable.unitId
          ),
        },
      };
    },

    async openUnit(userId, worktreeId, unitId, inputValue) {
      const mode = validOpenMode(inputValue);
      const value = await context(userId, worktreeId);
      const unit = requireMappedUnit(value, unitId);
      if (mode === "trunk") {
        const resource = options.access.resolveResource(
          userId,
          unit.resourceId
        );
        if (
          !resource ||
          !resource.capabilities.openContent
        ) {
          throw notFound();
        }
        return {
          unit: {
            unitId,
            unitType: unit.unitType,
            editorMode: resource.capabilities.editContent
              ? "edit"
              : "readOnly",
          },
          collaborationScope: { kind: "trunk" },
        };
      }
      if (!value.capabilities.review) throw notFound();
      if (mode === "mergePreview" && value.state !== "ready") {
        throw conflict("Merge Preview is available only while ready.");
      }
      return {
        unit: {
          unitId,
          unitType: unit.unitType,
          editorMode:
            mode === "draft" && value.capabilities.editDraft
              ? "edit"
              : "readOnly",
        },
        collaborationScope: {
          kind: mode === "draft" ? "worktree" : "mergePreview",
          worktreeId,
        },
      };
    },

    async submitChangeset(
      userId,
      worktreeId,
      unitId,
      inputValue
    ) {
      const value = await context(userId, worktreeId);
      if (!value.capabilities.editDraft) throw forbidden();
      const unit = requireMappedUnit(value, unitId);
      const changeset = validChangeset(
        inputValue,
        unitId,
        unit.unitType
      );
      return await backendCall(() =>
        options.backend.submitChangeset(
          worktreeId,
          changeset,
          userId
        )
      );
    },

    async markReady(userId, worktreeId) {
      const value = await context(userId, worktreeId);
      if (!value.capabilities.markReady) throw forbidden();
      const data = await backendCall(() =>
        options.backend.markReady(worktreeId, userId)
      );
      const updated = await contextFromData(userId, value.row, data);
      return {
        worktree: summaryView(
          updated.row,
          updated.state,
          updated.capabilities
        ),
      };
    },

    async reopen(userId, worktreeId) {
      const value = await context(userId, worktreeId);
      if (!value.capabilities.reopen) throw forbidden();
      const data = await backendCall(() =>
        options.backend.reopen(worktreeId, userId)
      );
      const updated = await contextFromData(userId, value.row, data);
      return {
        worktree: summaryView(
          updated.row,
          updated.state,
          updated.capabilities
        ),
      };
    },

    async merge(userId, worktreeId, operationIdValue) {
      const operationId = validOperationId(operationIdValue);
      const value = await context(userId, worktreeId);
      if (!value.capabilities.merge) throw forbidden();
      validateAllTargets(userId, value.row, options);
      const payload = { worktreeId };
      const reserved = options.repository.reserveOperation({
        id: operationId,
        kind: "merge_worktree",
        actorUserId: userId,
        payload,
        createdAt: now(),
      });
      const stable = operationPayload<typeof payload>(
        reserved.row,
        "merge_worktree",
        userId
      );
      if (stable.worktreeId !== worktreeId) throw idempotencyConflict();
      let operation = reserved.row;
      if (operation.state !== "completed") {
        operation = await executeReserved(operationId, async () => {
          const data = await backendCall(() =>
            options.backend.merge(worktreeId, userId)
          );
          const mergedUnitIds = activateSuccessfulUnits(
            value.row,
            options.repository.units(worktreeId),
            data.units,
            options.repository,
            now()
          );
          options.publishMergedAssets(worktreeId, mergedUnitIds);
          if (data.status === "merged") {
            options.repository.markProcessed(worktreeId, now());
          }
          return options.repository.completeOperation(
            operationId,
            { worktreeId, state: data.status },
            now()
          );
        });
      }
      const current = await context(userId, worktreeId);
      return {
        operation: operationView(operation),
        worktree: summaryView(
          current.row,
          current.state,
          current.capabilities
        ),
      };
    },

    async discard(userId, worktreeId, operationIdValue) {
      const operationId = validOperationId(operationIdValue);
      const value = await context(userId, worktreeId);
      if (!value.capabilities.discard) throw forbidden();
      const payload = { worktreeId };
      const reserved = options.repository.reserveOperation({
        id: operationId,
        kind: "discard_worktree",
        actorUserId: userId,
        payload,
        createdAt: now(),
      });
      const stable = operationPayload<typeof payload>(
        reserved.row,
        "discard_worktree",
        userId
      );
      if (stable.worktreeId !== worktreeId) throw idempotencyConflict();
      let operation = reserved.row;
      if (operation.state !== "completed") {
        operation = await executeReserved(operationId, async () => {
          const data = await backendCall(() =>
            options.backend.discard(worktreeId, userId)
          );
          options.repository.markLocalUnitsDiscarded(worktreeId, now());
          options.repository.markProcessed(worktreeId, now());
          return options.repository.completeOperation(
            operationId,
            { worktreeId, state: data.status },
            now()
          );
        });
      }
      const current = await context(userId, worktreeId);
      return {
        operation: operationView(operation),
        worktree: summaryView(
          current.row,
          current.state,
          current.capabilities
        ),
      };
    },

    async authorizeProtocol(input) {
      try {
        const value = await context(input.userId, input.worktreeId);
        if (input.unitId) {
          requireMappedUnit(value, input.unitId);
        }
        return input.write
          ? value.capabilities.editDraft
          : value.capabilities.review;
      } catch {
        return false;
      }
    },
  };

  async function contextFromData(
    userId: string,
    row: WorktreeRow,
    data: Awaited<ReturnType<WorktreeBackend["getWorktree"]>>
  ): Promise<WorktreeContext> {
    const unitRows = options.repository.units(row.id);
    const access = worktreeCapabilities(
      userId,
      row,
      data.status,
      unitRows,
      options.access
    );
    return {
      row: options.repository.get(row.id, userId) ?? row,
      state: data.status,
      units: mapUnits(unitRows, data.units),
      capabilities: access.capabilities,
      canSeeUnits: access.canSeeUnits,
    };
  }
}

function worktreeCapabilities(
  userId: string,
  row: WorktreeRow,
  state: WorktreeState,
  units: readonly WorktreeUnitRow[],
  access: AccessResolver
): {
  readonly capabilities: WorktreeCapabilities;
  readonly canSeeUnits: boolean;
} {
  const creator = row.creator_user_id === userId;
  const teamRole =
    row.team_owner_user_id === userId
      ? "owner"
      : row.actor_member_role;
  const visibleReview =
    creator ||
    (row.kind === "team" &&
      row.visibility === "space" &&
      teamRole !== null);
  const unitRead = units.every((unit) =>
    canReadUnit(userId, row, unit, access)
  );
  const unitEdit = units.every((unit) =>
    canEditUnit(userId, row, unit, access)
  );
  const review = visibleReview && unitRead;
  const creatorCanEdit =
    creator &&
    (row.kind === "user" ||
      teamRole === "owner" ||
      teamRole === "admin" ||
      teamRole === "editor") &&
    unitEdit;
  const admin =
    row.kind === "team" &&
    (teamRole === "owner" || teamRole === "admin");
  return {
    canSeeUnits: review,
    capabilities: {
      review,
      editDraft: state === "draft" && creatorCanEdit,
      addUnit: state === "draft" && creatorCanEdit,
      changeVisibility: row.kind === "team" && (creator || admin),
      markReady: state === "draft" && creatorCanEdit,
      reopen:
        state === "ready" &&
        (row.kind === "user" ? creator : creator || admin),
      merge:
        state === "ready" &&
        unitEdit &&
        (row.kind === "user"
          ? creator
          : teamRole === "owner" ||
            teamRole === "admin" ||
            teamRole === "editor"),
      discard:
        (state === "draft" || state === "ready") &&
        (row.kind === "user" ? creator : creator || admin),
    },
  };
}

function canReadUnit(
  userId: string,
  row: WorktreeRow,
  unit: WorktreeUnitRow,
  access: AccessResolver
): boolean {
  if (unit.source === "trunk" || unit.activated_at !== null) {
    return Boolean(
      access.resolveResource(userId, unit.resource_id)?.capabilities
        .openContent
    );
  }
  if (row.kind === "user") return row.creator_user_id === userId;
  return Boolean(
    unit.target_space_id &&
      access.resolveSpace(userId, unit.target_space_id)?.capabilities
        .browseRoot
  );
}

function canEditUnit(
  userId: string,
  row: WorktreeRow,
  unit: WorktreeUnitRow,
  access: AccessResolver
): boolean {
  if (unit.source === "trunk" || unit.activated_at !== null) {
    return Boolean(
      access.resolveResource(userId, unit.resource_id)?.capabilities
        .editContent
    );
  }
  if (!unit.target_space_id) return false;
  try {
    validateTarget(
      userId,
      row,
      unit.target_space_id,
      unit.target_parent_node_id,
      access
    );
    return true;
  } catch {
    return false;
  }
}

function validateAllTargets(
  userId: string,
  row: WorktreeRow,
  options: {
    readonly repository: WorktreesRepository;
    readonly access: AccessResolver;
  }
): void {
  for (const unit of options.repository.units(row.id)) {
    if (!canEditUnit(userId, row, unit, options.access)) {
      throw forbidden();
    }
  }
}

function validateTarget(
  userId: string,
  worktree: WorktreeRow,
  spaceId: string,
  parentNodeId: string | null,
  access: AccessResolver
): void {
  if (
    worktree.kind === "team" &&
    worktree.team_space_id !== spaceId
  ) {
    throw invalidInput(
      "Team Worktree content must target its Team Space.",
      "targetSpaceId"
    );
  }
  if (parentNodeId === null) {
    const space = access.resolveSpace(userId, spaceId);
    if (!space) throw notFound();
    if (!space.capabilities.createAtRoot) throw forbidden();
    return;
  }
  const parent = access.resolveNode(userId, parentNodeId);
  if (!parent || parent.spaceId !== spaceId) {
    throw notFound();
  }
  if (!parent.capabilities.createChildren) throw forbidden();
}

function isDiscoverable(userId: string, row: WorktreeRow): boolean {
  if (row.creator_user_id === userId) return true;
  if (row.kind === "user") return false;
  const teamRole =
    row.team_owner_user_id === userId
      ? "owner"
      : row.actor_member_role;
  if (teamRole === null) return false;
  if (row.visibility === "space") return true;
  return teamRole === "owner" || teamRole === "admin";
}

function canManageSummary(userId: string, row: WorktreeRow): boolean {
  if (row.creator_user_id === userId) return true;
  return (
    row.kind === "team" &&
    (row.team_owner_user_id === userId ||
      row.actor_member_role === "admin")
  );
}

function mapUnits(
  rows: readonly WorktreeUnitRow[],
  states: readonly {
    readonly unitID: string;
    readonly baselineTrunkRevision?: number;
    readonly draftHeadRevision: number;
    readonly mergeResult?: { readonly status: string };
  }[]
): WorktreeUnit[] {
  const byId = new Map(states.map((state) => [state.unitID, state]));
  return rows.map((row) => {
    const state = byId.get(row.unit_id);
    const mergeResult =
      state?.mergeResult?.status === "merged" ||
      state?.mergeResult?.status === "unchanged" ||
      state?.mergeResult?.status === "conflict" ||
      state?.mergeResult?.status === "failed"
        ? state.mergeResult.status
        : "pending";
    return {
      unitId: row.unit_id,
      resourceId: row.resource_id,
      nodeId: row.node_id,
      source: row.source,
      name: row.existing_name ?? row.new_name ?? "Removed resource",
      unitType: requireUnitType(
        row.existing_unit_type ?? row.new_unit_type
      ),
      target:
        row.source === "worktree" && row.target_space_id
          ? {
              spaceId: row.target_space_id,
              parentNodeId: row.target_parent_node_id,
            }
          : null,
      draftHeadRevision: state?.draftHeadRevision ?? 0,
      change:
        row.source === "worktree"
          ? "added"
          : state?.baselineTrunkRevision !== undefined &&
              state.draftHeadRevision >
                state.baselineTrunkRevision
            ? "modified"
            : "unchanged",
      mergeResult,
      activationState: activationState(row, mergeResult),
    };
  });
}

function activationState(
  row: WorktreeUnitRow,
  mergeResult: WorktreeUnit["mergeResult"]
): ActivationState {
  if (row.source === "trunk") return "notApplicable";
  if (row.activated_at !== null) return "completed";
  if (row.discarded_at !== null) return "discarded";
  if (mergeResult === "merged" || mergeResult === "unchanged") {
    return "pending";
  }
  if (mergeResult === "failed") return "failed";
  return "waitingForMerge";
}

function activateSuccessfulUnits(
  worktree: WorktreeRow,
  rows: readonly WorktreeUnitRow[],
  states: readonly {
    readonly unitID: string;
    readonly mergeResult?: { readonly status: string };
  }[],
  repository: WorktreesRepository,
  activatedAt: number
): string[] {
  const byId = new Map(states.map((state) => [state.unitID, state]));
  const successful: string[] = [];
  for (const row of rows) {
    const status = byId.get(row.unit_id)?.mergeResult?.status;
    if (status === "merged" || status === "unchanged") {
      successful.push(row.unit_id);
    }
    if (
      row.source === "worktree" &&
      row.activated_at === null &&
      (status === "merged" || status === "unchanged")
    ) {
      repository.activateLocalUnit(
        row,
        worktree.creator_user_id,
        activatedAt
      );
    }
  }
  return successful;
}

function summaryView(
  row: WorktreeRow,
  state: WorktreeState,
  capabilities: WorktreeCapabilities
): WorktreeSummary {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    kind: row.kind,
    teamSpace:
      row.kind === "team" &&
      row.team_space_id &&
      row.team_space_name
        ? {
            id: row.team_space_id,
            type: "team",
            name: row.team_space_name,
          }
        : null,
    visibility: row.visibility,
    state,
    creator: {
      id: row.creator_user_id,
      username: row.creator_username,
      displayName: row.creator_display_name,
      avatarUrl: row.creator_avatar_url,
    },
    unitCount: row.unit_count,
    processedAt:
      row.processed_at === null
        ? null
        : new Date(row.processed_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    capabilities,
  };
}

function detailView(value: WorktreeContext): WorktreeDetail {
  return {
    ...summaryView(value.row, value.state, value.capabilities),
    units: value.canSeeUnits ? value.units : [],
  };
}

function requireMappedUnit(
  value: WorktreeContext,
  unitId: string
): WorktreeUnit {
  const unit = value.units.find((candidate) => candidate.unitId === unitId);
  if (!unit) throw notFound();
  return unit;
}

function requireEditableResource(
  userId: string,
  resourceId: string,
  access: AccessResolver
): UniverResourceAccess {
  const resource = access.resolveResource(userId, resourceId);
  if (!resource || resource.kind !== "univer") throw notFound();
  if (!resource.capabilities.editContent) throw forbidden();
  return resource;
}

function assertTeamResource(
  worktree: WorktreeRow,
  resource: ResourceAccess
): void {
  if (
    worktree.kind === "team" &&
    worktree.team_space_id !== resource.node.spaceId
  ) {
    throw invalidInput(
      "A Team Worktree can contain only Resources from its Team Space.",
      "resourceId"
    );
  }
}

function validCreate(value: unknown): {
  readonly kind: "user" | "team";
  readonly name: string;
  readonly summary: string | null;
  readonly visibility: WorktreeVisibility;
  readonly teamSpaceId: string | null;
} {
  const record = requiredRecord(value);
  const kind =
    record.kind === "user" || record.kind === "team"
      ? record.kind
      : undefined;
  if (!kind) throw invalidInput("kind is invalid.", "kind");
  return {
    kind,
    name: validName(record.name),
    summary: validSummary(record.summary),
    visibility:
      kind === "user"
        ? "private"
        : validVisibility(record.visibility),
    teamSpaceId:
      kind === "user"
        ? null
        : requiredId(record.teamSpaceId, "teamSpaceId"),
  };
}

function validPatch(value: unknown): {
  readonly name?: string;
  readonly summary?: string | null;
  readonly visibility?: WorktreeVisibility;
} {
  const record = requiredRecord(value);
  const patch: {
    name?: string;
    summary?: string | null;
    visibility?: WorktreeVisibility;
  } = {};
  if (Object.hasOwn(record, "name")) patch.name = validName(record.name);
  if (Object.hasOwn(record, "summary")) {
    patch.summary = validSummary(record.summary);
  }
  if (Object.hasOwn(record, "visibility")) {
    patch.visibility = validVisibility(record.visibility);
  }
  if (Object.keys(patch).length === 0) {
    throw invalidInput("At least one Worktree field is required.");
  }
  return patch;
}

function validAddUnit(value: unknown):
  | { readonly source: "trunk"; readonly resourceId: string }
  | {
      readonly source: "worktree";
      readonly name: string;
      readonly unitType: UnitType;
      readonly targetSpaceId: string;
      readonly targetParentNodeId: string | null;
      readonly initialData?: Readonly<Record<string, unknown>>;
    } {
  const record = requiredRecord(value);
  if (record.source === "trunk") {
    return {
      source: "trunk",
      resourceId: requiredId(record.resourceId, "resourceId"),
    };
  }
  if (record.source !== "worktree") {
    throw invalidInput("source is invalid.", "source");
  }
  const initialData =
    record.initialData === undefined
      ? undefined
      : requiredRecord(record.initialData);
  return {
    source: "worktree",
    name: validName(record.name),
    unitType: validUnitType(record.unitType),
    targetSpaceId: requiredId(
      record.targetSpaceId,
      "targetSpaceId"
    ),
    targetParentNodeId: nullableId(
      record.targetParentNodeId,
      "targetParentNodeId"
    ),
    ...(initialData === undefined ? {} : { initialData }),
  };
}

function validOpenMode(value: unknown): "draft" | "trunk" | "mergePreview" {
  const record = requiredRecord(value);
  if (
    record.mode !== "draft" &&
    record.mode !== "trunk" &&
    record.mode !== "mergePreview"
  ) {
    throw invalidInput("mode is invalid.", "mode");
  }
  return record.mode;
}

function validChangeset(
  value: unknown,
  unitId: string,
  unitType: UnitType
): IChangeset {
  const envelope = requiredRecord(value);
  const record = requiredRecord(envelope.changeset);
  if (record.unitID !== unitId) {
    throw invalidInput(
      "changeset.unitID must match the Unit path parameter.",
      "changeset.unitID"
    );
  }
  const type = protocolUnitType(unitType);
  if (record.type !== type) {
    throw invalidInput(
      "changeset.type must match the Worktree Unit type.",
      "changeset.type"
    );
  }
  const baseRev = positiveSafeInteger(
    record.baseRev,
    "changeset.baseRev"
  );
  const revision = positiveSafeInteger(
    record.revision,
    "changeset.revision"
  );
  if (revision !== baseRev + 1) {
    throw invalidInput(
      "changeset.revision must equal changeset.baseRev + 1.",
      "changeset.revision"
    );
  }
  if (typeof record.sid !== "string" || !record.sid) {
    throw invalidInput("changeset.sid is required.", "changeset.sid");
  }
  const reqId = positiveSafeInteger(
    record.reqId,
    "changeset.reqId"
  );
  if (!Array.isArray(record.mutations)) {
    throw invalidInput(
      "changeset.mutations must be an array.",
      "changeset.mutations"
    );
  }
  const mutations = record.mutations.map((mutation, index) => {
    const item = requiredRecord(mutation);
    if (typeof item.id !== "string" || !item.id) {
      throw invalidInput(
        `changeset.mutations[${index}].id is required.`,
        `changeset.mutations[${index}].id`
      );
    }
    if (typeof item.data !== "string") {
      throw invalidInput(
        `changeset.mutations[${index}].data must be a string.`,
        `changeset.mutations[${index}].data`
      );
    }
    return { id: item.id, data: item.data };
  });
  return {
    unitID: unitId,
    type,
    baseRev,
    revision,
    userID: "",
    memberID: "",
    sid: record.sid,
    reqId,
    mutations,
    ...optionalNonNegativeSafeInteger(
      record.mutationSize,
      "changeset.mutationSize"
    ),
    ...optionalString(
      record.additionalFields,
      "changeset.additionalFields"
    ),
    ...optionalNonNegativeSafeInteger(
      record.createTime,
      "changeset.createTime"
    ),
  };
}

function protocolUnitType(unitType: UnitType): UniverType {
  const types = {
    sheet: UniverType.UNIVER_SHEET,
    doc: UniverType.UNIVER_DOC,
    slide: UniverType.UNIVER_SLIDE,
    board: UniverType.UNIVER_BOARD,
    base: UniverType.UNIVER_BASE,
  } as const;
  return types[unitType];
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidInput(`${field} must be a positive integer.`, field);
  }
  return value as number;
}

function optionalNonNegativeSafeInteger(
  value: unknown,
  field: "changeset.mutationSize" | "changeset.createTime"
): { readonly mutationSize?: number; readonly createTime?: number } {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidInput(
      `${field} must be a non-negative integer.`,
      field
    );
  }
  return field === "changeset.mutationSize"
    ? { mutationSize: value as number }
    : { createTime: value as number };
}

function optionalString(
  value: unknown,
  field: "changeset.additionalFields"
): { readonly additionalFields?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string") {
    throw invalidInput(`${field} must be a string.`, field);
  }
  return { additionalFields: value };
}

function validScope(value: unknown): "active" | "processed" {
  if (value === undefined || value === "active") return "active";
  if (value === "processed") return "processed";
  throw invalidInput("scope is invalid.", "scope");
}

function validOptionalKind(value: unknown): "user" | "team" | null {
  if (value === undefined) return null;
  if (value === "user" || value === "team") return value;
  throw invalidInput("kind is invalid.", "kind");
}

function validOptionalId(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  return requiredId(value, field);
}

function validName(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("name is required.", "name");
  }
  const name = value.trim();
  if (!name || name.length > 100) {
    throw invalidInput(
      "name must contain between 1 and 100 characters.",
      "name"
    );
  }
  return name;
}

function validSummary(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw invalidInput("summary must be a string or null.", "summary");
  }
  const summary = value.trim();
  if (summary.length > 1000) {
    throw invalidInput(
      "summary cannot exceed 1000 characters.",
      "summary"
    );
  }
  return summary || null;
}

function validVisibility(value: unknown): WorktreeVisibility {
  if (value !== "private" && value !== "space") {
    throw invalidInput("visibility is invalid.", "visibility");
  }
  return value;
}

function validUnitType(value: unknown): UnitType {
  if (
    value !== "sheet" &&
    value !== "doc" &&
    value !== "slide" &&
    value !== "board" &&
    value !== "base"
  ) {
    throw invalidInput("unitType is invalid.", "unitType");
  }
  return value;
}

function requireUnitType(value: UnitType | null): UnitType {
  if (!value) throw new Error("Worktree Unit has no Unit Type");
  return value;
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("A request body is required.");
  }
  return value as Record<string, unknown>;
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw invalidInput(`${field} is required.`, field);
  }
  return value;
}

function nullableId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredId(value, field);
}

function validLimit(value: unknown): number {
  if (value === undefined) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw invalidInput(
      "limit must be an integer between 1 and 200.",
      "limit"
    );
  }
  return limit;
}

function validOperationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 200 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw invalidInput(
      "Idempotency-Key must contain 16 to 200 URL-safe characters.",
      "Idempotency-Key"
    );
  }
  return value;
}

function decodeCursor(value: unknown): WorktreeCursor | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value) {
    throw invalidInput("cursor is invalid.", "cursor");
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<WorktreeCursor>;
    if (
      !Number.isSafeInteger(parsed.updatedAt) ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as WorktreeCursor;
  } catch {
    throw invalidInput("cursor is invalid.", "cursor");
  }
}

function encodeCursor(cursor: WorktreeCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function operationPayload<T>(
  row: WorktreeOperationRow,
  kind: WorktreeOperationDatabaseKind,
  actorUserId: string
): T {
  if (row.kind !== kind || row.actor_user_id !== actorUserId) {
    throw idempotencyConflict();
  }
  return JSON.parse(row.payload_json) as T;
}

function assertSameCreate(
  input: ReturnType<typeof validCreate>,
  stable: ReturnType<typeof validCreate> & {
    readonly worktreeId: string;
  }
): void {
  assertJsonIntent(input, {
    kind: stable.kind,
    name: stable.name,
    summary: stable.summary,
    visibility: stable.visibility,
    teamSpaceId: stable.teamSpaceId,
  });
}

function assertJsonIntent(
  actual: unknown,
  expected: unknown
): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw idempotencyConflict();
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key])}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function operationView(row: WorktreeOperationRow): WorktreeOperationView {
  return {
    id: row.id,
    kind: operationKind(row.kind),
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    result:
      row.result_json === null
        ? null
        : (JSON.parse(row.result_json) as Readonly<
            Record<string, unknown>
          >),
    error:
      row.last_error_code && row.last_error_message
        ? {
            code: row.last_error_code,
            message: row.last_error_message,
          }
        : null,
  };
}

function operationKind(
  kind: WorktreeOperationDatabaseKind
): WorktreeOperationKind {
  const mapping: Record<
    WorktreeOperationDatabaseKind,
    WorktreeOperationKind
  > = {
    create_worktree: "createWorktree",
    add_worktree_unit: "addWorktreeUnit",
    create_worktree_unit: "createWorktreeUnit",
    merge_worktree: "mergeWorktree",
    discard_worktree: "discardWorktree",
    activate_worktree_resource: "activateWorktreeResource",
  };
  return mapping[kind];
}

async function backendCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const candidate = error as {
      readonly code?: unknown;
      readonly message?: unknown;
    };
    const code =
      typeof candidate.code === "string"
        ? candidate.code
        : "COLLABORATION_ERROR";
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : "Collaboration Worktree operation failed.";
    if (
      code === "WORKTREE_NOT_FOUND" ||
      code === "WORKTREE_UNIT_NOT_FOUND"
    ) {
      throw notFound();
    }
    throw new ApplicationError("CONFLICT", 409, message);
  }
}

function operationFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof ApplicationError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "COLLABORATION_ERROR",
    message:
      error instanceof Error
        ? error.message
        : "Collaboration Worktree operation failed.",
  };
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}

function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "Worktree not found.");
}

function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "This Worktree action is not allowed."
  );
}

function conflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}

function idempotencyConflict(): ApplicationError {
  return conflict(
    "Idempotency-Key is already associated with another request."
  );
}
