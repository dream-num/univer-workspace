const SESSION_KEY = "html-view-preview-trust-v1";
const alwaysKey = (userId: string) => `html-view-preview-trusted-units-v1:${userId}`;

type Store = "sessionStorage" | "localStorage";

// A blocked or garbled store only means asking again.
function read(store: Store, key: string): unknown {
  try { return JSON.parse(window[store].getItem(key) ?? "null"); } catch { return null; }
}
function write(store: Store, key: string, value: unknown): void {
  try { window[store].setItem(key, JSON.stringify(value)); } catch { /* asks again next time */ }
}
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
const sessionTrust = (): Record<string, unknown> => Object(read("sessionStorage", SESSION_KEY));

/** One preview run: the host and its token, or a picked file. "Only this time" lasts for that run. */
export function trustKey(source: { src?: string | undefined; token?: string | undefined }, fileName: string): string {
  return source.src ? `${source.src}|${source.token}` : `file:${fileName}`;
}

/** The Units a page may read without asking: those confirmed for this run, and those this user always trusts. */
export function trustedUnits(key: string, userId: string | undefined): ReadonlySet<string> {
  return new Set([...ids(sessionTrust()[key]), ...(userId ? alwaysTrusted(userId) : [])]);
}

/** Adds to what this run already trusts. Pass only the Units the user was asked about, so forgetting an always-trusted one asks again. */
export function trustForSession(key: string, unitIds: readonly string[]): void {
  const trust = sessionTrust();
  write("sessionStorage", SESSION_KEY, { ...trust, [key]: [...new Set([...ids(trust[key]), ...unitIds])] });
}

/** Kept per user, so another account in this browser starts with nothing trusted. */
export function trustAlways(userId: string, unitIds: readonly string[]): void {
  write("localStorage", alwaysKey(userId), [...new Set([...alwaysTrusted(userId), ...unitIds])]);
}

export function alwaysTrusted(userId: string): string[] {
  return ids(read("localStorage", alwaysKey(userId)));
}

export function forget(userId: string, unitId: string): void {
  write("localStorage", alwaysKey(userId), alwaysTrusted(userId).filter((id) => id !== unitId));
}
