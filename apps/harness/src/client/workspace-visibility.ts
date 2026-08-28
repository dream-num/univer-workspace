/**
 * Browser-side path predicate used by the hash router.
 *
 * Account visibility is decided by the authenticated DSH carrier before a
 * list or downlink reaches this process. The browser therefore consumes the
 * native WorkspaceBrowser/session stores directly; wrapping their `set` seams
 * would create a second projection and break the published synchronous
 * session lifecycle. This small pure helper remains useful for validating a
 * deep link when a session summary includes a working directory.
 */

/** Normalize host path separators and trailing separators for comparison. */
function normalizedPath(path: string): string {
  const value = path.replaceAll("\\", "/");
  if (value === "/") return value;
  return value.replace(/\/+$/u, "");
}

/** True when `candidate` is the account root or one of its descendants. */
export function pathInUserRoot(rootPath: string | undefined, candidate: string | undefined): boolean {
  if (rootPath === undefined || candidate === undefined || candidate === "") return false;
  const root = normalizedPath(rootPath);
  const path = normalizedPath(candidate);
  if (path === root) return true;
  return root === "/" ? path.startsWith("/") : path.startsWith(`${root}/`);
}
