import { isHtmlViewFilename } from "@univerjs-labs/html-view";

export type ResourceView = "standard" | "immersive";

export function parseResourceView(value: unknown): "immersive" | undefined {
  return value === "immersive" ? value : undefined;
}

/** Only presentation changes may bypass the HTML host's write-draining guard. */
export function isResourceViewChange(
  current: { pathname: string; search: object },
  next: { pathname: string; search: object },
): boolean {
  if (current.pathname !== next.pathname || !current.pathname.startsWith("/nodes/")) return false;
  const { view: before, ...currentSearch } = current.search as Readonly<Record<string, unknown>>;
  const { view: after, ...nextSearch } = next.search as Readonly<Record<string, unknown>>;
  if (
    before === after ||
    (before !== undefined && before !== "immersive") ||
    (after !== undefined && after !== "immersive")
  ) return false;
  const keys = Object.keys(currentSearch);
  return keys.length === Object.keys(nextSearch).length && keys.every((key) =>
    Object.hasOwn(nextSearch, key) && JSON.stringify(currentSearch[key]) === JSON.stringify(nextSearch[key]),
  );
}

export function defaultSharedView(node?: { name: string; resource?: { kind: string } | null } | null): ResourceView {
  return node?.resource?.kind === "blob" && isHtmlViewFilename(node.name)
    ? "immersive" : "standard";
}

export function resourceShareUrl(origin: string, nodeId: string, view: ResourceView): string {
  const url = new URL(`/nodes/${encodeURIComponent(nodeId)}`, origin);
  if (view === "immersive") url.searchParams.set("view", view);
  return url.toString();
}
