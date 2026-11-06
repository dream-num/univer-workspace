export function togglePin(ids: readonly string[], id: string, limit: number): string[] {
  if (ids.includes(id)) return ids.filter((item) => item !== id);
  return ids.length < limit ? [...ids, id] : [...ids];
}

export function movePin(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const from = ids.indexOf(id);
  const to = from + (direction === "up" ? -1 : 1);
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = ids.filter((item) => item !== id);
  next.splice(to, 0, id);
  return next;
}
