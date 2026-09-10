import type { UnitComparisonViewerValue } from "@univer/unit-comparison-viewer";
import { PROXY_PREFIX, confirmCreatedUnitMergePreview } from "../viewer/proxy.ts";

export type ComparisonView = "draft" | "merged" | "preview";

export async function loadComparison(
  worktreeId: string,
  unitId: string,
  view: ComparisonView,
  labels: { base: string; result: string },
  signal: AbortSignal,
): Promise<UnitComparisonViewerValue> {
  const response = await fetch(
    `${PROXY_PREFIX}/universer-api/worktrees/${encodeURIComponent(worktreeId)}/units/${encodeURIComponent(unitId)}/comparison?baseMode=base&view=${view}`,
    { signal },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.error?.message ?? body?.message;
    throw new Error(typeof message === "string" ? message : `Comparison request failed (${response.status}).`);
  }
  const payload = await response.json();
  // Older servers ignore unknown query parameters and return current trunk.
  // Never label current trunk as immutable Base. The original endpoint already
  // represents new Worktree-local Units with an empty left side; that exact
  // case has the same Base semantics and needs no server migration.
  const legacyEmptyBase = payload.baseMode === undefined && payload.view === undefined &&
    payload.result?.schemaVersion === 1 && payload.result?.unit?.unitId === unitId &&
    payload.left?.unitData === null && payload.right?.unitData != null;
  const emptyBaseDraft = legacyEmptyBase && (view === "draft" ||
    (view === "preview" && Number.isInteger(payload.right.revision) &&
      await confirmCreatedUnitMergePreview(worktreeId, unitId, payload.right.revision, signal)));
  if ((!emptyBaseDraft && (payload.baseMode !== "base" || payload.view !== view)) ||
      payload.result?.schemaVersion !== 1 || payload.result?.unit?.unitId !== unitId ||
      !payload.left || !payload.right) {
    throw new Error("The Workspace server does not support this historical comparison. Update Workspace and retry.");
  }
  return {
    result: payload.result,
    left: { ...payload.left, label: labels.base },
    right: { ...payload.right, label: labels.result },
  };
}
