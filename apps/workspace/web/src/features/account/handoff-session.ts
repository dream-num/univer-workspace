export const HANDOFF_CLAIM_STORAGE_KEY = "univer-workspace-handoff-claim";

export function readHandoffClaim(): { code: string } | undefined {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_CLAIM_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "code" in parsed &&
      typeof parsed.code === "string" &&
      parsed.code.length > 0
    ) {
      return { code: parsed.code };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeHandoffClaim(code: string): void {
  try {
    window.sessionStorage.setItem(HANDOFF_CLAIM_STORAGE_KEY, JSON.stringify({ code }));
  } catch {
    // Tab storage may be unavailable.
  }
}

export function clearHandoffClaim(): void {
  try {
    window.sessionStorage.removeItem(HANDOFF_CLAIM_STORAGE_KEY);
  } catch {
    // Tab storage may be unavailable.
  }
}
