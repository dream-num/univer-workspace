import type { DatabaseSync } from "node:sqlite";
import type { ExternalIdentity } from "../../github-oauth.js";
import { ObservationDatabase } from "./observation-database.js";
import type {
  ObservationAccessEvent,
  ObservationMember,
  ObservationSession,
} from "./observation-types.js";

interface MemberRow {
  readonly github_user_id: string;
  readonly github_login: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly added_by_github_user_id: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export class ObservationRepository {
  constructor(private readonly _database: ObservationDatabase) {}

  memberCount(): number {
    return (this._database.connection
      .prepare("SELECT COUNT(*) AS count FROM observer_members")
      .get() as { readonly count: number }).count;
  }

  listMembers(): readonly ObservationMember[] {
    return (this._database.connection
      .prepare("SELECT * FROM observer_members ORDER BY created_at, github_user_id")
      .all() as unknown as MemberRow[]).map(toMember);
  }

  findMember(githubUserId: string): ObservationMember | null {
    const row = this._database.connection
      .prepare("SELECT * FROM observer_members WHERE github_user_id = ?")
      .get(githubUserId) as MemberRow | undefined;
    return row ? toMember(row) : null;
  }

  findSession(sessionId: string): ObservationSession | null {
    const row = this._database.connection
      .prepare(
        `SELECT m.*, s.id AS session_id, s.secret_hash, s.expires_at
         FROM observer_sessions s
         JOIN observer_members m ON m.github_user_id = s.github_user_id
         WHERE s.id = ?`
      )
      .get(sessionId) as
      | (MemberRow & {
          readonly session_id: string;
          readonly secret_hash: string;
          readonly expires_at: number;
        })
      | undefined;
    return row
      ? {
          member: toMember(row),
          sessionId: row.session_id,
          secretHash: row.secret_hash,
          expiresAt: row.expires_at,
        }
      : null;
  }

  createSession(input: {
    readonly id: string;
    readonly secretHash: string;
    readonly githubUserId: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO observer_sessions
          (id, secret_hash, github_user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.id, input.secretHash, input.githubUserId, input.createdAt, input.expiresAt);
  }

  deleteSession(id: string): void {
    this._database.connection.prepare("DELETE FROM observer_sessions WHERE id = ?").run(id);
  }

  deleteExpiredSessions(now: number): void {
    this._database.connection
      .prepare("DELETE FROM observer_sessions WHERE expires_at <= ?")
      .run(now);
  }

  initialize(identity: ExternalIdentity, session: NewSession, eventId: string, now: number): ObservationMember {
    return this._database.transaction((database) => {
      const count = (database.prepare("SELECT COUNT(*) AS count FROM observer_members").get() as { readonly count: number }).count;
      if (count !== 0) throw new ObservationInitializationConflict();
      insertMember(database, identity, null, now);
      insertSession(database, identity.subject, session);
      insertEvent(database, {
        id: eventId,
        actorGithubUserId: identity.subject,
        actorGithubLogin: identity.username,
        targetGithubUserId: identity.subject,
        targetGithubLogin: identity.username,
        action: "setup",
        result: "succeeded",
        createdAt: now,
      });
      return this.findMemberWithin(database, identity.subject)!;
    });
  }

  refreshAndCreateSession(identity: ExternalIdentity, session: NewSession, now: number): ObservationMember | null {
    return this._database.transaction((database) => {
      const current = this.findMemberWithin(database, identity.subject);
      if (!current) return null;
      database.prepare(
        `UPDATE observer_members SET github_login = ?, display_name = ?, avatar_url = ?, updated_at = ?
         WHERE github_user_id = ?`
      ).run(identity.username, identity.displayName, identity.avatarUrl, now, identity.subject);
      insertSession(database, identity.subject, session);
      return this.findMemberWithin(database, identity.subject)!;
    });
  }

  addMember(actor: ObservationMember, identity: ExternalIdentity, eventId: string, now: number): ObservationMember {
    return this._database.transaction((database) => {
      const existing = this.findMemberWithin(database, identity.subject);
      if (existing) return existing;
      insertMember(database, identity, actor.githubUserId, now);
      insertEvent(database, {
        id: eventId,
        actorGithubUserId: actor.githubUserId,
        actorGithubLogin: actor.githubLogin,
        targetGithubUserId: identity.subject,
        targetGithubLogin: identity.username,
        action: "add",
        result: "succeeded",
        createdAt: now,
      });
      return this.findMemberWithin(database, identity.subject)!;
    });
  }

  removeMember(actor: ObservationMember, target: ObservationMember, eventId: string, now: number): "removed" | "last-member" {
    return this._database.transaction((database) => {
      const count = (database.prepare("SELECT COUNT(*) AS count FROM observer_members").get() as { readonly count: number }).count;
      if (count <= 1) {
        insertEvent(database, {
          id: eventId,
          actorGithubUserId: actor.githubUserId,
          actorGithubLogin: actor.githubLogin,
          targetGithubUserId: target.githubUserId,
          targetGithubLogin: target.githubLogin,
          action: "remove",
          result: "rejected",
          createdAt: now,
        });
        return "last-member";
      }
      database.prepare("DELETE FROM observer_members WHERE github_user_id = ?").run(target.githubUserId);
      insertEvent(database, {
        id: eventId,
        actorGithubUserId: actor.githubUserId,
        actorGithubLogin: actor.githubLogin,
        targetGithubUserId: target.githubUserId,
        targetGithubLogin: target.githubLogin,
        action: "remove",
        result: "succeeded",
        createdAt: now,
      });
      return "removed";
    });
  }

  listEvents(limit: number): readonly ObservationAccessEvent[] {
    return this._database.connection.prepare(
      `SELECT * FROM observer_access_events ORDER BY created_at DESC, sequence DESC LIMIT ?`
    ).all(limit).map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        id: row.id as string,
        actorGithubUserId: row.actor_github_user_id as string | null,
        actorGithubLogin: row.actor_github_login as string | null,
        targetGithubUserId: row.target_github_user_id as string | null,
        targetGithubLogin: row.target_github_login as string | null,
        action: row.action as ObservationAccessEvent["action"],
        result: row.result as ObservationAccessEvent["result"],
        createdAt: row.created_at as number,
      };
    });
  }

  private findMemberWithin(database: DatabaseSync, githubUserId: string): ObservationMember | null {
    const row = database.prepare("SELECT * FROM observer_members WHERE github_user_id = ?").get(githubUserId) as MemberRow | undefined;
    return row ? toMember(row) : null;
  }
}

