import type { WorktreeUnitView } from "../../shared/state.ts";

/** Count documents in the authoritative Worktree state, never tool calls. */
export function countWorktreeChanges(units: readonly Pick<WorktreeUnitView, "unitId" | "kind">[]) {
  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const unit of new Map(units.map(unit => [unit.unitId, unit])).values()) {
    if (unit.kind === "added" || unit.kind === "modified" || unit.kind === "deleted") counts[unit.kind]++;
  }
  return counts;
}

/** Keep the floating list reachable throughout the browser viewport. */
export function clampTaskPosition(point: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const maxX = Math.max(0, viewport.width - size.width);
  const maxY = Math.max(0, viewport.height - size.height);
  return { x: Math.max(0, Math.min(point.x, maxX)), y: Math.max(0, Math.min(point.y, maxY)) };
}
