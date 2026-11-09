export function isAccessTokenExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && expiresAt < now;
}
