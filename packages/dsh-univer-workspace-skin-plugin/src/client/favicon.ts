import { WORKSPACE_FAVICON_DATA_URI } from "../branding.js";

export { WORKSPACE_FAVICON_DATA_URI } from "../branding.js";

function isSiteIcon(link: HTMLLinkElement): boolean {
  const rel = link.rel
    .split(/\s+/u)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
  if (rel.some((token) => token === "icon" || token.includes("icon"))) return true;
  return /favicon(?:\.|\/|\?|$)/iu.test(link.getAttribute("href") ?? "");
}

/**
 * Replace stock DSH favicon links after the browser half mounts.
 *
 * The host tap handles first paint; this client effect covers an already
 * running page and keeps the skin self-contained when the shell is remounted.
 */
export function installWorkspaceFavicon(): () => void {
  if (typeof document === "undefined") return () => {};

  const previous = Array.from(document.head.querySelectorAll<HTMLLinkElement>("link"))
    .filter(isSiteIcon);
  const link = document.createElement("link");
  link.id = "uwh-workspace-favicon";
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = WORKSPACE_FAVICON_DATA_URI;

  for (const oldLink of previous) oldLink.remove();
  document.head.appendChild(link);

  return () => {
    link.remove();
    for (const oldLink of previous) {
      if (!oldLink.isConnected) document.head.appendChild(oldLink);
    }
  };
}
