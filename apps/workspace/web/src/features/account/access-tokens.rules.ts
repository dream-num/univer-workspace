export function isAccessTokenExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && expiresAt < now;
}

/** Counts code points like the server, so 100 emoji fit where 100 UTF-16 units would not. */
export function isAccessTokenName(name: string): boolean {
  const length = [...name.trim()].length;
  return length > 0 && length <= 100;
}
