import { SIGN_IN_CODE_PRUNE_BATCH, type SignInCode } from "../modules/identity/identity.repository.js";

/** The statements of `putSignInCode` and the other `sign_in_codes` reads and writes, the same on SQLite and PostgreSQL. */
export const signInCodeSql = {
  prune: `DELETE FROM sign_in_codes WHERE kind = ?1 AND code_hash IN (
    SELECT code_hash FROM sign_in_codes WHERE kind = ?1 AND expires_at <= ?2 ORDER BY expires_at LIMIT ${SIGN_IN_CODE_PRUNE_BATCH})`,
  evictOldestOfSubject: `DELETE FROM sign_in_codes WHERE kind = ?1 AND subject_user_id = ?2 AND expires_at > ?3 AND code_hash NOT IN (
    SELECT code_hash FROM sign_in_codes WHERE kind = ?1 AND subject_user_id = ?2 AND expires_at > ?3
    ORDER BY created_at DESC, code_hash LIMIT ?4)`,
  countPending: "SELECT COUNT(*) AS count FROM sign_in_codes WHERE kind = ? AND state = 'pending' AND expires_at > ?",
  insert: `INSERT INTO sign_in_codes (kind, code_hash, user_code_hash, subject_user_id, payload_json, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  find: "SELECT * FROM sign_in_codes WHERE kind = ? AND code_hash = ?",
  findPreviewGrant: `SELECT agents.user_id FROM sign_in_codes JOIN agents ON agents.user_id = sign_in_codes.subject_user_id
    WHERE sign_in_codes.kind = 'claim' AND sign_in_codes.code_hash = ? AND sign_in_codes.expires_at > ?
      AND agents.owner_user_id IS NULL AND agents.banned_at IS NULL`,
  findByUserCode: "SELECT * FROM sign_in_codes WHERE kind = ? AND user_code_hash = ?",
  delete: "DELETE FROM sign_in_codes WHERE kind = ? AND code_hash = ?",
  redeem: `UPDATE sign_in_codes SET state = CASE state WHEN 'pending' THEN 'consumed' ELSE 'replayed' END
    WHERE kind = ? AND code_hash = ? AND (state = 'pending' OR expires_at > ?) RETURNING *`,
  recordGrant: "UPDATE sign_in_codes SET subject_user_id = ?, grant_id = ? WHERE kind = 'oauth_code' AND code_hash = ? RETURNING state",
  approve: "UPDATE sign_in_codes SET subject_user_id = ?1 WHERE kind = 'cli' AND code_hash = ?2 AND (subject_user_id IS NULL OR subject_user_id = ?1)",
  pruneSourceEvents: "DELETE FROM source_rate_events WHERE action = ? AND created_at <= ?",
  countSourceEvents: "SELECT COUNT(*) AS count FROM source_rate_events WHERE action = ? AND source = ? AND created_at > ?",
  insertSourceEvent: "INSERT INTO source_rate_events (id, action, source, created_at) VALUES (?, ?, ?, ?)",
} as const;

export function toSignInCode(row: Record<string, unknown> | undefined): SignInCode | null {
  return row === undefined ? null : {
    kind: row.kind as SignInCode["kind"],
    codeHash: String(row.code_hash),
    userCodeHash: row.user_code_hash as string | null,
    subjectUserId: row.subject_user_id as string | null,
    payload: String(row.payload_json),
    state: row.state as SignInCode["state"],
    grantId: row.grant_id as string | null,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}
