/**
 * The Workspace mark used by the browser favicon.  Keep the geometry aligned
 * with the product web entry point and Brand.tsx; the data URL lets the skin
 * repair pages that were bootstrapped from an unbranded DSH index as well.
 */
const WORKSPACE_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1081 1081"><style>@media (prefers-color-scheme: dark) { path { fill: #ffffff; } }</style><path fill="#2563eb" d="M360.72 528.67C360.72 533.02 358 536.91 353.91 538.39L.48 666.87V839.06L466.71 658.3C497.49 646.45 517.8 616.87 517.8 583.89V.88H360.71V528.68Z"/><path fill="#2563eb" d="M1080.57 666.87V839.06L604.9 658.3C574.12 646.45 553.81 616.87 553.81 583.89V471.04C553.81 438.06 574.12 408.48 604.9 396.63L1080.57 216.87V404.01L714.36 527.51C712.29 528.21 710.9 530.15 710.9 532.33C710.9 534.48 712.26 536.41 714.29 537.13Z"/><path fill="#2563eb" d="M517.81 713.23V1080.97H360.72L360.76 754.11C360.76 743.75 367.16 734.46 376.84 730.76L483.89 689.87C500.26 683.62 517.81 695.7 517.81 713.22Z"/><path fill="#2563eb" d="M297.02 511.59L.48 390.29V215.87L312.11 343.42C319.62 346.49 324.53 353.8 324.53 361.92L324.58 493.07C324.58 507.29 310.17 516.97 297.01 511.59Z"/></svg>`;

/** Shared value used by tests and by the DOM installer. */
export const WORKSPACE_FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(WORKSPACE_FAVICON_SVG)}`;

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
