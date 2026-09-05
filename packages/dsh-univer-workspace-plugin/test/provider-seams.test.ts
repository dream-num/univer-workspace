import { describe, expect, it } from "vitest";
import * as barrel from "../src/provider/workspace-api.js";
import * as errors from "../src/provider/api-errors.js";
import * as spaces from "../src/provider/spaces-api.js";
import * as resources from "../src/provider/resources-api.js";
import * as worktrees from "../src/provider/worktree-api.js";
import * as fileState from "../src/provider/file-state-api.js";

describe("Workspace provider seams", () => {
  it("keeps workspace-api exports bound to the responsibility modules", () => {
    expect(barrel.WorkspaceApiError).toBe(errors.WorkspaceApiError);
    for (const [name, historical, seam] of [
      ["listSpaces", barrel.listSpaces, spaces.listSpaces],
      ["listSpaceDocuments", barrel.listSpaceDocuments, spaces.listSpaceDocuments],
      ["narrowSpaces", barrel.narrowSpaces, spaces.narrowSpaces],
      ["narrowNodePage", barrel.narrowNodePage, spaces.narrowNodePage],
      ["narrowNodes", barrel.narrowNodes, spaces.narrowNodes],
      ["openResource", barrel.openResource, resources.openResource],
      ["resolveUnitResource", barrel.resolveUnitResource, resources.resolveUnitResource],
      ["narrowOpen", barrel.narrowOpen, resources.narrowOpen],
      ["narrowUnitResource", barrel.narrowUnitResource, resources.narrowUnitResource],
      ["newIdempotencyKey", barrel.newIdempotencyKey, resources.newIdempotencyKey],
      ["createDocument", barrel.createDocument, resources.createDocument],
      ["createWorktree", barrel.createWorktree, worktrees.createWorktree],
      ["getWorktreeDetail", barrel.getWorktreeDetail, worktrees.getWorktreeDetail],
      ["worktreeSummaryFromDetail", barrel.worktreeSummaryFromDetail, worktrees.worktreeSummaryFromDetail],
      ["addWorktreeTrunkUnit", barrel.addWorktreeTrunkUnit, worktrees.addWorktreeTrunkUnit],
      ["narrowWorktreeSummary", barrel.narrowWorktreeSummary, worktrees.narrowWorktreeSummary],
      ["narrowWorktreeUnit", barrel.narrowWorktreeUnit, worktrees.narrowWorktreeUnit],
      ["createWorktreeLocalUnit", barrel.createWorktreeLocalUnit, worktrees.createWorktreeLocalUnit],
      ["openWorktreeUnit", barrel.openWorktreeUnit, worktrees.openWorktreeUnit],
      ["markWorktreeReady", barrel.markWorktreeReady, worktrees.markWorktreeReady],
      ["discardWorktree", barrel.discardWorktree, worktrees.discardWorktree],
      ["mergeWorktree", barrel.mergeWorktree, worktrees.mergeWorktree],
      ["reopenWorktree", barrel.reopenWorktree, worktrees.reopenWorktree],
      ["narrowWorktreeDetail", barrel.narrowWorktreeDetail, worktrees.narrowWorktreeDetail],
      ["listActiveWorktrees", barrel.listActiveWorktrees, worktrees.listActiveWorktrees],
      ["listReviewWorktrees", barrel.listReviewWorktrees, worktrees.listReviewWorktrees],
      ["getFileState", barrel.getFileState, fileState.getFileState],
      ["getWorktreeFileState", barrel.getWorktreeFileState, fileState.getWorktreeFileState],
    ] as const) {
      expect(historical, name).toBe(seam);
    }
  });
});
