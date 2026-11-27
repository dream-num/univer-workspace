/** Reserved read-only identity. Real Users use UUIDs; this ID is never persisted. */
export const ANONYMOUS_USER_ID = "workspace:anonymous";

/** With an agent's User ID appended, the reader a live handoff link makes of a signed-out visitor. Never persisted. */
export const PREVIEW_READER_PREFIX = "workspace:preview:";

export function previewReaderId(agentUserId: string): string {
  return `${PREVIEW_READER_PREFIX}${agentUserId}`;
}

/** A reader ID that names no Users row: it holds no membership, grant or ownership, and nothing may be written in its name. */
export function isUserlessReader(userId: string): boolean {
  return userId === ANONYMOUS_USER_ID || userId.startsWith(PREVIEW_READER_PREFIX);
}
