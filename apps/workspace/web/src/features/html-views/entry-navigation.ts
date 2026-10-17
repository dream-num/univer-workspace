const CHANNEL = "workspace-html-entry-v1";

/** Serialized into the sandbox; only the embedding Window may supply an entry location. */
function entryClient(channel: string, nonce: string, origin: string) {
  let previous = new URL(document.baseURI);
  addEventListener("message", (event) => {
    const value = event.data;
    if (
      event.source !== parent ||
      event.origin !== origin ||
      value?.channel !== channel ||
      value?.nonce !== nonce ||
      value.action !== "navigate" ||
      typeof value.search !== "string" ||
      typeof value.hash !== "string" ||
      value.search.length > 8192 ||
      value.hash.length > 8192 ||
      (value.search && !value.search.startsWith("?")) ||
      (value.hash && !value.hash.startsWith("#"))
    )
      return;
    const hashChanged = previous.hash !== value.hash;
    previous.search = value.search;
    previous.hash = value.hash;
    const handled = !dispatchEvent(
      new CustomEvent("workspace-location-change", {
        cancelable: true,
        detail: { search: value.search, hash: value.hash },
      }),
    );
    // Older hash routers already handle delegated anchor clicks; keep their in-memory state.
    if (!handled && hashChanged) {
      const link = document.createElement("a");
      link.setAttribute("href", value.hash || "#home");
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
    }
  });
  const ready = () => parent.postMessage({ channel, nonce, action: "ready" }, origin);
  if (document.readyState === "loading") {
    addEventListener("DOMContentLoaded", ready, { once: true });
  } else ready();
}

export function withEntryNavigation(source: string, nonce: string, origin: string): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  const script = document.createElement("script");
  script.textContent = `(${entryClient.toString()})(${JSON.stringify(CHANNEL)},${JSON.stringify(nonce)},${JSON.stringify(origin)});`;
  document.head.prepend(script);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export function connectEntryNavigation(
  host: Window,
  frame: () => HTMLIFrameElement | null,
  nonce: string,
) {
  let ready = false;
  const send = () => {
    if (!ready) return;
    const { search, hash } = host.location;
    frame()?.contentWindow?.postMessage(
      { channel: CHANNEL, nonce, action: "navigate", search, hash },
      "*",
    );
  };
  const receive = (event: MessageEvent) => {
    if (
      event.source !== frame()?.contentWindow ||
      event.origin !== "null" ||
      event.data?.channel !== CHANNEL ||
      event.data?.nonce !== nonce ||
      event.data.action !== "ready"
    )
      return;
    ready = true;
    send();
  };
  host.addEventListener("message", receive);
  host.addEventListener("hashchange", send);
  host.addEventListener("popstate", send);
  return {
    send,
    dispose() {
      ready = false;
      host.removeEventListener("message", receive);
      host.removeEventListener("hashchange", send);
      host.removeEventListener("popstate", send);
    },
  };
}

/** Entry parameters may change without pausing or recreating this same HTML resource. */
export function isSameHtmlEntry(
  current: { pathname: string; search: object },
  next: { pathname: string; search: object },
): boolean {
  if (
    current.pathname !== next.pathname ||
    (!current.pathname.startsWith("/nodes/") && current.pathname !== "/apps")
  )
    return false;
  const before = current.search as Record<string, unknown>;
  const after = next.search as Record<string, unknown>;
  return (
    before.node === after.node && before.unit === after.unit && before.spaceId === after.spaceId
  );
}
