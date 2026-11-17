import type { PostgresDatabase } from "../connection.js";
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
  ExternalIdentityUser,
  ExecutorAccessEntry,
  IdentityConflict,
  IdentityRepository,
  NamedUser,
  StoredAgent,
} from "../../../modules/identity/identity.repository.js";

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly _database: PostgresDatabase) {}

  async isIdentityConflict(error: unknown, field: IdentityConflict): Promise<boolean> {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "23505" || !("constraint" in error)) return false;
    if (field === "externalIdentity") return String(error.constraint).startsWith("external_identities_");
    return error.constraint === (field === "username" ? "users_username" : "users_email");
  }

  async findUsersByIdOrUsername(target: string): Promise<readonly NamedUser[]> {
    const rows = await this._database
      .prepare("SELECT id, username, kind FROM users WHERE lower(id COLLATE \"C\") = lower(?::text COLLATE \"C\") OR lower(username COLLATE \"C\") = lower(?::text COLLATE \"C\")")
      .all(target, target);
    return rows.map(namedUser);
  }

  async banAgent(agentUserId: string, at: number): Promise<void> {
    await this._database.prepare("UPDATE agents SET banned_at = COALESCE(banned_at, ?) WHERE user_id = ?").run(at, agentUserId);
  }

  async findAgents(filter: { readonly userId: string } | { readonly ownerUserId: string }): Promise<readonly StoredAgent[]> {
    // shortcut: no index on agents.owner_user_id, so listing an owner's agents scans the table; add one with the next migration if it grows large.
    const rows = await this._database
      .prepare(
        `SELECT users.id, users.username, users.display_name, users.avatar_url,
           spaces.id AS space_id, agents.owner_user_id, agents.last_active_at,
           agents.banned_at IS NOT NULL AS banned,
           (SELECT COUNT(*) FROM nodes JOIN resources ON resources.node_id = nodes.id
            WHERE nodes.space_id = spaces.id AND nodes.trash_batch_id IS NULL) AS files
         FROM agents
         JOIN users ON users.id = agents.user_id
         JOIN spaces ON spaces.owner_user_id = agents.user_id AND spaces.type = 'personal'
         WHERE ${"userId" in filter ? "agents.user_id" : "agents.owner_user_id"} = ?
         ORDER BY agents.claimed_at, agents.user_id COLLATE "C"`
      )
      .all("userId" in filter ? filter.userId : filter.ownerUserId) as unknown as readonly AgentRow[];
    return rows.map(toStoredAgent);
  }

  async claimAgent(agentUserId: string, ownerUserId: string, at: number): Promise<boolean> {
    const result = await this._database
      .prepare(
        `UPDATE agents SET owner_user_id = ?, claimed_at = ?, expires_at = NULL
         WHERE user_id = ? AND owner_user_id IS NULL AND banned_at IS NULL`
      )
      .run(ownerUserId, at, agentUserId);
    return result.changes > 0;
  }

  async banClaimedAgent(ownerUserId: string, agentUserId: string, at: number): Promise<boolean> {
    const result = await this._database
      .prepare("UPDATE agents SET banned_at = COALESCE(banned_at, ?) WHERE user_id = ? AND owner_user_id = ?")
      .run(at, agentUserId, ownerUserId);
    return result.changes > 0;
  }

  async setExecutorAccess(userId: string, granted: boolean, at: number): Promise<boolean> {
    const { changes } = granted
      ? await this._database.prepare("INSERT INTO executor_access (user_id, granted_at) VALUES (?, ?) ON CONFLICT DO NOTHING").run(userId, at)
      : await this._database.prepare("DELETE FROM executor_access WHERE user_id = ?").run(userId);
    return changes > 0;
  }

  async hasExecutorAccess(userId: string): Promise<boolean> {
    return Boolean(await this._database.prepare("SELECT 1 FROM executor_access WHERE user_id = ?").get(userId));
  }

  async listExecutorAccess(): Promise<readonly ExecutorAccessEntry[]> {
    const rows = await this._database.prepare(
      "SELECT u.id, u.username, u.kind, e.granted_at FROM executor_access e JOIN users u ON u.id = e.user_id ORDER BY e.granted_at, u.id"
    ).all();
    return rows.map((row) => ({ ...namedUser(row), grantedAt: Number(row.granted_at) }));
  }

  async createPasswordUser(input: NewPasswordUser): Promise<void> {
    await this._database.transaction(async (database) => {
      await database
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
      await database
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
      await database
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
      await insertSession(database, input.user.id, input.session);
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
    await this._database.transaction(async (database) => {
      await database
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
      await database
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
      await database
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
      await insertSession(database, input.user.id, input.session);
    });
  }

  async createEmailUser(input: NewEmailUser): Promise<void> {
    await this._database.transaction(async (database) => {
      await database
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
      await database
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
      await insertSession(database, input.user.id, input.session);
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
    await this._database.transaction(async (database) => {
      await database
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
      await database
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
      await database
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
    const row = await this._database
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
    await this._database
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
    await this._database
      .prepare(
        `UPDATE external_identities
         SET provider_username = ?, updated_at = ?
         WHERE provider = ? AND provider_subject = ?`
      )
      .run(providerUsername, updatedAt, provider, providerSubject);
  }

  async removeExternalIdentity(userId: string, provider: ExternalIdentityProvider, passwordAuthEnabled: boolean): Promise<boolean> {
    return await this._database.transaction(async (db) => {
      const hasAnotherMethod = await db.prepare(`
        SELECT 1 FROM external_identities WHERE user_id = ? AND provider <> ?
        UNION ALL SELECT 1 FROM password_credentials WHERE user_id = ? AND ? = 1
        LIMIT 1
      `).get(userId, provider, userId, Number(passwordAuthEnabled));
      if (!hasAnotherMethod) {
        return !await db.prepare("SELECT 1 FROM external_identities WHERE user_id = ? AND provider = ?").get(userId, provider);
      }
      await db.prepare("DELETE FROM external_identities WHERE user_id = ? AND provider = ?").run(userId, provider);
      return true;
    });
  }

  async usernameExists(username: string): Promise<boolean> {
    return Boolean(
      await this._database
        .prepare(
          "SELECT 1 FROM users WHERE lower(username COLLATE \"C\") = lower(?::text COLLATE \"C\")"
        )
        .get(username)
    );
  }

  async findUser(userId: string): Promise<User | null> {
    const row = await this._database
      .prepare(
        `SELECT id, username, display_name, avatar_url
         FROM users WHERE id = ?`
      )
      .get(userId) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  async findPrincipal(userId: string): Promise<StoredPrincipal | null> {
    return await findPrincipal(this._database, userId);
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
    await touchAgent(this._database, target, at, staleBefore, expiresAt);
  }

  async findUsers(userIds: readonly string[]): Promise<readonly User[]> {
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0) return [];
    const users = new Map<string, User>();
    for (let offset = 0; offset < uniqueUserIds.length; offset += 500) {
      const batch = uniqueUserIds.slice(offset, offset + 500);
      const placeholders = batch.map(() => "?").join(", ");
      const rows = await this._database
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
    const row = await this._database
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
         WHERE lower(users.username COLLATE "C") = lower(?::text COLLATE "C")`
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
    const row = await this._database
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
    updatedAt: number
  ): Promise<void> {
    await this._database
      .prepare(
        `UPDATE password_credentials
         SET password_hash = ?, updated_at = ?
         WHERE user_id = ?`
      )
      .run(passwordHash, updatedAt, userId);
  }

  async createSession(
    userId: string,
    session: NewPasswordUser["session"]
  ): Promise<void> {
    await insertSession(this._database, userId, session);
  }

  async findSession(sessionId: string): Promise<StoredSession | null> {
    const row = await this._database
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
          tokenIssued: row.token_issued,
        }
      : null;
  }

  async authenticationMethods(userId: string): Promise<AuthenticationMethods> {
    const password = Boolean(
      await this._database
        .prepare("SELECT 1 FROM password_credentials WHERE user_id = ?")
        .get(userId)
    );
    const emailRow = await this._database
      .prepare("SELECT email FROM users WHERE id = ?")
      .get(userId) as { readonly email: string | null } | undefined;
    const rows = await this._database
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
    const row = await this._database
      .prepare(
        `SELECT id, username, display_name, avatar_url
         FROM users
         WHERE lower(email COLLATE "C") = lower(?::text COLLATE "C")`
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
  }): Promise<void> {
    await this._database
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
  }

  async findEmailLoginCode(
    email: string,
    now: number
  ): Promise<StoredEmailLoginCode | null> {
    const row = await this._database
      .prepare(
        `SELECT id, code_hash, attempts
         FROM email_login_codes
         WHERE lower(email COLLATE "C") = lower(?::text COLLATE "C")
           AND consumed_at IS NULL
           AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(email, now) as EmailLoginCodeRow | undefined;
    return row
      ? { id: row.id, codeHash: row.code_hash, attempts: row.attempts }
      : null;
  }

  async incrementEmailLoginCodeAttempts(id: string): Promise<void> {
    await this._database
      .prepare(
        `UPDATE email_login_codes SET attempts = attempts + 1 WHERE id = ?`
      )
      .run(id);
  }

  async consumeEmailLoginCode(id: string, consumedAt: number): Promise<boolean> {
    const result = await this._database
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
    await this._database
      .prepare(
        `UPDATE email_login_codes
         SET consumed_at = ?
         WHERE lower(email COLLATE "C") = lower(?::text COLLATE "C")
           AND id <> ?
           AND consumed_at IS NULL`
      )
      .run(consumedAt, email, keepId);
  }

  async deleteEmailLoginCode(id: string): Promise<void> {
    await this._database
      .prepare("DELETE FROM email_login_codes WHERE id = ?")
      .run(id);
  }

  async latestEmailLoginCodeCreatedAt(email: string): Promise<number | null> {
    const row = await this._database
      .prepare(
        `SELECT MAX(created_at) AS created_at
         FROM email_login_codes
         WHERE lower(email COLLATE "C") = lower(?::text COLLATE "C")`
      )
      .get(email) as { readonly created_at: number | null } | undefined;
    return row?.created_at ?? null;
  }

  async countEmailLoginCodesSince(email: string, since: number): Promise<number> {
    const row = await this._database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM email_login_codes
         WHERE lower(email COLLATE "C") = lower(?::text COLLATE "C") AND created_at > ?`
      )
      .get(email, since) as { readonly count: number };
    return row.count;
  }

  async deleteEmailLoginCodesBefore(cutoff: number): Promise<void> {
    await this._database
      .prepare("DELETE FROM email_login_codes WHERE created_at <= ?")
      .run(cutoff);
  }

  async updateUser(userId: string, patch: Partial<Omit<User, "id">>, updatedAt: number, expected?: User): Promise<User> {
    const fields = ["updated_at = ?"];
    const values: (string | number | null)[] = [updatedAt];
    for (const [key, column] of [["username", "username"], ["displayName", "display_name"], ["avatarUrl", "avatar_url"]] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (expected) {
        fields.push(`${column} = CASE WHEN ${column} IS NOT DISTINCT FROM ? THEN ? ELSE ${column} END`);
        values.push(expected[key], value);
      } else {
        fields.push(`${column} = ?`);
        values.push(value);
      }
    }
    return this._database.transaction(async (database) => {
      const before = await database.prepare("SELECT display_name FROM users WHERE id = ?").get(userId) as Pick<UserRow, "display_name"> | undefined;
      const row = await database.prepare(`
        UPDATE users SET ${fields.join(", ")} WHERE id = ? RETURNING id, username, display_name, avatar_url
      `).get(...values, userId) as UserRow | undefined;
      if (!before || !row) throw new Error("Authenticated user is missing.");
      if (row.display_name !== before.display_name) {
        await database.prepare("UPDATE spaces SET name = ?, updated_at = ? WHERE owner_user_id = ? AND type = 'personal' AND name = ?")
          .run(personalSpaceName(row.display_name), updatedAt, userId, personalSpaceName(before.display_name));
      }
      return toUser(row);
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this._database
      .prepare("DELETE FROM login_sessions WHERE id = ?")
      .run(sessionId);
  }

  async deleteExpiredSessions(now: number): Promise<string[]> {
    return (await this._database
      .prepare("DELETE FROM login_sessions WHERE expires_at <= ? RETURNING id")
      .all(now))
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
  readonly claimed: boolean;
  readonly banned: boolean;
}

const principalColumns = `users.kind,
  agents.owner_user_id IS NOT NULL AS claimed,
  agents.banned_at IS NOT NULL AS banned`;

const agentJoin = "LEFT JOIN agents ON agents.user_id = users.id";

interface SessionRow extends PrincipalRow {
  readonly write_source: WriteSource | null;
  readonly token_issued: boolean;
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
  readonly attempts: number;
}

export async function findPrincipal(
  db: PostgresDatabase,
  userId: string,
): Promise<StoredPrincipal | null> {
  const row = await db
    .prepare(
      `SELECT users.id, users.username, users.display_name, users.avatar_url, ${principalColumns}
       FROM users ${agentJoin}
       WHERE users.id = ?`
    )
    .get(userId) as PrincipalRow | undefined;
  return row ? toPrincipal(row) : null;
}

export async function touchAgent(
  db: PostgresDatabase,
  target: Parameters<IdentityRepository["touchAgent"]>[0],
  at: number,
  staleBefore: number,
  expiresAt: number,
): Promise<void> {
  const stale = await db
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
  await db
    .prepare(
      "UPDATE agents SET last_active_at = ?, expires_at = CASE WHEN owner_user_id IS NULL THEN ?::bigint END WHERE user_id = ?"
    )
    .run(at, expiresAt, stale.user_id);
}

export async function insertSession(
  database: PostgresDatabase,
  userId: string,
  session: NewPasswordUser["session"]
): Promise<void> {
  await database
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
      ? { kind: "agent", claimed: row.claimed }
      : { kind: "human" }),
    banned: row.banned,
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
  readonly last_active_at: number;
  readonly banned: boolean;
  readonly files: number;
}

function toStoredAgent(row: AgentRow): StoredAgent {
  return {
    user: toUser(row),
    spaceId: row.space_id,
    ownerUserId: row.owner_user_id,
    lastActiveAt: row.last_active_at,
    banned: row.banned,
    files: row.files,
  };
}
