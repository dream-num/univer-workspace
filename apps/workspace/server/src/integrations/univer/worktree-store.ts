import type { UniverCollabWorktreeService } from "@univerjs-pro/collaboration-worktree-service";
import {
  collaborationCallOptions,
  createUnitData,
} from "./unit-store.js";
import type {
  WorktreeBackend,
} from "../../modules/worktrees/worktrees.types.js";

export function createWorktreeBackend(
  service: UniverCollabWorktreeService
): WorktreeBackend {
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
    async reopen(worktreeId, userId) {
      return (
        await service.reopenWorktree(
          { worktreeID: worktreeId },
          collaborationCallOptions(userId)
        )
      ).worktree;
    },
    async merge(worktreeId, userId) {
      return (
        await service.mergeWorktree(
          { worktreeID: worktreeId },
          collaborationCallOptions(userId)
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
        return result;
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
  };
}
