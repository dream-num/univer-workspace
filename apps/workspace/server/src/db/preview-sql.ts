import { PREVIEW_READER_PREFIX } from "../modules/identity/anonymous-user.js";

function temporaryAgentSql(ownerUserId: string): string {
  return `EXISTS (
    SELECT 1 FROM agents
    WHERE agents.user_id = ${ownerUserId} AND agents.owner_user_id IS NULL AND agents.banned_at IS NULL
  )`;
}

/** Rechecking the agent here ends a preview with the write that claims it. */
export function previewedSql(ownerUserId: string, userId = "$userId"): string {
  return `(${userId} = '${PREVIEW_READER_PREFIX}' || ${ownerUserId} AND ${temporaryAgentSql(ownerUserId)})`;
}

/**
 * A temporary agent's file is open to whoever holds its link. A folder has no Resource and stays
 * closed, so one link never lists the others. A claim ends this in the write that sets the owner.
 */
export function linkViewableSql(ownerUserId: string, nodeId: string): string {
  return `(${temporaryAgentSql(ownerUserId)} AND EXISTS (SELECT 1 FROM resources WHERE resources.node_id = ${nodeId}))`;
}