interface NewSession {
  readonly id: string;
  readonly secretHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export class ObservationInitializationConflict extends Error {}

function insertMember(database: DatabaseSync, identity: ExternalIdentity, addedBy: string | null, now: number): void {
  database.prepare(
    `INSERT INTO observer_members
      (github_user_id, github_login, display_name, avatar_url, added_by_github_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(identity.subject, identity.username, identity.displayName, identity.avatarUrl, addedBy, now, now);
}

function insertSession(database: DatabaseSync, githubUserId: string, session: NewSession): void {
  database.prepare(
    `INSERT INTO observer_sessions (id, secret_hash, github_user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(session.id, session.secretHash, githubUserId, session.createdAt, session.expiresAt);
}

function insertEvent(database: DatabaseSync, event: ObservationAccessEvent): void {
  database.prepare(
    `INSERT INTO observer_access_events
      (id, actor_github_user_id, actor_github_login, target_github_user_id, target_github_login, action, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(event.id, event.actorGithubUserId, event.actorGithubLogin, event.targetGithubUserId, event.targetGithubLogin, event.action, event.result, event.createdAt);
}

function toMember(row: MemberRow): ObservationMember {
  return {
    githubUserId: row.github_user_id,
    githubLogin: row.github_login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    addedByGithubUserId: row.added_by_github_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
