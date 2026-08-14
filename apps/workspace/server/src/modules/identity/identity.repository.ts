import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceDatabase } from "../../db/database.js";
import type {
  AuthenticationMethods,
  ExternalIdentityProvider,
  User,
} from "./identity.types.js";

export interface StoredSession extends User {
  readonly sessionId: string;
  readonly secretHash: string;
  readonly expiresAt: number;
}

export interface StoredCredential extends User {
  readonly passwordHash: string;
}

export interface NewPasswordUser {
  readonly user: User;
  readonly passwordHash: string;
  readonly personalSpace: {
    readonly id: string;
    readonly name: string;
  };
  readonly session: {
    readonly id: string;
    readonly secretHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  };
  readonly createdAt: number;
}

export interface ExternalIdentityUser {
  readonly user: User;
  readonly providerUsername: string;
}

export class IdentityRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  createPasswordUser(input: NewPasswordUser): void {
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

  createExternalUser(input: {
    readonly provider: ExternalIdentityProvider;
    readonly user: User;
    readonly providerSubject: string;
    readonly providerUsername: string;
    readonly personalSpace: NewPasswordUser["personalSpace"];
    readonly session: NewPasswordUser["session"];
    readonly createdAt: number;
  }): void {
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

  findExternalIdentity(
    provider: ExternalIdentityProvider,
    providerSubject: string
  ): ExternalIdentityUser | null {
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

  linkExternalIdentity(input: {
    readonly provider: ExternalIdentityProvider;
    readonly userId: string;
    readonly providerSubject: string;
    readonly providerUsername: string;
    readonly updatedAt: number;
  }): void {
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

  updateExternalUsername(
    provider: ExternalIdentityProvider,
    providerSubject: string,
    providerUsername: string,
    updatedAt: number
  ): void {
    this._database.connection
      .prepare(
        `UPDATE external_identities
         SET provider_username = ?, updated_at = ?
         WHERE provider = ? AND provider_subject = ?`
      )
      .run(providerUsername, updatedAt, provider, providerSubject);
  }

  removeExternalIdentity(
    userId: string,
    provider: ExternalIdentityProvider
  ): boolean {
    return (
      this._database.connection
        .prepare(
          `DELETE FROM external_identities
           WHERE provider = ? AND user_id = ?`
        )
        .run(provider, userId).changes > 0
    );
  }

  usernameExists(username: string): boolean {
    return Boolean(
      this._database.connection
        .prepare(
          "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE"
        )
        .get(username)
    );
  }

  findUser(userId: string): User | null {
    const row = this._database.connection
      .prepare(
        `SELECT id, username, display_name, avatar_url
         FROM users WHERE id = ?`
      )
      .get(userId) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  findCredential(username: string): StoredCredential | null {
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

  findCredentialByUserId(userId: string): StoredCredential | null {
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

  updatePasswordHash(
    userId: string,
    passwordHash: string,
    updatedAt: number
  ): void {
    this._database.connection
      .prepare(
        `UPDATE password_credentials
         SET password_hash = ?, updated_at = ?
         WHERE user_id = ?`
      )
      .run(passwordHash, updatedAt, userId);
  }

  createSession(
    userId: string,
    session: NewPasswordUser["session"]
  ): void {
    insertSession(this._database.connection, userId, session);
  }

  findSession(sessionId: string): StoredSession | null {
    const row = this._database.connection
      .prepare(
        `SELECT
           login_sessions.id AS session_id,
           login_sessions.secret_hash,
           login_sessions.expires_at,
           users.id,
           users.username,
           users.display_name,
           users.avatar_url
         FROM login_sessions
         JOIN users ON users.id = login_sessions.user_id
         WHERE login_sessions.id = ?`
      )
      .get(sessionId) as SessionRow | undefined;
    return row
      ? {
          ...toUser(row),
          sessionId: row.session_id,
          secretHash: row.secret_hash,
          expiresAt: row.expires_at,
        }
      : null;
  }

  authenticationMethods(userId: string): AuthenticationMethods {
    const password = Boolean(
      this._database.connection
        .prepare("SELECT 1 FROM password_credentials WHERE user_id = ?")
        .get(userId)
    );
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
      externalIdentities: rows.map((row) => ({
        provider: row.provider,
        providerUsername: row.provider_username,
      })),
    };
  }

  updateUser(user: User, updatedAt: number): void {
    this._database.connection
      .prepare(
        `UPDATE users
         SET username = ?, display_name = ?, avatar_url = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        user.username,
        user.displayName,
        user.avatarUrl,
        updatedAt,
        user.id
      );
  }

  deleteSession(sessionId: string): void {
    this._database.connection
      .prepare("DELETE FROM login_sessions WHERE id = ?")
      .run(sessionId);
  }

  deleteExpiredSessions(now: number): void {
    this._database.connection
      .prepare("DELETE FROM login_sessions WHERE expires_at <= ?")
      .run(now);
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

interface SessionRow extends UserRow {
  readonly session_id: string;
  readonly secret_hash: string;
  readonly expires_at: number;
}

interface ExternalIdentityRow {
  readonly provider: ExternalIdentityProvider;
  readonly provider_username: string;
}

function insertSession(
  database: DatabaseSync,
  userId: string,
  session: NewPasswordUser["session"]
): void {
  database
    .prepare(
      `INSERT INTO login_sessions
        (id, secret_hash, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      session.id,
      session.secretHash,
      userId,
      session.createdAt,
      session.expiresAt
    );
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}
