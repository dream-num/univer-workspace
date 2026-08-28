/**
 * The Workspace mark used by the product's browser entry point.
 *
 * Keep this asset inline so the harness can replace the DSH favicon before the
 * browser client is loaded.  The geometry is the same four-path mark used by
 * the Workspace web app and by the skin plugin's sidebar brand occupant.
 */
export const WORKSPACE_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1081 1081"><style>@media (prefers-color-scheme: dark) { path { fill: #ffffff; } }</style><path fill="#2563eb" d="M360.72 528.67C360.72 533.02 358 536.91 353.91 538.39L.48 666.87V839.06L466.71 658.3C497.49 646.45 517.8 616.87 517.8 583.89V.88H360.71V528.68Z"/><path fill="#2563eb" d="M1080.57 666.87V839.06L604.9 658.3C574.12 646.45 553.81 616.87 553.81 583.89V471.04C553.81 438.06 574.12 408.48 604.9 396.63L1080.57 216.87V404.01L714.36 527.51C712.29 528.21 710.9 530.15 710.9 532.33C710.9 534.48 712.26 536.41 714.29 537.13Z"/><path fill="#2563eb" d="M517.81 713.23V1080.97H360.72L360.76 754.11C360.76 743.75 367.16 734.46 376.84 730.76L483.89 689.87C500.26 683.62 517.81 695.7 517.81 713.22Z"/><path fill="#2563eb" d="M297.02 511.59L.48 390.29V215.87L312.11 343.42C319.62 346.49 324.53 353.8 324.53 361.92L324.58 493.07C324.58 507.29 310.17 516.97 297.01 511.59Z"/></svg>`;

/** A data URL keeps the first response self-contained and cache independent. */
export const WORKSPACE_FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(WORKSPACE_FAVICON_SVG)}`;

/**
 * The PWA metadata served by the harness host.  The stock DSH web manifest is
 * a static fallback asset, so it cannot be changed by an index HTML transform;
 * this manifest is registered as the exact same-origin route instead.
 */
export const WORKSPACE_MANIFEST_JSON = JSON.stringify({
  id: "/",
  name: "Univer Workspace Harness",
  short_name: "Univer Workspace",
  start_url: "/",
  scope: "/",
  display: "fullscreen",
  theme_color: "#2563eb",
  background_color: "#ffffff",
  icons: [{
    src: "/favicon.svg",
    sizes: "any",
    type: "image/svg+xml",
    purpose: "any",
  }],
});

/** Canonical icon link emitted into the server-rendered DSH index. */
export const WORKSPACE_FAVICON_LINK = `<link id="uwh-workspace-favicon" rel="icon" type="image/svg+xml" href="${WORKSPACE_FAVICON_DATA_URI}" />`;

const LINK_TAG = /<link\b[^>]*>/giu;
const REL_ATTRIBUTE = /\brel\s*=\s*(["'])(.*?)\1/iu;
const HREF_ATTRIBUTE = /\bhref\s*=\s*(["'])(.*?)\1/iu;

/** Return whether a link tag points at a browser/site icon. */
function isIconLink(tag: string): boolean {
  const rel = REL_ATTRIBUTE.exec(tag)?.[2]
    ?.split(/\s+/u)
    .map((token) => token.toLowerCase())
    .filter(Boolean) ?? [];
  if (rel.some((token) => token === "icon" || token.includes("icon"))) return true;
  return /favicon(?:\.|\/|\?|$)/iu.test(HREF_ATTRIBUTE.exec(tag)?.[2] ?? "");
}

/**
 * Replace every stock DSH icon link with the Workspace mark.
 *
 * The transform is idempotent: repeated index renders produce one canonical
 * link, and pages whose shell does not declare a favicon receive one before
 * `</head>` (or at the beginning of a headless fixture).
 */
export function rewriteHarnessIndexFavicon(html: string): string {
  let found = false;
  let rewritten = html.replace(LINK_TAG, (tag) => {
    if (!isIconLink(tag)) return tag;
    if (found) return "";
    found = true;
    return WORKSPACE_FAVICON_LINK;
  });

  if (!found) {
    const closeHead = /<\/head\s*>/iu.exec(rewritten);
    if (closeHead === null) rewritten = `${WORKSPACE_FAVICON_LINK}${rewritten}`;
    else rewritten = `${rewritten.slice(0, closeHead.index)}${WORKSPACE_FAVICON_LINK}${rewritten.slice(closeHead.index)}`;
  }
  return rewritten;
}
