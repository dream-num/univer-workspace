import type { WorkspaceContentSurface, WorkspaceNavigationStore } from "./workspace-navigation.ts";

export function regionQuery(hash: string): URLSearchParams {
  if (hash.startsWith("#/?")) return new URLSearchParams(hash.slice(3));
  const query = new URLSearchParams();
  if (hash.startsWith("#/s/") && hash.length > 4) query.set("right", `session/${hash.slice(4)}`);
  return query;
}

export function setRegion(key: "center" | "right", value: string | null): void {
  const query = regionQuery(window.location.hash);
  if (value === null) query.delete(key);
  else query.set(key, value);
  const hash = query.size === 0 ? "#/" : `#/?${query}`;
  if (window.location.hash !== hash) window.location.hash = hash;
}

/** Keep the selected Session in the route while releasing its visible region. */
export function setConversationHidden(hidden: boolean, sessionId: string): void {
  setRegion("right", `${hidden ? "hidden/" : ""}session/${encodeURIComponent(sessionId)}`);
}

export function contentRegion(surface: WorkspaceContentSurface | null): string | null {
  if (surface === null) return null;
  return surface.kind === "worktree"
    ? `worktree/${encodeURIComponent(surface.worktreeId)}${surface.unitId === null ? "" : `/unit/${encodeURIComponent(surface.unitId)}`}`
    : `${surface.kind}/${encodeURIComponent(surface.resourceId)}`;
}

export interface ContentRoute {
  kind: "resource" | "blob" | "worktree";
  id: string;
  unitId: string | null;
}
export function parseContentRegion(value: string | null): ContentRoute | null {
  if (value === null) return null;
  const parts = value.split("/");
  const kind = parts[0];
  if (kind !== "resource" && kind !== "blob" && kind !== "worktree") return null;
  if (parts.length !== 2 && !(kind === "worktree" && parts.length === 4 && parts[2] === "unit"))
    return null;
  try {
    const id = decodeURIComponent(parts[1] ?? "");
    const unitId = parts.length === 4 ? decodeURIComponent(parts[3]!) : null;
    return id && unitId !== "" ? { kind, id, unitId } : null;
  } catch {
    return null;
  }
}

/** URL owns visible regions; async metadata resolution cannot overwrite newer navigation. */
export function bindContentRoute(
  navigation: WorkspaceNavigationStore,
  resolve: (route: ContentRoute, signal: AbortSignal) => Promise<WorkspaceContentSurface>,
  failed: (error: unknown) => void,
): () => void {
  let controller: AbortController | undefined;
  let restoring = false;
  const changed = () => {
    if (restoring) return;
    controller?.abort();
    setRegion("center", contentRegion(navigation.getSnapshot().contentSurface));
  };
  const restore = () => {
    const value = regionQuery(window.location.hash).get("center");
    controller?.abort();
    if (value === contentRegion(navigation.getSnapshot().contentSurface)) return;
    const current = new AbortController();
    controller = current;
    const route = parseContentRegion(value);
    restoring = true;
    navigation.dispatch({ type: "close-content" });
    restoring = false;
    if (route === null) return;
    void resolve(route, current.signal)
      .then((surface) => {
        if (current.signal.aborted) return;
        restoring = true;
        navigation.dispatch({ type: "open-content", contentSurface: surface });
        restoring = false;
      })
      .catch((error) => {
        if (!current.signal.aborted) failed(error);
      });
  };
  // A navigation-mode preference must not change either content region.
  let previous = navigation.getSnapshot().contentSurface;
  const unsubscribe = navigation.subscribe(() => {
    const next = navigation.getSnapshot().contentSurface;
    if (next === previous) return;
    previous = next;
    changed();
  });
  window.addEventListener("hashchange", restore);
  restore();
  return () => {
    controller?.abort();
    unsubscribe();
    window.removeEventListener("hashchange", restore);
  };
}
