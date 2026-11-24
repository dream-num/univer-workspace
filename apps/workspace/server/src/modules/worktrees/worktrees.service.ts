import { createHash, randomUUID } from "node:crypto";
import { UniverType, type IChangeset } from "@univerjs/protocol";
import { logger } from "../../logging/logger.js";
import type { PublishedPage } from "../html-view-drafts/drafts.types.js";
import { ApplicationError } from "../../middleware/errors.js";
import { writeSourceView, type WriteSource } from "../identity/index.js";
import type { TrashModule } from "../trash/index.js";
import {
  type AccessResolver,
  type ResourceAccess,
  type ResourceContentAccess,
  type UniverResourceAccess,
  type UnitType,
} from "../access/index.js";
import type {
  WorktreesRepository,
  WorktreeCursor,
  WorktreeOperationDatabaseKind,
  WorktreeOperationRow,
  WorktreeRow,
  WorktreeUnitRow,
} from "./worktrees.repository.js";
import type {
  ActivationState,
  WorktreeBackend,
  WorktreeCapabilities,
  WorktreeDetail,
  WorktreeOperationKind,
  WorktreeOperationView,
  WorktreeProductChange,
  WorktreesModule,
  WorktreeState,
  WorktreeSummary,
  WorktreeUnit,
  WorktreeUnitFreshness,
  WorktreeVisibility,
} from "./worktrees.types.js";
import { forbidden, mergeNeedsEditAccess, notFound, onlyAuthorMerges, pageReviewRequired, pagesChanged, proposalStaysShared } from "./worktrees.errors.js";

interface WorktreeContext {
  readonly row: WorktreeRow;
  readonly state: WorktreeState;
  readonly units: readonly WorktreeUnit[];
  readonly facts: WorktreeFacts;
  readonly capabilities: WorktreeCapabilities;
  readonly canSeeUnits: boolean;
}

/** What a Worktree decision reads: who the actor is to the author, their Team Space role, and their access to every Unit and pending page. */
interface WorktreeFacts {
  readonly state: WorktreeState;
  readonly team: boolean;
  readonly shared: boolean;
  readonly author: boolean;
  readonly authorOrClaimer: boolean;
  readonly role: "owner" | "admin" | "editor" | "viewer" | null;
  readonly proposes: boolean;
  readonly readsAll: boolean;
  readonly editsAll: boolean;
  readonly writesPages: boolean;
}

/** The pending HTML View drafts attached to a Worktree, which its merge publishes as the merger. */
export interface WorktreePages {
  /** IDs of the pending, unexpired drafts attached now, or last changed by `before`. A merge fixes this set when it begins. */
  pending(worktreeId: string, before?: number): Promise<readonly string[]>;
  /** Whether the user may write every pending page, or every one of `draftIds` still pending. */
  writable(worktreeId: string, userId: string, draftIds?: readonly string[]): Promise<boolean>;
  /** Names of the pending pages among `draftIds` whose own author may not write their target. */
  foreign(worktreeId: string, draftIds: readonly string[]): Promise<readonly string[]>;
  publish(worktreeId: string, mergerId: string, draftIds: readonly string[]): Promise<readonly PublishedPage[]>;
}

interface MergePayload {
  readonly worktreeId: string;
  readonly pageDraftIds?: readonly string[];
}

