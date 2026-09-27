import type { SaveSnapshotInput } from "@univerjs-pro/collaboration-service";
import { UniverType } from "@univerjs/protocol";
import { describe, expect, it } from "vitest";
import {
  decodeMergePreviewEvaluation,
  resolveMergeReview,
  resolveMergeReviewStatus,
} from "../../web/src/features/editor/merge-review.js";

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

describe("decodeMergePreviewEvaluation", () => {
  it("turns base64 Sheet blocks and metadata into bytes", () => {
    const cellJson = JSON.stringify({
      0: { 0: { v: "姓名", t: 1 } },
    });
    const workbookMeta = JSON.stringify({ appVersion: "1.0.2" });
    const sheetMeta = JSON.stringify({ name: "成绩表" });
    const evaluation = decodeMergePreviewEvaluation({
      status: "preview",
      worktreeID: "worktree-1",
      unitID: "unit-1",
      preview: {
        snapshot: {
          unitID: "unit-1",
          type: UniverType.UNIVER_SHEET,
          rev: 3,
          workbook: {
            originalMeta: Buffer.from(workbookMeta).toString("base64"),
            sheets: {
              "sheet-1": {
                originalMeta: Buffer.from(sheetMeta).toString("base64"),
              },
            },
          },
        },
        sheetBlocks: [
          {
            id: "block-1",
            startRow: 0,
            endRow: 1,
            data: Buffer.from(cellJson).toString("base64"),
          },
        ],
      } as SaveSnapshotInput,
    });

    expect(evaluation?.status).toBe("preview");
    if (evaluation?.status !== "preview") return;
    const text = new TextDecoder();
    expect(text.decode(evaluation.preview.snapshot.workbook?.originalMeta)).toBe(
      workbookMeta
    );
    expect(
      text.decode(
        evaluation.preview.snapshot.workbook?.sheets["sheet-1"]?.originalMeta
      )
    ).toBe(sheetMeta);
    expect(text.decode(evaluation.preview.sheetBlocks?.[0]?.data)).toBe(cellJson);
  });

  it("leaves a non-preview evaluation unchanged", () => {
    const evaluation = {
      status: "not-behind" as const,
      worktreeID: "worktree-1",
      unitID: "unit-1",
    };
    expect(decodeMergePreviewEvaluation(evaluation)).toBe(evaluation);
  });

  it("rejects Sheet block data that is not base64", () => {
    expect(() =>
      decodeMergePreviewEvaluation({
        status: "preview",
        worktreeID: "worktree-1",
        unitID: "unit-1",
        preview: {
          snapshot: {
            unitID: "unit-1",
            type: UniverType.UNIVER_SHEET,
            rev: 1,
            workbook: {
              originalMeta: new Uint8Array(),
              sheets: {},
            },
          },
          sheetBlocks: [
            { id: "block-1", startRow: 0, endRow: 1, data: "@@@" as unknown as Uint8Array },
          ],
        } as SaveSnapshotInput,
      })
    ).toThrow(/Sheet block block-1/);
  });
});
