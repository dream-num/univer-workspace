const KEY = "html-view-preview-trust-v1";

type Trusted = Record<string, string[]>;

function read(): Trusted {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Trusted; } catch { return {}; }
}

/** A source is trusted for the Units the user was shown; a page that names another Unit asks again. */
export function trustKey(source: { src?: string | undefined; token?: string | undefined }, fileName: string): string {
  return source.src ? `${source.src}|${source.token}` : `file:${fileName}`;
}

export function isTrusted(key: string, unitIds: readonly string[]): boolean {
  const known = read()[key];
  return !!known && unitIds.every((id) => known.includes(id));
}

export function remember(key: string, unitIds: readonly string[]): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [key]: unitIds })); } catch { /* a blocked store only means asking again */ }
}
