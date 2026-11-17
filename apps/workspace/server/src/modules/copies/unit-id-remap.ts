const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// shortcut: the SDK publishes no way to list or rewrite the Unit and Asset IDs inside Unit data, so
// this matches UUID-shaped text, which is how Workspace mints both. A cell whose own text equals
// the source Unit ID or one of its Asset IDs is rewritten too. Delete this file when the SDK ships
// a reference walker and call that instead.

/** Every UUID-shaped string inside the values and keys of plain Unit data. */
export function uuidsIn(data: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === "string") for (const id of node.match(UUID) ?? []) found.add(id);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object" && !(node instanceof Uint8Array)) {
      for (const [key, item] of Object.entries(node)) {
        walk(key);
        walk(item);
      }
    }
  };
  walk(data);
  return found;
}

/** A copy of `data` with every ID in `ids` replaced inside string values and object keys. */
export function remapIds<T>(data: T, ids: ReadonlyMap<string, string>): T {
  const swap = (text: string) => text.replace(UUID, (id) => ids.get(id) ?? id);
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return swap(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object" || node instanceof Uint8Array) return node;
    return Object.fromEntries(Object.entries(node).map(([key, item]) => [swap(key), walk(item)]));
  };
  return walk(data) as T;
}
