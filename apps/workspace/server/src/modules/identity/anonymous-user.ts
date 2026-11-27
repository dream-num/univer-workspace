/** Reserved read-only identity. Real Users use UUIDs; this ID is never persisted. */
export const ANONYMOUS_USER_ID = "workspace:anonymous";

export const PREVIEW_READER_PREFIX = "workspace:preview:";

export function previewReaderId(agentUserId: string): string {
  return `${PREVIEW_READER_PREFIX}${agentUserId}`;
}

/** Holds no membership, grant or ownership, and nothing may be written in its name. */
export function isUserlessReader(userId: string): boolean {
  return userId === ANONYMOUS_USER_ID || userId.startsWith(PREVIEW_READER_PREFIX);
}
