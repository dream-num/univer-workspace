const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// shortcut: the SDK publishes no way to list or rewrite the Unit and Asset IDs inside Unit data, so
// this matches whole UUID-shaped strings, which is how Workspace mints both. Sheet, Doc and Slide
// keep each such reference as a whole value or key, in the data or in the JSON text of
// `resources[].data`. A cell whose whole text equals the source Unit ID or one of its Asset IDs is
// rewritten too; text that only contains one is not. Delete this file when the SDK ships a
// reference walker and call that instead.

/** Every value and key of plain Unit data that is a whole UUID. */
export function uuidsIn(data: unknown): Set<string> {
  const found = new Set<string>();
  rewriteStrings(data, (text) => {
    if (UUID.test(text)) found.add(text);
    return text;
  });
  return found;
}

/** A copy of `data` in which every value or key equal to an ID in `ids` is replaced. */
export function remapIds<T>(data: T, ids: ReadonlyMap<string, string>): T {
  return rewriteStrings(data, (text) => ids.get(text) ?? text) as T;
}

function rewriteStrings(node: unknown, swap: (text: string) => string): unknown {
  if (typeof node === "string") return swap(node);
  if (Array.isArray(node)) return node.map((item) => rewriteStrings(item, swap));
  if (node === null || typeof node !== "object" || node instanceof Uint8Array) return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, item]) => [
      swap(key),
      key === "resources" && Array.isArray(item)
        ? item.map((resource) => rewriteResource(resource, swap))
        : rewriteStrings(item, swap),
    ]),
  );
}

/** A plugin keeps its state as JSON text in `data`; that text is rewritten only when an ID in it changed. */
function rewriteResource(resource: unknown, swap: (text: string) => string): unknown {
  const rewritten = rewriteStrings(resource, swap);
  if (rewritten === null || typeof rewritten !== "object" || !("data" in rewritten) || typeof rewritten.data !== "string") {
    return rewritten;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rewritten.data);
  } catch {
    return rewritten;
  }
  let changed = false;
  const data = rewriteStrings(parsed, (text) => {
    const next = swap(text);
    changed ||= next !== text;
    return next;
  });
  return changed ? { ...rewritten, data: JSON.stringify(data) } : rewritten;
}
