import { RevertRevisionMutation } from "@univerjs-pro/collaboration";
import { CollabError, type UniverCollabService } from "@univerjs-pro/collaboration-service";
import type { UniverCollabWorktreeService } from "@univerjs-pro/collaboration-worktree-service";
import {
  collaborationCallOptions,
  createUnitData,
} from "./unit-store.js";
import { draftKey } from "../../modules/worktrees/checks.js";
import type {
  WorktreeBackend,
} from "../../modules/worktrees/worktrees.types.js";

export function createWorktreeBackend(
  service: UniverCollabWorktreeService,
  trunk: UniverCollabService,
): WorktreeBackend {
  // A merge that the checks gate decided on one draft starts only if the draft is still that one. The SDK moves the
  // Worktree from ready to merging right after this, and a ready Worktree takes no draft write.
  service.use("mergeWorktree", async (context, next) => {
    const checked = context.customData.checkedDraft;
    if (typeof checked === "string") {
      const { worktree } = await service.getWorktree({ worktreeID: context.request.worktreeID }, collaborationCallOptions(context.userID));
      if (worktree.status !== "ready" || draftKey(worktree.units) !== checked) {
        throw new CollabError("PERMISSION_DENIED", "This pull request changed after its checks were decided, so nothing was merged. View it again, and merge once its checks pass on what it holds now.");
      }
    }
    await next();
  });
  return {
    async createWorktree(worktreeId, userId) {
      return (
        await service.createWorktree(
          { worktreeID: worktreeId },
          collaborationCallOptions(userId)
        )
      ).worktree;
    },
    async getWorktree(worktreeId, userId) {
      return (
        await service.getWorktree(
          { worktreeID: worktreeId },
          collaborationCallOptions(userId)
        )
      ).worktree;
    },
    async addUnit(worktreeId, unitId, userId) {
      return (
        await service.addUnit(
          { worktreeID: worktreeId, unitID: unitId },
          collaborationCallOptions(userId)
        )
      ).worktree;
    },
    async createUnit(input, userId) {
      const unitData = createUnitData(input);
      const options = collaborationCallOptions(userId);
      const result = await service.createUnitFromData(
        {
          worktreeID: input.worktreeId,
          ...unitData,
        },
        options
      );
      const loaded = await service.getUnitLoadData(
        {
          worktreeID: input.worktreeId,
          unitID: input.unitId,
          type: unitData.type,
          revision: 0,
        },
        options
      );
      const created = result.worktree.units.find(
        (unit) => unit.unitID === input.unitId
      );
      if (
        !created ||
        created.type !== unitData.type ||
        loaded.snapshot.unitID !== input.unitId ||
        loaded.snapshot.type !== unitData.type ||
        loaded.targetRevision !== created.draftHeadRevision
      ) {
        throw new Error(
          `Collaboration Worktree Unit identity did not match reserved Unit ${input.unitId}.`
        );
      }
      return result.worktree;
    },
    async markReady(worktreeId, userId) {
      return (
        await service.markReady(
          { worktreeID: worktreeId },
          collaborationCallOptions(userId)
        )
      ).worktree;
    },
    async setUnitRemoved(worktreeId, unitId, removed, userId) {
      return (
        await service.setUnitRemoved(
          { worktreeID: worktreeId, unitID: unitId, removed },
          collaborationCallOptions(userId),
        )
      ).worktree;
    },
    async reopen(worktreeId, userId) {
      return (
        await service.reopenWorktree(
          { worktreeID: worktreeId },
          collaborationCallOptions(userId)
        )
      ).worktree;
    },
    async merge(worktreeId, userId, checkedDraft) {
      const options = collaborationCallOptions(userId);
      return (
        await service.mergeWorktree(
          { worktreeID: worktreeId },
          // The merge's Trunk changesets carry this server-side mark, the only Trunk write of an agent that lands by checks.
          { ...options, customData: { ...options.customData, merge: true, ...(checkedDraft && { checkedDraft }) } }
        )
      ).worktree;
    },
    async discard(worktreeId, userId) {
      return (
        await service.discardWorktree(
          { worktreeID: worktreeId },
          collaborationCallOptions(userId)
        )
      ).worktree;
    },
    async submitChangeset(worktreeId, changeset, userId) {
      const options = collaborationCallOptions(userId);
      const result = await service.submitChangeset(
        {
          worktreeID: worktreeId,
          changeset: {
            ...changeset,
            userID: userId,
            memberID: options.memberID,
          },
        },
        options
      );
      if (!("error" in result)) {
        const { metadata, ...committed } = result.changeset;
        // The product HTTP contract exposes the final size at the top level.
        // Records migrated from older SDKs already carry it in the protocol payload.
        if (typeof metadata.mutationSize === "number") {
          committed.mutationSize = metadata.mutationSize;
        }
        return { status: result.status, changeset: committed };
      }
      return {
        status: result.status,
        error: {
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable,
          ...(result.error.details === undefined
            ? {}
            : { details: result.error.details }),
        },
      };
    },
    async trunkRevision(unitId, userId) {
      // One Unit record read. Loading the Unit would also read its snapshot and changesets.
      const unit = await trunk.dbAdapter.getUnit(
        { userID: userId, customData: { source: "product-api" }, request: {} },
        unitId,
      );
      return unit?.headRevision ?? null;
    },
    async trunkChangesets(unitId, type, after, to, userId) {
      if (to <= after) return [];
      const { changesets } = await trunk.getChangesets({ unitID: unitId, type, from: after, to }, collaborationCallOptions(userId));
      return changesets
        .filter((record) => record.revision > after)
        .map((record) => ({
          revision: record.revision,
          userId: record.userID,
          sid: record.sid ?? "",
          // The SDK records changeset time in Unix seconds.
          createdAt: typeof record.createTime === "number" && record.createTime > 0 ? record.createTime * 1000 : null,
        }));
    },
    async restoreTrunk(input, userId) {
      const options = collaborationCallOptions(userId);
      const result = await trunk.submitChangeset({
        changeset: {
          unitID: input.unitId,
          type: input.type,
          baseRev: input.baseRev,
          revision: input.baseRev + 1,
          sid: input.sid,
          reqId: input.reqId,
          userID: userId,
          memberID: options.memberID,
          mutations: [{ id: RevertRevisionMutation.id, data: JSON.stringify({ unitId: input.unitId, revision: input.targetRevision }) }],
        },
      }, options);
      if (!("error" in result)) return { status: result.status, changeset: result.changeset };
      return {
        status: result.status,
        error: { code: result.error.code, message: result.error.message, retryable: result.error.retryable },
      };
    },
  };
}
