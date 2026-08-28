import { rewriteHarnessIndexFavicon } from "./favicon.ts";

/** Replace the published DSH shell title in the server-rendered index. */
export function rewriteHarnessIndexTitle(html: string): string {
  return html.replace(
    /(<title(?:\s[^>]*)?>)DeepSeek Harness(<\/title>)/iu,
    "$1Univer Workspace Harness$2",
  );
}

/** Replace first-paint DSH branding while retaining the rest of the shell. */
export function rewriteHarnessIndexBranding(html: string): string {
  return rewriteHarnessIndexFavicon(rewriteHarnessIndexTitle(html));
}
