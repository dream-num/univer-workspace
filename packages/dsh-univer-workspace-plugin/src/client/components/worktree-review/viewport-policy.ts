/** Geometry policy for bounded review previews; visible Units are never evicted. */
export interface ReviewViewportItem {
  readonly unitId: string;
  /** Distance in pixels from the visible scrollport; zero means visible. */
  readonly distance: number;
}

export function selectViewportUnits(
  items: readonly ReviewViewportItem[],
  previous: ReadonlySet<string>,
  viewportHeight: number,
  capacity: number,
): ReadonlySet<string> {
  const ordered = [...items].sort((a, b) => a.distance - b.distance);
  const next = new Set(ordered.filter((item) => item.distance === 0).map((item) => item.unitId));
  // Preserve nearby instances even when the normal cache budget is exceeded.
  // A half-screen load zone and one-screen retention zone prevent boundary churn.
  for (const item of ordered) {
    if (previous.has(item.unitId) && item.distance <= viewportHeight) next.add(item.unitId);
  }
  for (const item of ordered) {
    if (next.size >= capacity) break;
    if (item.distance <= viewportHeight / 2) next.add(item.unitId);
  }
  // Distance makes an instance eligible for eviction, not mandatory to unload.
  // Fill the remaining cache with already loaded Units before discarding any.
  for (const item of ordered) {
    if (next.size >= capacity) break;
    if (previous.has(item.unitId)) next.add(item.unitId);
  }
  return next;
}
