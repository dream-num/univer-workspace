import type { SaveSnapshotInput } from "@univerjs-pro/collaboration-service";
import type { WorktreeUnitMergeEvaluation } from "@univerjs-pro/collaboration-worktree-service";

export type MergeReviewResolution =
  | { readonly kind: "worktree" }
  | {
      readonly kind: "preview";
      readonly preview: SaveSnapshotInput;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "conflict" | "missing";
    };

export type MergeReviewStatus =
  | "notBehind"
  | "preview"
  | "conflict"
  | "unavailable";

export function resolveMergeReview(
  evaluation: WorktreeUnitMergeEvaluation | undefined
): MergeReviewResolution {
  if (evaluation?.status === "not-behind") {
    return { kind: "worktree" };
  }
  if (evaluation?.status === "preview") {
    return { kind: "preview", preview: evaluation.preview };
  }
  return {
    kind: "unavailable",
    reason: evaluation?.status === "conflict" ? "conflict" : "missing",
  };
}

export function resolveMergeReviewStatus(
  evaluation: WorktreeUnitMergeEvaluation | undefined
): MergeReviewStatus {
  const resolution = resolveMergeReview(evaluation);
  if (resolution.kind === "worktree") return "notBehind";
  if (resolution.kind === "preview") return "preview";
  return resolution.reason === "conflict"
    ? "conflict"
    : "unavailable";
}

/** The merge-preview HTTP body carries Sheet blocks and unit metadata as
 * base64. The snapshot service expects the same bytes the Worktree client
 * decodes before building a frozen preview. */
export function decodeMergePreviewEvaluation(
  evaluation: WorktreeUnitMergeEvaluation | undefined
): WorktreeUnitMergeEvaluation | undefined {
  if (evaluation?.status !== "preview") return evaluation;
  const preview: SaveSnapshotInput = {
    ...evaluation.preview,
    snapshot: decodeSnapshotMetadata(evaluation.preview.snapshot),
  };
  if (!evaluation.preview.sheetBlocks) {
    return { ...evaluation, preview };
  }
  return {
    ...evaluation,
    preview: {
      ...preview,
      sheetBlocks: evaluation.preview.sheetBlocks.map((block) => ({
        ...block,
        data: decodeWireBytes(block.data, `Sheet block ${block.id}`),
      })),
    },
  };
}

function decodeSnapshotMetadata(
  snapshot: SaveSnapshotInput["snapshot"]
): SaveSnapshotInput["snapshot"] {
  const workbook = snapshot.workbook as
    | {
        readonly originalMeta?: unknown;
        readonly sheets?: Readonly<
          Record<string, { readonly originalMeta?: unknown }>
        >;
      }
    | undefined;
  if (workbook) {
    const sheets = workbook.sheets ?? {};
    return {
      ...snapshot,
      workbook: {
        ...snapshot.workbook,
        originalMeta: decodeWireBytes(
          workbook.originalMeta,
          "workbook metadata"
        ),
        sheets: Object.fromEntries(
          Object.entries(sheets).map(([sheetId, sheet]) => [
            sheetId,
            {
              ...sheet,
              originalMeta: decodeWireBytes(
                sheet.originalMeta,
                `Sheet ${sheetId} metadata`
              ),
            },
          ])
        ),
      },
    } as SaveSnapshotInput["snapshot"];
  }

  let decoded = snapshot;
  for (const field of ["doc", "slide", "board"] as const) {
    const metadata = snapshot[field] as
      | { readonly originalMeta?: unknown }
      | undefined;
    if (!metadata) continue;
    decoded = {
      ...decoded,
      [field]: {
        ...metadata,
        originalMeta: decodeWireBytes(metadata.originalMeta, `${field} metadata`),
      },
    } as SaveSnapshotInput["snapshot"];
  }
  return decoded;
}

function decodeWireBytes(value: unknown, subject: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== "string") {
    throw new Error(`合入预览的${subject}不是有效数据。`);
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new Error(`合入预览的${subject}不是有效数据。`);
  }
}
