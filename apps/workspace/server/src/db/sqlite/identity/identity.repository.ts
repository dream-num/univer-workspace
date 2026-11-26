import type { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../connection.js";
import type { AuthenticationMethods, ExternalIdentityProvider, User } from "../../../modules/identity/identity.types.js";
import { personalSpaceName } from "../../../modules/identity/display-name.js";
import type { WriteSource } from "../../../modules/identity/write-source.js";
import type {
  StoredPrincipal,
  StoredSession,
  StoredCredential,
  NewPasswordUser,
  NewEmailUser,
  StoredEmailLoginCode,
  EmailLoginCodeLimits,
  EmailLoginCodeCreation,
  ExternalIdentityUser,
  ExecutorAccessEntry,
  IdentityConflict,
  IdentityRepository,
  NamedUser,
  NewSignInCode,
  SignInCode,
  SignInCodeKind,
  SignInCodeLimits,
  SignInCodePut,
  StoredAgent,
} from "../../../modules/identity/identity.repository.js";
import { signInCodeSql, toSignInCode } from "../../sign-in-codes.js";

export class SqliteIdentityRepository implements IdentityRepository {
  constructor(private readonly _database: SqliteDatabase) {}

  async isIdentityConflict(error: unknown, field: IdentityConflict): Promise<boolean> {
    const constraints = { username: "users.username", email: "users.email", externalIdentity: "external_identities" };
    return error instanceof Error && error.message.includes("UNIQUE constraint failed") && error.message.includes(constraints[field]);
  }

  async findUsersByIdOrUsername(target: string): Promise<readonly NamedUser[]> {
    return this._database.connection
      .prepare("SELECT id, username, kind FROM users WHERE id = ? COLLATE NOCASE OR username = ?")
      .all(target, target)
      .map(namedUser);
  }

  async banAgent(agentUserId: string, at: number): Promise<void> {
    this._database.connection.prepare("UPDATE agents SET banned_at = COALESCE(banned_at, ?) WHERE user_id = ?").run(at, agentUserId);
  }

  async findAgents(filter: { readonly userId: string } | { readonly ownerUserId: string }): Promise<readonly StoredAgent[]> {
    // shortcut: no index on agents.owner_user_id, so listing an owner's agents scans the table; add one with the next migration if it grows large.
    const rows = this._database.connection
      .prepare(
        `SELECT users.id, users.username, users.display_name, users.avatar_url,
           spaces.id AS space_id, agents.owner_user_id, agents.origin_label, agents.last_active_at,
           agents.banned_at IS NOT NULL AS banned,
           (SELECT COUNT(*) FROM nodes JOIN resources ON resources.node_id = nodes.id
            WHERE nodes.space_id = spaces.id AND nodes.trash_batch_id IS NULL) AS files
         FROM agents
         JOIN users ON users.id = agents.user_id
         JOIN spaces ON spaces.owner_user_id = agents.user_id AND spaces.type = 'personal'
         WHERE ${"userId" in filter ? "agents.user_id" : "agents.owner_user_id"} = ?
         ORDER BY agents.claimed_at, agents.user_id`
      )
      .all("userId" in filter ? filter.userId : filter.ownerUserId) as unknown as readonly AgentRow[];
    return rows.map(toStoredAgent);
  }

  async claimAgent(agentUserId: string, ownerUserId: string, at: number): Promise<boolean> {
    return this._database.connection
      .prepare(
        `UPDATE agents SET owner_user_id = ?, claimed_at = ?, expires_at = NULL
         WHERE user_id = ? AND owner_user_id IS NULL AND banned_at IS NULL`
      )
      .run(ownerUserId, at, agentUserId).changes > 0;
  }

  async banClaimedAgent(ownerUserId: string, agentUserId: string, at: number): Promise<boolean> {
    return this._database.connection
      .prepare("UPDATE agents SET banned_at = COALESCE(banned_at, ?) WHERE user_id = ? AND owner_user_id = ?")
      .run(at, agentUserId, ownerUserId).changes > 0;
  }

  async setExecutorAccess(userId: string, granted: boolean, at: number): Promise<boolean> {
    const db = this._database.connection;
    const { changes } = granted
      ? db.prepare("INSERT INTO executor_access (user_id, granted_at) VALUES (?, ?) ON CONFLICT DO NOTHING").run(userId, at)
      : db.prepare("DELETE FROM executor_access WHERE user_id = ?").run(userId);
    return changes > 0;
  }

  async hasExecutorAccess(userId: string): Promise<boolean> {
    return Boolean(this._database.connection.prepare("SELECT 1 FROM executor_access WHERE user_id = ?").get(userId));
  }

  async listExecutorAccess(): Promise<readonly ExecutorAccessEntry[]> {
    return this._database.connection.prepare(
      "SELECT u.id, u.username, u.kind, e.granted_at FROM executor_access e JOIN users u ON u.id = e.user_id ORDER BY e.granted_at, u.id"
    ).all().map((row) => ({ ...namedUser(row), grantedAt: Number(row.granted_at) }));
  }

  async createPasswordUser(input: NewPasswordUser): Promise<void> {
    this._database.transaction((database) => {
      database
        .prepare(
          `INSERT INTO users
            (id, username, display_name, avatar_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.user.id,
          input.user.username,
          input.user.displayName,
          input.user.avatarUrl,
          input.createdAt,
          input.createdAt
        );
      database
        .prepare(
          `INSERT INTO password_credentials
            (user_id, password_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          input.user.id,
          input.passwordHash,
          input.createdAt,
          input.createdAt
        );
      database
        .prepare(
          `INSERT INTO spaces
            (id, type, name, owner_user_id, created_at, updated_at)
           VALUES (?, 'personal', ?, ?, ?, ?)`
        )
        .run(
          input.personalSpace.id,
          input.personalSpace.name,
          input.user.id,
          input.createdAt,
          input.createdAt
        );
      insertSession(database, input.user.id, input.session);
    });
  }

  async createExternalUser(input: {
    readonly provider: ExternalIdentityProvider;
    readonly user: User;
    readonly providerSubject: string;
    readonly providerUsername: string;
    readonly personalSpace: NewPasswordUser["personalSpace"];
    readonly session: NewPasswordUser["session"];
    readonly createdAt: number;
  }): Promise<void> {
    this._database.transaction((database) => {
      database
        .prepare(
          `INSERT INTO users
            (id, username, display_name, avatar_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.user.id,
          input.user.username,
          input.user.displayName,
          input.user.avatarUrl,
          input.createdAt,
          input.createdAt
        );
      database
        .prepare(
          `INSERT INTO external_identities
            (
              provider, provider_subject, user_id, provider_username,
              created_at, updated_at
            )
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.provider,
          input.providerSubject,
          input.user.id,
          input.providerUsername,
          input.createdAt,
          input.createdAt
        );
      database
        .prepare(
          `INSERT INTO spaces
            (id, type, name, owner_user_id, created_at, updated_at)
           VALUES (?, 'personal', ?, ?, ?, ?)`
        )
        .run(
          input.personalSpace.id,
          input.personalSpace.name,
          input.user.id,
          input.createdAt,
          input.createdAt
        );
      insertSession(database, input.user.id, input.session);
    });
  }

  async createEmailUser(input: NewEmailUser): Promise<void> {
    this._database.transaction((database) => {
      database
        .prepare(
          `INSERT INTO users
            (id, username, display_name, avatar_url, created_at, updated_at, email)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.user.id,
          input.user.username,
          input.user.displayName,
          input.user.avatarUrl,
          input.createdAt,
          input.createdAt,
          input.email
        );
      database
        .prepare(
          `INSERT INTO spaces
            (id, type, name, owner_user_id, created_at, updated_at)
           VALUES (?, 'personal', ?, ?, ?, ?)`
        )
        .run(
          input.personalSpace.id,
          input.personalSpace.name,
          input.user.id,
          input.createdAt,
          input.createdAt
        );
      insertSession(database, input.user.id, input.session);
    });
  }

  /** Unlike the sign-in paths, an agent is created without a Session; its caller issues the credential. */
  async createAgentUser(input: {
    readonly user: User;
    readonly personalSpace: NewPasswordUser["personalSpace"];
    readonly originLabel: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): Promise<void> {
    this._database.transaction((database) => {
      database
        .prepare(
          `INSERT INTO users
            (id, username, display_name, avatar_url, created_at, updated_at, kind)
           VALUES (?, ?, ?, ?, ?, ?, 'agent')`
        )
        .run(
          input.user.id,
          input.user.username,
          input.user.displayName,
          input.user.avatarUrl,
          input.createdAt,
          input.createdAt
        );
      database
        .prepare(
          `INSERT INTO spaces
            (id, type, name, owner_user_id, created_at, updated_at)
           VALUES (?, 'personal', ?, ?, ?, ?)`
        )
        .run(
          input.personalSpace.id,
          input.personalSpace.name,
          input.user.id,
          input.createdAt,
          input.createdAt
        );
      database
        .prepare(
          `INSERT INTO agents
            (user_id, origin_label, created_at, last_active_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          input.user.id,
          input.originLabel,
          input.createdAt,
          input.createdAt,
          input.expiresAt
        );
    });
  }

  async findExternalIdentity(
    provider: ExternalIdentityProvider,
    providerSubject: string
  ): Promise<ExternalIdentityUser | null> {
    const row = this._database.connection
      .prepare(
        `SELECT
           users.id,
           users.username,
           users.display_name,
           users.avatar_url,
           external_identities.provider_username
         FROM external_identities
         JOIN users ON users.id = external_identities.user_id
         WHERE external_identities.provider = ?
           AND external_identities.provider_subject = ?`
      )
      .get(provider, providerSubject) as
      | (UserRow & { readonly provider_username: string })
      | undefined;
    return row
      ? {
          user: toUser(row),
          providerUsername: row.provider_username,
        }
      : null;
  }

  async linkExternalIdentity(input: {
    readonly provider: ExternalIdentityProvider;
    readonly userId: string;
    readonly providerSubject: string;
    readonly providerUsername: string;
    readonly updatedAt: number;
  }): Promise<void> {
    this._database.connection
      .prepare(
        `INSERT INTO external_identities
          (
            provider, provider_subject, user_id, provider_username,
            created_at, updated_at
          )
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, provider)
         DO UPDATE SET
           provider_subject = excluded.provider_subject,
           provider_username = excluded.provider_username,
           updated_at = excluded.updated_at`
      )
      .run(
        input.provider,
        input.providerSubject,
        input.userId,
        input.providerUsername,
        input.updatedAt,
        input.updatedAt
      );
  }

  async updateExternalUsername(
    provider: ExternalIdentityProvider,
    providerSubject: string,
    providerUsername: string,
    updatedAt: number
  ): Promise<void> {
    this._database.connection
      .prepare(
        `UPDATE external_identities
         SET provider_username = ?, updated_at = ?
         WHERE provider = ? AND provider_subject = ?`
      )
      .run(providerUsername, updatedAt, provider, providerSubject);
  }

  async removeExternalIdentity(userId: string, provider: ExternalIdentityProvider, passwordAuthEnabled: boolean): Promise<boolean> {
    return this._database.transaction((db) => {
      const hasAnotherMethod = db.prepare(`
        SELECT 1 FROM external_identities WHERE user_id = ? AND provider <> ?
        UNION ALL SELECT 1 FROM password_credentials WHERE user_id = ? AND ? = 1
        LIMIT 1
      `).get(userId, provider, userId, Number(passwordAuthEnabled));
      if (!hasAnotherMethod) {
        return !db.prepare("SELECT 1 FROM external_identities WHERE user_id = ? AND provider = ?").get(userId, provider);
      }
      db.prepare("DELETE FROM external_identities WHERE user_id = ? AND provider = ?").run(userId, provider);
      return true;
    });
  }

  async usernameExists(username: string): Promise<boolean> {
    return Boolean(
      this._database.connection
        .prepare(
          "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE"
        )
        .get(username)
    );
  }

  async findUser(userId: string): Promise<User | null> {
    const row = this._database.connection
      .prepare(
        `SELECT id, username, display_name, avatar_url
         FROM users WHERE id = ?`
      )
      .get(userId) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  async findPrincipal(userId: string): Promise<StoredPrincipal | null> {
    return findPrincipal(this._database.connection, userId);
  }

  /**
   * Records activity of the agent that is `userId`, or of the unclaimed agent that owns the Space of
   * `nodeId`, and pushes out an unclaimed agent's expiry. It reads first, so an agent already seen
   * since `staleBefore` costs no write. An agent that has already expired is always pushed out, so
   * its next use brings it back.
   */
  async touchAgent(
    target: { readonly userId: string } | { readonly nodeId: string },
    at: number,
    staleBefore: number,
    expiresAt: number
  ): Promise<void> {
    touchAgent(this._database.connection, target, at, staleBefore, expiresAt);
  }

  async findUsers(userIds: readonly string[]): Promise<readonly User[]> {
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0) return [];
    const users = new Map<string, User>();
    for (let offset = 0; offset < uniqueUserIds.length; offset += 500) {
      const batch = uniqueUserIds.slice(offset, offset + 500);
      const placeholders = batch.map(() => "?").join(", ");
      const rows = this._database.connection
        .prepare(
          `SELECT id, username, display_name, avatar_url
           FROM users WHERE id IN (${placeholders})`
        )
        .all(...batch) as unknown as readonly UserRow[];
      for (const row of rows) {
        const user = toUser(row);
        users.set(user.id, user);
      }
    }
    return uniqueUserIds.flatMap((userId) => {
      const user = users.get(userId);
      return user ? [user] : [];
    });
  }

  async findCredential(username: string): Promise<StoredCredential | null> {
    const row = this._database.connection
      .prepare(
        `SELECT
           users.id,
           users.username,
           users.display_name,
           users.avatar_url,
           password_credentials.password_hash
         FROM users
         JOIN password_credentials
           ON password_credentials.user_id = users.id
         WHERE users.username = ? COLLATE NOCASE`
      )
      .get(username) as CredentialRow | undefined;
    return row
      ? {
          ...toUser(row),
          passwordHash: row.password_hash,
        }
      : null;
  }

  async findCredentialByUserId(userId: string): Promise<StoredCredential | null> {
    const row = this._database.connection
      .prepare(
        `SELECT
           users.id,
           users.username,
           users.display_name,
           users.avatar_url,
           password_credentials.password_hash
         FROM users
         JOIN password_credentials
           ON password_credentials.user_id = users.id
         WHERE users.id = ?`
      )
      .get(userId) as CredentialRow | undefined;
    return row
      ? {
          ...toUser(row),
          passwordHash: row.password_hash,
        }
      : null;
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
    updatedAt: number,
    keepSessionId: string
  ): Promise<string[]> {
    return this._database.transaction((database) => {
      database
        .prepare(
          `UPDATE password_credentials
           SET password_hash = ?, updated_at = ?
           WHERE user_id = ?`
        )
        .run(passwordHash, updatedAt, userId);
      return database
        .prepare(
          `DELETE FROM login_sessions
           WHERE user_id = ? AND id <> ? AND write_source = 'agent'
             AND issued_for_pat_id IS NULL AND issued_for_grant_id IS NULL
           RETURNING id`
        )
        .all(userId, keepSessionId)
        .map((row) => String(row.id));
    });
  }

  async createSession(
    userId: string,
    session: NewPasswordUser["session"]
  ): Promise<void> {
    insertSession(this._database.connection, userId, session);
  }

  async findSession(sessionId: string): Promise<StoredSession | null> {
    const row = this._database.connection
      .prepare(
        `SELECT
           login_sessions.id AS session_id,
           login_sessions.secret_hash,
           login_sessions.expires_at,
           login_sessions.write_source,
           login_sessions.issued_for_pat_id IS NOT NULL
             OR login_sessions.issued_for_grant_id IS NOT NULL AS token_issued,
           users.id,
           users.username,
           users.display_name,
           users.avatar_url,
           ${principalColumns}
         FROM login_sessions
         JOIN users ON users.id = login_sessions.user_id
         ${agentJoin}
         WHERE login_sessions.id = ?`
      )
      .get(sessionId) as SessionRow | undefined;
    return row
      ? {
          ...toPrincipal(row),
          sessionId: row.session_id,
          secretHash: row.secret_hash,
          expiresAt: row.expires_at,
          writeSource: row.write_source,
          tokenIssued: row.token_issued === 1,
        }
      : null;
  }

  async authenticationMethods(userId: string): Promise<AuthenticationMethods> {
    const password = Boolean(
      this._database.connection
        .prepare("SELECT 1 FROM password_credentials WHERE user_id = ?")
        .get(userId)
    );
    const emailRow = this._database.connection
      .prepare("SELECT email FROM users WHERE id = ?")
      .get(userId) as { readonly email: string | null } | undefined;
    const rows = this._database.connection
      .prepare(
        `SELECT provider, provider_username
         FROM external_identities
         WHERE user_id = ?
         ORDER BY provider`
      )
      .all(userId) as unknown as ExternalIdentityRow[];
    return {
      password,
      email: emailRow?.email ?? null,
      externalIdentities: rows.map((row) => ({
        provider: row.provider,
        providerUsername: row.provider_username,
      })),
    };
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const row = this._database.connection
      .prepare(
        `SELECT id, username, display_name, avatar_url
         FROM users
         WHERE email = ? COLLATE NOCASE`
      )
      .get(email) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  async createEmailLoginCode(input: {
    readonly id: string;
    readonly email: string;
    readonly codeHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }, limits: EmailLoginCodeLimits): Promise<EmailLoginCodeCreation> {
    return this._database.transaction((database) => {
      const recent = database
        .prepare(
          `SELECT MAX(created_at) AS latest, COUNT(*) AS count
           FROM email_login_codes
           WHERE email = ? COLLATE NOCASE AND created_at > ?`
        )
        .get(input.email, limits.windowSince) as { readonly latest: number | null; readonly count: number };
      if (recent.latest !== null && recent.latest > limits.recentSince) return "sent-recently";
      if (recent.count >= limits.windowLimit) return "too-many";
      database
        .prepare(
          `INSERT INTO email_login_codes
            (id, email, code_hash, attempts, created_at, expires_at)
           VALUES (?, ?, ?, 0, ?, ?)`
        )
        .run(
          input.id,
          input.email,
          input.codeHash,
          input.createdAt,
          input.expiresAt
        );
      return "created";
    });
  }

  async findEmailLoginCode(
    email: string,
    now: number
  ): Promise<StoredEmailLoginCode | null> {
    const row = this._database.connection
      .prepare(
        `SELECT id, code_hash
         FROM email_login_codes
         WHERE email = ? COLLATE NOCASE
           AND consumed_at IS NULL
           AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(email, now) as EmailLoginCodeRow | undefined;
    return row ? { id: row.id, codeHash: row.code_hash } : null;
  }

  async reserveEmailLoginCodeAttempt(id: string, maxAttempts: number): Promise<boolean> {
    const result = this._database.connection
      .prepare(
        `UPDATE email_login_codes SET attempts = attempts + 1
         WHERE id = ? AND attempts < ?`
      )
      .run(id, maxAttempts);
    return Number(result.changes) > 0;
  }

  async consumeEmailLoginCode(id: string, consumedAt: number): Promise<boolean> {
    const result = this._database.connection
      .prepare(
        `UPDATE email_login_codes
         SET consumed_at = ?
         WHERE id = ? AND consumed_at IS NULL`
      )
      .run(consumedAt, id);
    return Number(result.changes) > 0;
  }

  async consumeOtherEmailLoginCodes(
    email: string,
    keepId: string,
    consumedAt: number
  ): Promise<void> {
    this._database.connection
      .prepare(
        `UPDATE email_login_codes
         SET consumed_at = ?
         WHERE email = ? COLLATE NOCASE
           AND id <> ?
           AND consumed_at IS NULL`
      )
      .run(consumedAt, email, keepId);
  }

  async deleteEmailLoginCode(id: string): Promise<void> {
    this._database.connection
      .prepare("DELETE FROM email_login_codes WHERE id = ?")
      .run(id);
  }

  async deleteEmailLoginCodesBefore(cutoff: number): Promise<void> {
    this._database.connection
      .prepare("DELETE FROM email_login_codes WHERE created_at <= ?")
      .run(cutoff);
  }

  async takeSourceEvent(event: {
    readonly id: string;
    readonly action: string;
    readonly source: string;
    readonly createdAt: number;
  }, since: number, limit: number): Promise<boolean> {
    return this._database.transaction((database) => {
      database.prepare("DELETE FROM source_rate_events WHERE created_at <= ?").run(since);
      return database
        .prepare(
          `INSERT INTO source_rate_events (id, action, source, created_at)
           SELECT ?, ?, ?, ?
           WHERE (SELECT COUNT(*) FROM source_rate_events WHERE action = ? AND source = ? AND created_at > ?) < ?`
        )
        .run(event.id, event.action, event.source, event.createdAt, event.action, event.source, since, limit).changes > 0;
    });
  }

  async countSourceEvents(action: string, source: string, since: number): Promise<number> {
    return (this._database.connection
      .prepare("SELECT COUNT(*) AS count FROM source_rate_events WHERE action = ? AND source = ? AND created_at > ?")
      .get(action, source, since) as { readonly count: number }).count;
  }

  async putSignInCode(code: NewSignInCode, limits: SignInCodeLimits): Promise<SignInCodePut> {
    return this._database.transaction((database) => {
      database.prepare(signInCodeSql.prune).run(code.kind, limits.expiredBefore);
      const share = limits.perSource;
      if (share !== undefined) {
        const { action, source } = share.event;
        database.prepare(signInCodeSql.pruneSourceEvents).run(action, share.since);
        const { count } = database.prepare(signInCodeSql.countSourceEvents).get(action, source, share.since) as { readonly count: number };
        if (count >= share.limit) return "source-full";
      }
      if (limits.perSubject !== undefined) {
        database.prepare(signInCodeSql.evictOldestOfSubject).run(code.kind, code.subjectUserId, code.createdAt, limits.perSubject - 1);
      }
      if (limits.capacity !== undefined) {
        const { count } = database.prepare(signInCodeSql.countPending).get(code.kind, code.createdAt) as { readonly count: number };
        if (count >= limits.capacity) return "full";
      }
      if (database.prepare(signInCodeSql.insert)
        .run(code.kind, code.codeHash, code.userCodeHash, code.subjectUserId, code.payload, code.createdAt, code.expiresAt).changes === 0) return "duplicate";
      if (share !== undefined) {
        const { id, action, source, createdAt } = share.event;
        database.prepare(signInCodeSql.insertSourceEvent).run(id, action, source, createdAt);
      }
      return "stored";
    });
  }

  async findSignInCode(kind: SignInCodeKind, hash: string, by?: "user_code_hash"): Promise<SignInCode | null> {
    return toSignInCode(this._database.connection.prepare(by ? signInCodeSql.findByUserCode : signInCodeSql.find).get(kind, hash));
  }

  async deleteSignInCode(kind: SignInCodeKind, codeHash: string): Promise<boolean> {
    return this._database.connection.prepare(signInCodeSql.delete).run(kind, codeHash).changes > 0;
  }

  async redeemSignInCode(kind: SignInCodeKind, codeHash: string, now: number): Promise<SignInCode | null> {
    return toSignInCode(this._database.connection.prepare(signInCodeSql.redeem).get(kind, codeHash, now));
  }

  async recordSignInGrant(codeHash: string, userId: string, grantId: string): Promise<boolean> {
    return this._database.connection.prepare(signInCodeSql.recordGrant).get(userId, grantId, codeHash)?.state === "replayed";
  }

  async approveSignInCode(codeHash: string, userId: string): Promise<boolean> {
    return this._database.connection.prepare(signInCodeSql.approve).run(userId, codeHash).changes > 0;
  }

  async updateUser(userId: string, patch: Partial<Omit<User, "id">>, updatedAt: number, expected?: User): Promise<User> {
    const fields = ["updated_at = ?"];
    const values: (string | number | null)[] = [updatedAt];
    for (const [key, column] of [["username", "username"], ["displayName", "display_name"], ["avatarUrl", "avatar_url"]] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (expected) {
        fields.push(`${column} = CASE WHEN ${column} COLLATE BINARY IS ? THEN ? ELSE ${column} END`);
        values.push(expected[key], value);
      } else {
        fields.push(`${column} = ?`);
        values.push(value);
      }
    }
    return this._database.transaction((database) => {
      const before = database.prepare("SELECT display_name FROM users WHERE id = ?").get(userId) as Pick<UserRow, "display_name"> | undefined;
      const row = database.prepare(`
        UPDATE users SET ${fields.join(", ")} WHERE id = ? RETURNING id, username, display_name, avatar_url
      `).get(...values, userId) as UserRow | undefined;
      if (!before || !row) throw new Error("Authenticated user is missing.");
      if (row.display_name !== before.display_name) {
        database.prepare("UPDATE spaces SET name = ?, updated_at = ? WHERE owner_user_id = ? AND type = 'personal' AND name = ?")
          .run(personalSpaceName(row.display_name), updatedAt, userId, personalSpaceName(before.display_name));
      }
      return toUser(row);
    });
  }

  async renewSession(sessionId: string, expiresAt: number): Promise<void> {
    this._database.connection
      .prepare("UPDATE login_sessions SET expires_at = ? WHERE id = ?")
      .run(expiresAt, sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this._database.connection
      .prepare("DELETE FROM login_sessions WHERE id = ?")
      .run(sessionId);
  }

  async deleteExpiredSessions(now: number): Promise<string[]> {
    return this._database.connection
      .prepare("DELETE FROM login_sessions WHERE expires_at <= ? RETURNING id")
      .all(now)
      .map((row) => String(row.id));
  }
}

interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
}

interface CredentialRow extends UserRow {
  readonly password_hash: string;
}

interface PrincipalRow extends UserRow {
  readonly kind: "human" | "agent";
  readonly claimed: number;
  readonly banned: number;
}

const principalColumns = `users.kind,
  agents.owner_user_id IS NOT NULL AS claimed,
  agents.banned_at IS NOT NULL AS banned`;

const agentJoin = "LEFT JOIN agents ON agents.user_id = users.id";

interface SessionRow extends PrincipalRow {
  readonly write_source: WriteSource | null;
  readonly token_issued: number;
  readonly session_id: string;
  readonly secret_hash: string;
  readonly expires_at: number;
}

interface ExternalIdentityRow {
  readonly provider: ExternalIdentityProvider;
  readonly provider_username: string;
}

interface EmailLoginCodeRow {
  readonly id: string;
  readonly code_hash: string;
}

export function findPrincipal(
  db: DatabaseSync,
  userId: string,
): StoredPrincipal | null {
  const row = db
    .prepare(
      `SELECT users.id, users.username, users.display_name, users.avatar_url, ${principalColumns}
       FROM users ${agentJoin}
       WHERE users.id = ?`
    )
    .get(userId) as PrincipalRow | undefined;
  return row ? toPrincipal(row) : null;
}

export function touchAgent(
  db: DatabaseSync,
  target: Parameters<IdentityRepository["touchAgent"]>[0],
  at: number,
  staleBefore: number,
  expiresAt: number,
): void {
  const stale = db
    .prepare(
      `SELECT user_id FROM agents
       WHERE (last_active_at <= ? OR expires_at <= ?)
         AND ${
           "userId" in target
             ? "user_id = ?"
             : `owner_user_id IS NULL AND user_id = (SELECT spaces.owner_user_id FROM nodes
                 JOIN spaces ON spaces.id = nodes.space_id WHERE nodes.id = ?)`
         }`
    )
    .get(staleBefore, at, "userId" in target ? target.userId : target.nodeId) as
    | { readonly user_id: string }
    | undefined;
  if (!stale) return;
  db
    .prepare(
      "UPDATE agents SET last_active_at = ?, expires_at = CASE WHEN owner_user_id IS NULL THEN ? END WHERE user_id = ?"
    )
    .run(at, expiresAt, stale.user_id);
}

export function insertSession(
  database: DatabaseSync,
  userId: string,
  session: NewPasswordUser["session"]
): void {
  database
    .prepare(
      `INSERT INTO login_sessions
        (id, secret_hash, user_id, created_at, expires_at, write_source,
         issued_for_pat_id, issued_for_grant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      session.id,
      session.secretHash,
      userId,
      session.createdAt,
      session.expiresAt,
      session.writeSource,
      session.issuedFor?.kind === "pat" ? session.issuedFor.id : null,
      session.issuedFor?.kind === "oauth" ? session.issuedFor.id : null
    );
}

function toPrincipal(row: PrincipalRow): StoredPrincipal {
  return {
    ...toUser(row),
    ...(row.kind === "agent"
      ? { kind: "agent", claimed: row.claimed === 1 }
      : { kind: "human" }),
    banned: row.banned === 1,
  };
}

function namedUser(row: Record<string, unknown>): NamedUser {
  return { id: String(row.id), username: String(row.username), kind: row.kind === "agent" ? "agent" : "human" };
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

interface AgentRow extends UserRow {
  readonly space_id: string;
  readonly owner_user_id: string | null;
  readonly origin_label: string;
  readonly last_active_at: number;
  readonly banned: 0 | 1;
  readonly files: number;
}

function toStoredAgent(row: AgentRow): StoredAgent {
  return {
    user: toUser(row),
    spaceId: row.space_id,
    ownerUserId: row.owner_user_id,
    originLabel: row.origin_label,
    lastActiveAt: row.last_active_at,
    banned: row.banned === 1,
    files: row.files,
  };
}
