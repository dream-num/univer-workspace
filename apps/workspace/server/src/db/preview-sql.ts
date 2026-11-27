import { PREVIEW_READER_PREFIX } from "../modules/identity/anonymous-user.js";

/**
 * True when `userId` is the preview reader of the agent that owns the Space, and that agent still has
 * no owner and is not banned. Rechecking the agent here ends a preview with the write that claims it.
 */
export function previewedSql(ownerUserId: string, userId = "$userId"): string {
  return `(${userId} = '${PREVIEW_READER_PREFIX}' || ${ownerUserId} AND EXISTS (
    SELECT 1 FROM agents
    WHERE agents.user_id = ${ownerUserId} AND agents.owner_user_id IS NULL AND agents.banned_at IS NULL
  ))`;
}
