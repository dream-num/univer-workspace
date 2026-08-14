import type { SaveSnapshotInput } from "@univerjs-pro/collaboration-service";
import { UniverType } from "@univerjs/protocol";
import { describe, expect, it } from "vitest";
import {
  resolveMergeReview,
  resolveMergeReviewStatus,
} from "../../client/src/features/editor/merge-review.js";

describe("resolveMergeReview", () => {
  it("loads the frozen Worktree draft when trunk has not advanced", () => {
    expect(
      resolveMergeReview({
        status: "not-behind",
        worktreeID: "worktree-1",
        unitID: "unit-1",
      })
    ).toEqual({ kind: "worktree" });
  });

  it("loads the materialized preview when trunk has advanced", () => {
    const preview = {
      snapshot: {
        unitID: "unit-1",
        type: UniverType.UNIVER_SHEET,
        rev: 3,
      },
    } as SaveSnapshotInput;

    expect(
      resolveMergeReview({
        status: "preview",
        worktreeID: "worktree-1",
        unitID: "unit-1",
        preview,
      })
    ).toEqual({ kind: "preview", preview });
  });

  it("keeps merge conflicts unavailable", () => {
    expect(
      resolveMergeReview({
        status: "conflict",
        worktreeID: "worktree-1",
        unitID: "unit-1",
        error: {
          code: "OT_CONFLICT",
          message: "conflict",
          retryable: false,
        },
      })
    ).toEqual({ kind: "unavailable", reason: "conflict" });
  });

  it("exposes the compact review status used by the workbench UI", () => {
    expect(
      resolveMergeReviewStatus({
        status: "not-behind",
        worktreeID: "worktree-1",
        unitID: "unit-1",
      })
    ).toBe("notBehind");
    expect(
      resolveMergeReviewStatus({
        status: "preview",
        worktreeID: "worktree-1",
        unitID: "unit-1",
        preview: {
          snapshot: {
            unitID: "unit-1",
            type: UniverType.UNIVER_SHEET,
            rev: 3,
          },
        } as SaveSnapshotInput,
      })
    ).toBe("preview");
    expect(
      resolveMergeReviewStatus({
        status: "conflict",
        worktreeID: "worktree-1",
        unitID: "unit-1",
        error: {
          code: "OT_CONFLICT",
          message: "conflict",
          retryable: false,
        },
      })
    ).toBe("conflict");
    expect(resolveMergeReviewStatus(undefined)).toBe("unavailable");
  });
});