export function createWorktreesModule(options: {
  readonly repository: WorktreesRepository;
  readonly access: AccessResolver;
  readonly backend: WorktreeBackend;
  readonly trash: Pick<TrashModule, "trashNodeOnce">;
  readonly publishMergedAssets: (
    worktreeId: string,
    unitIds: readonly string[]
  ) => Promise<void>;
  readonly pages: WorktreePages;
  readonly publicOrigin: string | null;
  readonly onChanged?: (change: WorktreeProductChange) => void;
  readonly now?: () => number;
}): WorktreesModule {
  const now = options.now ?? Date.now;

  // Compatibility: a merge Operation reserved before merges stored their pages publishes the drafts pending when it
  // was created, as it would have then. Applies only to such Operations; remove once none is unfinished.
  async function legacyMergePages(worktreeId: string, createdAt: number): Promise<string[]> {
    return [...await options.pages.pending(worktreeId, createdAt)].sort();
  }

  async function executeReserved<T>(
    operationId: string,
    action: () => Promise<T>
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      await options.repository.failOperation(
        operationId,
        operationFailure(error),
        now()
      );
      throw error;
    }
  }

  /** Once a Worktree leaves draft and ready there is nothing left to redo, so its Units have no freshness. */
  function openTrunk(state: WorktreeState, userId: string): TrunkClock | null {
    return state === "draft" || state === "ready"
      ? { revision: (unitId) => options.backend.trunkRevision(unitId, userId), now: now() }
      : null;
  }

  async function context(userId: string, worktreeId: string): Promise<WorktreeContext> {
    const row = await options.repository.get(worktreeId, userId);
    // Ask the Collaboration Service only about a Worktree the actor would see if it were merged.
    if (!row || !isDiscoverable(row, true)) throw notFound();
    const data = await backendCall(() =>
      options.backend.getWorktree(worktreeId, userId)
    );
    if (!isDiscoverable(row, data.status === "merged")) throw notFound();
    const unitRows = await options.repository.units(worktreeId);
    const units = await mapUnits(unitRows, data.units, userId, options.access, openTrunk(data.status, userId));
    const access = await worktreeCapabilities(
      userId,
      row,
      data.status,
      unitRows,
      options.access,
      data.units,
      options.pages,
    );
    return {
      row,
      state: data.status,
      units,
      facts: access.facts,
      capabilities: access.capabilities,
      canSeeUnits: access.canSeeUnits,
    };
  }

  async function authorMerges(value: WorktreeContext): Promise<boolean> {
    const { row } = value;
    const author = await options.repository.get(row.id, row.creator_user_id);
    return author !== null && mayMerge((await worktreeCapabilities(
      row.creator_user_id,
      author,
      value.state,
      await options.repository.units(row.id),
      options.access,
      value.units.map((unit) => ({ unitID: unit.unitId, removed: unit.change === "deleted" })),
      options.pages,
    )).facts);
  }

  /** A ready Worktree that its author cannot merge is shared with the Space, where someone can. */
  async function shareUnlessAuthorMerges(value: WorktreeContext): Promise<void> {
    const { row } = value;
    if (row.kind !== "team" || row.visibility === "space" || await authorMerges(value)) return;
    await options.repository.update({ id: row.id, actorId: row.creator_user_id, visibility: "space", updatedAt: now() });
  }

  async function notifyChanged(
    kind: WorktreeProductChange["kind"],
    worktreeId: string,
    audienceUserIds?: readonly string[]
  ): Promise<void> {
    try {
      options.onChanged?.({ kind, worktreeId, audienceUserIds: audienceUserIds ?? await options.repository.audience(worktreeId) });
    } catch {
      // Realtime cache invalidation cannot change a completed product write.
    }
  }

  return {
    async setUnitRemoved(userId, worktreeId, unitId, inputValue) {
      const input = requiredRecord(inputValue);
      if (typeof input.removed !== "boolean") {
        throw invalidInput("removed must be a boolean.", "removed");
      }
      const removed = input.removed;
      const value = await context(userId, worktreeId);
      const unit = requireMappedUnit(value, unitId);
      // A new file whose target is gone stops its author editing, so cancelling it cannot wait for that.
      const cancelLocal =
        removed &&
        unit.source === "worktree" &&
        value.state === "draft" &&
        mayPropose({ ...value.facts, readsAll: true, editsAll: true });
      if (!value.capabilities.editDraft && !cancelLocal) throw forbidden();
      if (!removed && unit.source === "worktree" && unit.target) {
        await validateTarget(
          userId,
          value.row,
          unit.target.spaceId,
          unit.target.parentNodeId,
          options.access,
          "propose",
        );
      }
      if (removed && unit.source === "trunk") {
        const node = unit.nodeId === null ? null : await options.access.resolveNode(userId, unit.nodeId);
        if (!node?.capabilities.trash) throw forbidden();
      }
      const data = await backendCall(() =>
        options.backend.setUnitRemoved(worktreeId, unitId, removed, userId),
      );
      await notifyChanged("updated", worktreeId);
      return { worktree: detailView(await contextFromData(userId, value.row, data)) };
    },

    async activity(userId, scope, since) {
      const rows = await options.repository.listCandidates({
        userId, scope: "all", kind: scope.kind,
        teamSpaceId: scope.kind === "team" ? scope.teamSpaceId : null,
        ...(scope.kind === "user" ? { creatorUserId: scope.creatorUserId } : {}),
        search: "", order: "createdAtDesc", cursor: null, limit: MAX_ACTIVITY_ROWS + 1, touchedSince: since,
      });
      const candidates = rows.slice(0, MAX_ACTIVITY_ROWS).filter((row) => isDiscoverable(row, true));
      let complete = rows.length <= MAX_ACTIVITY_ROWS;
      const processed = candidates.filter((row) => row.processed_at !== null && row.processed_at >= since)
        .sort((a, b) => b.processed_at! - a.processed_at! || a.id.localeCompare(b.id));
      const merged = new Set<string>();
      // ponytail: MAX_MERGE_LOOKUPS bounds Collaboration calls per request; replace with product-side merged_at written by merge.
      if (processed.length > MAX_MERGE_LOOKUPS) complete = false;
      for (const row of processed.slice(0, MAX_MERGE_LOOKUPS)) {
        try {
          if ((await options.backend.getWorktree(row.id, userId)).status === "merged") merged.add(row.id);
        } catch {
          complete = false;
        }
      }
      const mergers = await options.repository.mergers([...merged]);
      return {
        items: candidates.filter((row) => isDiscoverable(row, merged.has(row.id))).map((row) => ({
          id: row.id, number: row.number, name: row.name,
          creator: {
            id: row.creator_user_id, username: row.creator_username,
            displayName: row.creator_display_name, avatarUrl: row.creator_avatar_url,
          },
          createdVia: row.created_via, createdAt: row.created_at,
          mergedAt: merged.has(row.id) ? row.processed_at : null,
          mergedBy: mergers.get(row.id) ?? null,
        })),
        complete,
      };
    },

    async list(userId, query) {
      const limit = validLimit(query.limit);
      const scope = validScope(query.scope);
      const kind = validOptionalKind(query.kind);
      const teamSpaceId = validOptionalId(
        query.teamSpaceId,
        "teamSpaceId"
      );
      const search = validSearch(query.search);
      const order = validOrder(query.order);
      const states = validStates(query.state);
      const queryKey = createHash("sha256")
        .update(
          JSON.stringify([
            userId,
            scope,
            kind,
            teamSpaceId,
            search,
            order,
            ...(states.length ? [states] : []),
          ])
        )
        .digest("hex");
      const cursor = decodeCursor(query.cursor);
      if (cursor && (cursor.queryKey !== undefined
        ? cursor.queryKey !== queryKey
        : search !== "" || order !== "updatedAtDesc" || scope === "all" || states.length > 0)) {
        throw invalidInput("cursor does not match this query.", "cursor");
      }
      const position = (row: WorktreeRow) => ({
        timestamp: order === "createdAtDesc" ? row.created_at : row.updated_at,
        id: row.id,
        queryKey,
      });
      const visible: Array<{
        readonly row: WorktreeRow;
        readonly summary: WorktreeSummary;
      }> = [];
      let scanFrom = cursor;
      let hasNext = false;
      let lastScanned: WorktreeRow | undefined;
      // State lives in the Collaboration Service, not the product database, so a state filter,
      // and a private Worktree only its merge shares, scan candidate batches until the page is full or exhausted.
      for (;;) {
        const rows = await options.repository.listCandidates({
          userId,
          scope,
          kind,
          teamSpaceId,
          search,
          order,
          cursor: scanFrom,
          limit: limit + 1,
        });
        const batch = rows.slice(0, limit);
        const loaded = [];
        for (const row of batch) {
          const data = await backendCall(() =>
            options.backend.getWorktree(row.id, userId)
          );
          if (!isDiscoverable(row, data.status === "merged")) continue;
          if (states.length && !states.includes(data.status)) continue;
          loaded.push({ row, data });
        }
        // Reuse each permission lookup while building this page, after loading SDK state.
        const pageAccess = cacheResourceContent(options.access, userId);
        for (const { row, data } of loaded) {
          const unitRows = await options.repository.units(row.id);
          const access = await worktreeCapabilities(
            userId,
            row,
            data.status,
            unitRows,
            pageAccess,
            data.units,
            options.pages,
          );
          visible.push({
            row,
            summary: summaryView(row, data.status, access.capabilities),
          });
        }
        lastScanned = batch.at(-1) ?? lastScanned;
        hasNext = rows.length > limit;
        if (!hasNext || visible.length >= limit) break;
        scanFrom = position(batch[batch.length - 1]!);
      }
      const page = visible.slice(0, limit);
      const last = page.at(-1);
      // A page cut short of the scanned rows resumes right after its last item.
      const resumeFrom = last?.row ?? lastScanned;
      return {
        items: page.map((item) => item.summary),
        hasCreatedWorktree: await options.repository.hasCreatedWorktree(userId),
        nextCursor:
          (hasNext || visible.length > limit) && resumeFrom
            ? encodeCursor(position(resumeFrom))
            : null,
      };
    },

    async create(userId, operationIdValue, inputValue, createdVia = null, forkId = null) {
      const operationId = validOperationId(operationIdValue);
      const input = validCreate(inputValue);
      if (input.kind === "team") {
        if (!input.teamSpaceId) {
          throw invalidInput("teamSpaceId is required.", "teamSpaceId");
        }
        const space = await options.access.resolveSpace(
          userId,
          input.teamSpaceId
        );
        if (!space || space.type !== "team") throw notFound();
        if (!space.capabilities.propose) throw forbidden();
      }
      const payload = {
        ...input,
        worktreeId: randomUUID(),
        createdVia,
        forkId,
      };
      const reserved = await options.repository.reserveOperation({
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
        readonly createdVia?: WriteSource | null;
        readonly forkId?: string | null;
      }>(reserved.row, "create_worktree", userId);
      assertSameCreate({ ...input, forkId }, stable);
      if (reserved.row.state !== "completed") {
        await executeReserved(operationId, async () => {
          await backendCall(() =>
            options.backend.createWorktree(stable.worktreeId, userId)
          );
          await options.repository.create({
            id: stable.worktreeId,
            name: stable.name,
            summary: stable.summary,
            creatorUserId: userId,
            kind: stable.kind,
            teamSpaceId: stable.teamSpaceId,
            visibility: stable.visibility,
            createdAt: now(),
            createdVia: stable.createdVia ?? null,
            forkId: stable.forkId ?? null,
          });
          await options.repository.completeOperation(
            operationId,
            { worktreeId: stable.worktreeId },
            now()
          );
        });
      }
      const created = await context(userId, stable.worktreeId);
      await notifyChanged("created", stable.worktreeId);
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

    async getByNumber(userId, spaceId, numberValue) {
      const number = validNumber(numberValue);
      // Team Worktree creators remain discoverable after losing Space membership.
      let worktreeId = await options.repository.findIdByNumber({ teamSpaceId: spaceId }, number);
      if (!worktreeId) {
        const space = await options.access.resolveSpace(userId, spaceId);
        // A Personal Space lists the User Worktrees of the User whose Space it is, to its owners.
        if (space?.type === "personal" && space.role === "owner") {
          worktreeId = await options.repository.findIdByNumber({ creatorUserId: space.ownerUserId }, number);
        }
      }
      if (!worktreeId) throw notFound();
      return { worktree: detailView(await context(userId, worktreeId)) };
    },

    async update(userId, worktreeId, inputValue) {
      const value = await context(userId, worktreeId);
      if (!canManageSummary(userId, value.row)) throw forbidden();
      const previousAudience = await options.repository.audience(worktreeId);
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
      if (
        patch.visibility === "private" &&
        value.row.visibility === "space" &&
        value.state === "ready" &&
        !(await authorMerges(value))
      ) {
        throw proposalStaysShared();
      }
      const applied = await options.repository.update({
        id: worktreeId,
        actorId: userId,
        ...patch,
        updatedAt: now(),
      });
      if (!applied) throw forbidden();
      const updated = {
        worktree: detailView(await context(userId, worktreeId)),
      };
      await notifyChanged(
        "updated",
        worktreeId,
        unionAudience(
          previousAudience,
          await options.repository.audience(worktreeId)
        )
      );
      return updated;
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
        const resource = await requireAddableResource(
          userId,
          value.row,
          input.resourceId,
          options.access
        );
        assertTeamResource(value.row, resource);
        const resourceUnit = await options.repository.resourceUnit(resource.id);
        if (!resourceUnit) throw notFound();
        const unitId = resourceUnit.unitId;
        const payload = {
          source: input.source,
          resourceId: input.resourceId,
          unitId,
          worktreeId,
        };
        const reserved = await options.repository.reserveOperation({
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
        if (stable.worktreeId !== worktreeId) throw idempotencyConflict();
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
            await options.repository.addTrunkUnit({
              worktreeId,
              unitId: stable.unitId,
              resourceId: stable.resourceId,
              addedAt: now(),
            });
            await options.repository.completeOperation(
              operationId,
              { worktreeId, unitId: stable.unitId },
              now()
            );
          });
        }
        const result = {
          status: 201,
          body: {
            unit: requireMappedUnit(
              await context(userId, worktreeId),
              stable.unitId
            ),
          },
        } as const;
        await notifyChanged("unitAdded", worktreeId);
        return result;
      }

      await validateTarget(
        userId,
        value.row,
        input.targetSpaceId,
        input.targetParentNodeId,
        options.access,
        "propose"
      );
      // A new file counts from the moment it is created in the pull request, not from its merge.
      const payload = {
        ...input,
        worktreeId,
        unitId: randomUUID(),
        resourceId: randomUUID(),
        nodeId: randomUUID(),
      };
      const reserved = await options.repository.reserveOperation({
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
      if (stable.worktreeId !== worktreeId) throw idempotencyConflict();
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
          await options.repository.completeLocalUnit({
            operationId,
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
        });
      }
      const result = {
        status: 201,
        body: {
          unit: requireMappedUnit(
            await context(userId, worktreeId),
            stable.unitId
          ),
        },
      } as const;
      await notifyChanged("unitAdded", worktreeId);
      return result;
    },

    async assertCanCreateUnit(userId, worktreeId, targetSpaceId, targetParentNodeId) {
      const value = await context(userId, worktreeId);
      if (!value.capabilities.addUnit) throw forbidden();
      await validateTarget(userId, value.row, targetSpaceId, targetParentNodeId, options.access);
    },

    async openUnit(userId, worktreeId, unitId, inputValue) {
      const mode = validOpenMode(inputValue);
      const value = await context(userId, worktreeId);
      const unit = requireMappedUnit(value, unitId);
      if (
        unit.source === "trunk" &&
        !(await options.access.resolveResource(userId, unit.resourceId))?.capabilities.openContent
      ) {
        throw notFound();
      }
      if (mode === "trunk") {
        const resource = await options.access.resolveResource(
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
            mode === "draft" && value.capabilities.editDraft && unit.change !== "deleted"
              ? "edit"
              : "readOnly",
        },
        collaborationScope: {
          kind: mode === "draft" ? "worktree" : "mergePreview",
          worktreeId,
        },
      };
    },

    async submitChangeset(userId, worktreeId, unitId, inputValue) {
      const value = await context(userId, worktreeId);
      if (!value.capabilities.editDraft) throw forbidden();
      const unit = requireMappedUnit(value, unitId);
      if (unit.change === "deleted") throw forbidden();
      const changeset = validChangeset(
        inputValue,
        unitId,
        unit.unitType
      );
      const result = await backendCall(() =>
        options.backend.submitChangeset(
          worktreeId,
          changeset,
          userId
        )
      );
      if (result.status === "committed") {
        await notifyChanged("contentChanged", worktreeId);
      }
      return result;
    },

    async markReady(userId, worktreeId) {
      const value = await context(userId, worktreeId);
      if (!value.capabilities.markReady) throw forbidden();
      // Shared before the transition, so a retry after a failed transition still leaves it shared.
      await shareUnlessAuthorMerges(value);
      const data = await backendCall(() =>
        options.backend.markReady(worktreeId, userId)
      );
      const updated = await contextFromData(userId, value.row, data);
      await notifyChanged("stateChanged", worktreeId);
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
      await notifyChanged("stateChanged", worktreeId);
      return {
        worktree: summaryView(
          updated.row,
          updated.state,
          updated.capabilities
        ),
      };
    },

    async merge(userId, worktreeId, operationIdValue, browser = false, inputValue) {
      const operationId = validOperationId(operationIdValue);
      const reviewed = validReviewedPages(inputValue);
      const value = await context(userId, worktreeId);
      const existing = await options.repository.getOperation(operationId);
      const stored = existing && operationPayload<MergePayload>(existing, "merge_worktree", userId);
      if (stored && stored.worktreeId !== worktreeId) throw idempotencyConflict();
      const resumeMerged = value.state === "merged";
      const unfinished = value.row.processed_at === null && (value.state === "merging" || resumeMerged);
      // A started merge is a decision already made, so its starter, or anyone who may merge, can finish it.
      const finishes = unfinished && (existing !== null || mayMerge({ ...value.facts, editsAll: true, writesPages: true }));
      // An applied merge keeps its recorded merger; only an Operation cut off before anyone was recorded completes.
      const recordsApplied = resumeMerged && !unfinished && existing !== null &&
        !(await options.repository.mergers([worktreeId])).has(worktreeId);
      if (!value.capabilities.merge && existing?.state !== "completed" && !finishes && !recordsApplied) {
        if (!value.facts.authorOrClaimer && !value.facts.shared) throw onlyAuthorMerges(value.row);
        if (value.state === "ready" || unfinished) throw mergeNeedsEditAccess();
        throw forbidden();
      }
      const pageDraftIds = existing && stored
        ? stored.pageDraftIds ?? await legacyMergePages(worktreeId, existing.created_at)
        : [...await options.pages.pending(worktreeId)].sort();
      if (existing?.state !== "completed" && value.row.processed_at === null) {
        await validateAllTargets(userId, value.row, value.units, options, pageDraftIds);
      }
      // Code its author could not publish alone goes live only through a person in the browser who reviewed these pages.
      const foreign = await options.pages.foreign(worktreeId, pageDraftIds);
      if (foreign.length && !(browser && (reviewed !== undefined || stored !== null))) {
        throw pageReviewRequired(value.row, foreign, options.publicOrigin);
      }
      if (reviewed !== undefined && canonicalJson(reviewed) !== canonicalJson(pageDraftIds)) {
        throw pagesChanged(value.row, options.publicOrigin);
      }
      const payload = { worktreeId, pageDraftIds };
      const reserved = await options.repository.reserveOperation({
        id: operationId,
        kind: "merge_worktree",
        actorUserId: userId,
        payload,
        createdAt: now(),
      });
      const stable = operationPayload<MergePayload>(
        reserved.row,
        "merge_worktree",
        userId
      );
      assertJsonIntent(payload, { worktreeId: stable.worktreeId, pageDraftIds: stable.pageDraftIds ?? pageDraftIds });
      let operation = reserved.row;
      if (operation.state !== "completed") {
        operation = await executeReserved(operationId, async () => {
          if (value.row.processed_at !== null && resumeMerged) {
            return options.repository.completeOperation(
              operationId,
              { worktreeId, state: "merged" },
              now(),
            );
          }
          const data = await backendCall(() =>
            resumeMerged
              ? options.backend.getWorktree(worktreeId, userId)
              : options.backend.merge(worktreeId, userId),
          );
          const mergedUnitIds = await activateSuccessfulUnits(
            userId,
            value.row,
            await options.repository.units(worktreeId),
            data.units,
            options.repository,
            now()
          );
          await options.publishMergedAssets(worktreeId, mergedUnitIds);
          if (data.status === "merged") {
            for (const unit of data.units) {
              if (unit.mergeResult?.status !== "removed") continue;
              const mapped = requireMappedUnit(value, unit.unitID);
              if (mapped.source === "worktree") {
                await options.repository.markLocalUnitDiscarded(worktreeId, unit.unitID, now());
              } else {
                if (mapped.nodeId === null) throw notFound();
                await options.trash.trashNodeOnce(
                  userId,
                  mapped.nodeId,
                  await options.repository.removalBatchId(worktreeId, unit.unitID),
                );
              }
            }
            await options.repository.markProcessed(worktreeId, now());
          }
          return options.repository.completeOperation(
            operationId,
            { worktreeId, state: data.status },
            now()
          );
        });
      }
      let current = await context(userId, worktreeId);
      let publishedPages: readonly PublishedPage[] = [];
      if (current.state === "merged") {
        try {
          publishedPages = await options.pages.publish(worktreeId, userId, pageDraftIds);
        } catch (error) {
          logger.warn({ err: error, worktreeId }, "HTML View drafts could not be published after merge");
        }
      }
      if (publishedPages.length) current = await context(userId, worktreeId);
      await notifyChanged("merged", worktreeId);
      return {
        publishedPages,
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
      const reserved = await options.repository.reserveOperation({
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
          await options.repository.markLocalUnitsDiscarded(worktreeId, now());
          await options.repository.markProcessed(worktreeId, now());
          return options.repository.completeOperation(
            operationId,
            { worktreeId, state: data.status },
            now()
          );
        });
      }
      const current = await context(userId, worktreeId);
      await notifyChanged("discarded", worktreeId);
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
          const unit = requireMappedUnit(value, input.unitId);
          if (input.write && unit.change === "deleted") return false;
          if (
            unit.source === "trunk" &&
            !(await options.access.resolveResource(input.userId, unit.resourceId))?.capabilities.openContent
          )
            return false;
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
    data: Awaited<ReturnType<WorktreeBackend["getWorktree"]>>,
  ): Promise<WorktreeContext> {
    const unitRows = await options.repository.units(row.id);
    const current = await options.repository.get(row.id, userId) ?? row;
    const access = await worktreeCapabilities(
      userId,
      current,
      data.status,
      unitRows,
      options.access,
      data.units,
      options.pages,
    );
    return {
      row: current,
      state: data.status,
      units: await mapUnits(unitRows, data.units, userId, options.access, openTrunk(data.status, userId)),
      facts: access.facts,
      capabilities: access.capabilities,
      canSeeUnits: access.canSeeUnits,
    };
  }
}

async function worktreeCapabilities(
  userId: string,
  row: WorktreeRow,
  state: WorktreeState,
  units: readonly WorktreeUnitRow[],
  access: AccessResolver,
  states: readonly { readonly unitID: string; readonly removed?: boolean }[],
  pages: WorktreePages,
): Promise<{
  readonly facts: WorktreeFacts;
  readonly capabilities: WorktreeCapabilities;
  readonly canSeeUnits: boolean;
}> {
  const removed = new Set(states.filter((unit) => unit.removed).map((unit) => unit.unitID));
  // Share resource lookups only within this capability calculation for one actor.
  const capabilityAccess = cacheResourceContent(access, userId);
  let readsAll = true;
  let editsAll = true;
  for (const unit of units) {
    const isRemoved = removed.has(unit.unit_id);
    if (readsAll && !isRemoved) readsAll = await canReadUnit(userId, row, unit, capabilityAccess);
    if (editsAll && !(unit.source === "worktree" && isRemoved)) {
      editsAll = await canEditUnit(userId, row, unit, capabilityAccess);
    }
    if (!readsAll && !editsAll) break;
  }
  const facts: WorktreeFacts = {
    state,
    team: row.kind === "team",
    shared: visibilityOf(row, state === "merged") === "space",
    author: row.creator_user_id === userId,
    // A claimer owns the agent's Space, so decides the agent's pull requests; only the author edits them.
    authorOrClaimer: Boolean(row.actor_owns_creator_space),
    role: row.actor_owns_team_space ? "owner" : row.actor_member_role,
    proposes: Boolean(row.actor_proposes),
    readsAll,
    editsAll,
    writesPages: row.pending_page_drafts === 0 || await pages.writable(row.id, userId),
  };
  const capabilities = Object.fromEntries(
    Object.entries(capabilityRules).map(([capability, allows]) => [capability, allows(facts)]),
  ) as unknown as WorktreeCapabilities;
  return { facts, capabilities, canSeeUnits: capabilities.review };
}

const administers = (facts: WorktreeFacts): boolean => facts.role === "owner" || facts.role === "admin";
const decides = (facts: WorktreeFacts): boolean => facts.authorOrClaimer || administers(facts);

/** Merging writes Trunk and publishes the pending pages, so whoever merges needs edit access to every Unit and page. */
function mayMerge(facts: WorktreeFacts): boolean {
  // editsAll is vacuously true for a Worktree with no Unit, so a Team merge also needs a role in the Space.
  return (
    facts.editsAll &&
    facts.writesPages &&
    (!facts.team || facts.role !== null) &&
    (facts.authorOrClaimer || (facts.shared && (administers(facts) || facts.role === "editor")))
  );
}

/**
 * Proposing writes only the draft. A Team Worktree takes a proposal from anyone who may propose in
 * its Space and can read its Units; a User Worktree is its author's own, limited to what the author can edit.
 */
function mayPropose(facts: WorktreeFacts): boolean {
  return facts.author && (facts.team ? facts.proposes && facts.readsAll : facts.editsAll);
}

const capabilityRules: { readonly [C in keyof WorktreeCapabilities]: (facts: WorktreeFacts) => boolean } = {
  review: (facts) => facts.readsAll && (facts.authorOrClaimer || (facts.shared && facts.role !== null)),
  editDraft: (facts) => facts.state === "draft" && mayPropose(facts),
  addUnit: (facts) => facts.state === "draft" && mayPropose(facts),
  changeVisibility: (facts) => facts.team && (facts.author || administers(facts)),
  markReady: (facts) => facts.state === "draft" && (mayMerge(facts) || mayPropose(facts)),
  reopen: (facts) => facts.state === "ready" && decides(facts),
  merge: (facts) => facts.state === "ready" && mayMerge(facts),
  discard: (facts) => (facts.state === "draft" || facts.state === "ready") && decides(facts),
};

async function canReadUnit(
  userId: string,
  row: WorktreeRow,
  unit: WorktreeUnitRow,
  access: AccessResolver
): Promise<boolean> {
  if (unit.source === "trunk" || unit.activated_at !== null) {
    return Boolean(
      (await access.resolveResourceContent(userId, unit.resource_id))?.capabilities
        .openContent
    );
  }
  if (row.kind === "user") return Boolean(row.actor_owns_creator_space);
  return Boolean(
    unit.target_space_id &&
      (await access.resolveSpace(userId, unit.target_space_id))?.capabilities
        .browseRoot
  );
}

async function canEditUnit(
  userId: string,
  row: WorktreeRow,
  unit: WorktreeUnitRow,
  access: AccessResolver
): Promise<boolean> {
  if (unit.source === "trunk" || unit.activated_at !== null) {
    return Boolean(
      (await access.resolveResourceContent(userId, unit.resource_id))?.capabilities
        .editContent
    );
  }
  if (!unit.target_space_id) return false;
  try {
    await validateTarget(
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

async function validateAllTargets(
  userId: string,
  row: WorktreeRow,
  states: readonly WorktreeUnit[],
  options: {
    readonly repository: WorktreesRepository;
    readonly access: AccessResolver;
    readonly pages: WorktreePages;
  },
  pageDraftIds: readonly string[],
): Promise<void> {
  for (const unit of await options.repository.units(row.id)) {
    if (states.find((state) => state.unitId === unit.unit_id)?.change === "deleted") {
      if (
        unit.source === "worktree" ||
        await options.repository.hasRemovalReceipt(row.id, unit.unit_id, userId)
      )
        continue;
      if (
        unit.node_id === null ||
        !(await options.access.resolveNode(userId, unit.node_id))?.capabilities.trash
      )
        throw mergeNeedsEditAccess();
      continue;
    }
    if (!(await canEditUnit(userId, row, unit, options.access))) {
      throw mergeNeedsEditAccess();
    }
  }
  if (!(await options.pages.writable(row.id, userId, pageDraftIds))) throw mergeNeedsEditAccess();
}

async function validateTarget(
  userId: string,
  worktree: WorktreeRow,
  spaceId: string,
  parentNodeId: string | null,
  access: AccessResolver,
  purpose: "create" | "propose" = "create"
): Promise<void> {
  if (
    worktree.kind === "team" &&
    worktree.team_space_id !== spaceId
  ) {
    throw invalidInput(
      "Team Worktree content must target its Team Space.",
      "targetSpaceId"
    );
  }
  // A Team Worktree's author only names where a new file would go; whoever merges creates it there.
  if (purpose === "propose" && worktree.kind === "team") {
    const space = await access.resolveSpace(userId, spaceId);
    if (!space) throw notFound();
    if (!space.capabilities.propose) throw forbidden();
    if (parentNodeId !== null && (await access.resolveNode(userId, parentNodeId))?.spaceId !== spaceId) throw notFound();
    return;
  }
  if (parentNodeId === null) {
    const space = await access.resolveSpace(userId, spaceId);
    if (!space) throw notFound();
    if (!space.capabilities.createAtRoot) throw forbidden();
    return;
  }
  const parent = await access.resolveNode(userId, parentNodeId);
  if (!parent || parent.spaceId !== spaceId) {
    throw notFound();
  }
  if (!parent.capabilities.createChildren) throw forbidden();
}

/** A finished merge puts a Team Worktree in its Space's history, so the Space sees it whatever its author chose while it was open. */
function visibilityOf(row: WorktreeRow, merged: boolean): WorktreeVisibility {
  return row.kind === "team" && merged && row.processed_at !== null ? "space" : row.visibility;
}

function isDiscoverable(row: WorktreeRow, merged: boolean): boolean {
  if (row.actor_owns_creator_space) return true;
  if (row.kind === "user") return false;
  const teamRole = row.actor_owns_team_space ? "owner" : row.actor_member_role;
  if (teamRole === null) return false;
  if (visibilityOf(row, merged) === "space") return true;
  return teamRole === "owner" || teamRole === "admin";
}

function canManageSummary(userId: string, row: WorktreeRow): boolean {
  if (row.creator_user_id === userId) return true;
  return (
    row.kind === "team" &&
    (Boolean(row.actor_owns_team_space) ||
      row.actor_member_role === "admin")
  );
}

async function mapUnits(
  rows: readonly WorktreeUnitRow[],
  states: readonly {
    readonly unitID: string;
    readonly baselineTrunkRevision?: number;
    readonly draftHeadRevision: number;
    readonly removed?: boolean;
    readonly type?: UniverType;
    readonly mergeResult?: { readonly status: string };
  }[],
  userId: string,
  access: AccessResolver,
  trunk: TrunkClock | null,
): Promise<WorktreeUnit[]> {
  const byId = new Map(states.map((state) => [state.unitID, state]));
  return Promise.all(rows.map(async (row) => {
    const state = byId.get(row.unit_id);
    const mergeResult =
      state?.mergeResult?.status === "merged" ||
      state?.mergeResult?.status === "unchanged" ||
      state?.mergeResult?.status === "removed" ||
      state?.mergeResult?.status === "conflict" ||
      state?.mergeResult?.status === "failed"
        ? state.mergeResult.status
        : "pending";
    return {
      unitId: row.unit_id,
      resourceId: row.resource_id,
      nodeId: row.node_id,
      source: row.source,
      name:
        state?.removed && row.source === "trunk" && !(await access.resolveResource(userId, row.resource_id))
          ? "Removed resource"
          : (row.existing_name ?? row.new_name ?? "Removed resource"),
      unitType: requireUnitType(
        row.existing_unit_type ?? row.new_unit_type ?? unitTypeFromProtocol(state?.type),
      ),
      target:
        row.source === "worktree" && row.target_space_id
          ? {
              spaceId: row.target_space_id,
              parentNodeId: row.target_parent_node_id,
            }
          : null,
      draftHeadRevision: state?.draftHeadRevision ?? 0,
      change: state?.removed
        ? "deleted"
        : row.source === "worktree"
          ? "added"
          : state?.baselineTrunkRevision !== undefined &&
              state.draftHeadRevision >
                state.baselineTrunkRevision
            ? "modified"
            : "unchanged",
      mergeResult,
      activationState: activationState(row, mergeResult),
      freshness:
        row.source === "trunk" && trunk && state?.baselineTrunkRevision !== undefined
          ? unitFreshness(state.baselineTrunkRevision, await trunk.revision(row.unit_id), row.added_at, trunk.now)
          : null,
    };
  }));
}

interface TrunkClock {
  readonly revision: (unitId: string) => Promise<number | null>;
  readonly now: number;
}

// Spec 5.6 and phase 0 section 7.1. Stale is advice to redo the work; it never blocks a merge.
const STALE_REVISIONS_BEHIND = 100;
const STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function unitFreshness(
  baselineTrunkRevision: number,
  trunkRevision: number | null,
  addedAt: number,
  now: number,
): WorktreeUnitFreshness | null {
  if (trunkRevision === null) return null;
  const revisionsBehind = trunkRevision - baselineTrunkRevision;
  return {
    label:
      revisionsBehind > STALE_REVISIONS_BEHIND || now - addedAt > STALE_AGE_MS
        ? "stale"
        : revisionsBehind > 0
          ? "behind"
          : "current",
    baselineTrunkRevision,
    revisionsBehind,
    addedAt: new Date(addedAt).toISOString(),
  };
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

async function activateSuccessfulUnits(
  actorUserId: string,
  worktree: WorktreeRow,
  rows: readonly WorktreeUnitRow[],
  states: readonly {
    readonly unitID: string;
    readonly mergeResult?: { readonly status: string };
  }[],
  repository: WorktreesRepository,
  activatedAt: number
): Promise<string[]> {
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
      await repository.activateLocalUnit(
        row,
        actorUserId,
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
    createdVia: writeSourceView(row.created_via),
    number: row.number,
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
    visibility: visibilityOf(row, state === "merged"),
    state,
    creator: {
      id: row.creator_user_id,
      username: row.creator_username,
      displayName: row.creator_display_name,
      avatarUrl: row.creator_avatar_url,
    },
    claimer:
      row.claimer_user_id !== null && row.claimer_username !== null && row.claimer_display_name !== null
        ? {
            id: row.claimer_user_id,
            username: row.claimer_username,
            displayName: row.claimer_display_name,
            avatarUrl: row.claimer_avatar_url,
          }
        : null,
    unitCount: row.unit_count,
    pendingPageDrafts: row.pending_page_drafts,
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

async function requireAddableResource(
  userId: string,
  worktree: WorktreeRow,
  resourceId: string,
  access: AccessResolver
): Promise<UniverResourceAccess> {
  const resource = await access.resolveResource(userId, resourceId);
  if (!resource || resource.kind !== "univer") throw notFound();
  const { openContent, editContent } = resource.capabilities;
  if (!(worktree.kind === "team" ? openContent : editContent)) throw forbidden();
  return resource;
}

function unionAudience(
  left: readonly string[],
  right: readonly string[]
): string[] {
  return [...new Set([...left, ...right])].sort();
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

function validReviewedPages(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const { pageDraftIds } = requiredRecord(value);
  if (pageDraftIds === undefined) return undefined;
  if (!Array.isArray(pageDraftIds) || !pageDraftIds.every((id) => typeof id === "string" && id.length > 0)) {
    throw invalidInput("pageDraftIds must be an array of draft IDs.", "pageDraftIds");
  }
  return [...new Set(pageDraftIds as string[])].sort();
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
    pdf: UniverType.UNIVER_PDF,
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

function validScope(value: unknown): "active" | "processed" | "all" {
  if (value === undefined || value === "active") return "active";
  if (value === "processed" || value === "all") return value;
  throw invalidInput("scope is invalid.", "scope");
}

function validSearch(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 200) {
    throw invalidInput("search must be a string of at most 200 characters.", "search");
  }
  return value.trim();
}

function validNumber(value: unknown): number {
  const number = typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number)) throw invalidInput("number must be a positive integer.", "number");
  return number;
}

const MAX_ACTIVITY_ROWS = 1000;
const MAX_MERGE_LOOKUPS = 200;
const WORKTREE_STATES: readonly WorktreeState[] = ["draft", "ready", "merging", "merged", "discarded"];

/** `state` may repeat; an absent filter returns every state. */
function validStates(value: unknown): readonly WorktreeState[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  const states = values.map((entry) => {
    if (!WORKTREE_STATES.includes(entry as WorktreeState)) throw invalidInput("state is invalid.", "state");
    return entry as WorktreeState;
  });
  return [...new Set(states)].sort();
}

function validOrder(value: unknown): "updatedAtDesc" | "createdAtDesc" {
  if (value === undefined || value === "updatedAtDesc") return "updatedAtDesc";
  if (value === "createdAtDesc") return value;
  throw invalidInput("order is invalid.", "order");
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
    value !== "base" &&
    value !== "pdf"
  ) {
    throw invalidInput("unitType is invalid.", "unitType");
  }
  return value;
}

function unitTypeFromProtocol(value: UniverType | undefined): UnitType | null {
  for (const type of ["sheet", "doc", "slide", "board", "base", "pdf"] as const) {
    if (protocolUnitType(type) === value) return type;
  }
  return null;
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
    ) as Partial<WorktreeCursor> & { readonly updatedAt?: number };
    // Cursors issued before explicit ordering used updatedAt as the position.
    const timestamp = parsed.timestamp ?? parsed.updatedAt;
    if (
      !Number.isSafeInteger(timestamp) ||
      typeof parsed.id !== "string" ||
      !parsed.id ||
      (parsed.queryKey !== undefined && typeof parsed.queryKey !== "string")
    ) {
      throw new Error("invalid cursor");
    }
    return { timestamp: timestamp as number, id: parsed.id,
      ...(parsed.queryKey === undefined ? {} : { queryKey: parsed.queryKey }) };
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
  input: ReturnType<typeof validCreate> & { readonly forkId: string | null },
  stable: ReturnType<typeof validCreate> & {
    readonly worktreeId: string;
    readonly forkId?: string | null;
  }
): void {
  assertJsonIntent(input, {
    kind: stable.kind,
    name: stable.name,
    summary: stable.summary,
    visibility: stable.visibility,
    teamSpaceId: stable.teamSpaceId,
    forkId: stable.forkId ?? null,
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

function conflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}

function idempotencyConflict(): ApplicationError {
  return conflict(
    "Idempotency-Key is already associated with another request."
  );
}

function cacheResourceContent(access: AccessResolver, userId: string): AccessResolver {
  const resources = new Map<string, ResourceContentAccess | null>();
  return {
    ...access,
    async resolveResourceContent(actorId, resourceId) {
      if (actorId !== userId) return access.resolveResourceContent(actorId, resourceId);
      if (!resources.has(resourceId)) {
        resources.set(resourceId, await access.resolveResourceContent(actorId, resourceId));
      }
      return resources.get(resourceId)!;
    },
  };
}
