import type { Snapshot, SnapshotCell } from "./types.js";

/** Formula cells without cached values, keyed by sheet ID. Empty strings are cached values. */
export function uncachedFormulas(snapshot: Snapshot): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of snapshot.sheetOrder) {
    let count = 0;
    for (const row of Object.values(snapshot.sheets[id]?.cellData ?? {})) {
      for (const cell of Object.values<SnapshotCell | undefined>(row ?? {})) {
        if (
          cell &&
          ((typeof cell.f === "string" && cell.f !== "") ||
            (cell.si !== undefined && cell.si !== null && cell.si !== "")) &&
          (cell.v === undefined || cell.v === null)
        )
          count++;
      }
    }
    if (count) counts[id] = count;
  }
  return counts;
}
