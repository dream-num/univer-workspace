/** Holds the claim code of the handoff link a signed-out browser opened last. The cookie grants nothing by itself: every request looks the code up. */
export const HANDOFF_COOKIE = "workspace_handoff";

const HANDOFF_CODE = new RegExp(`(?:^|;\\s*)${HANDOFF_COOKIE}=([A-Za-z0-9_-]{22})\\s*(?:;|$)`, "u");

export function readHandoffCode(cookieHeader: string | undefined): string | null {
  return HANDOFF_CODE.exec(cookieHeader ?? "")?.[1] ?? null;
}
