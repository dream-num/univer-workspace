import type { SqliteDatabase } from "../connection.js";
import { listSpaceViews } from "./space-views.js";
import type { SpaceStar, SpaceView } from "../../../modules/spaces/spaces.types.js";
import type { SpaceListEntry, SpaceListScope, SpacesRepository } from "../../../modules/spaces/spaces.repository.js";

const PERSONAL_SLUG = "personal";

export class SqliteSpacesRepository implements SpacesRepository {
  constructor(private readonly _database: SqliteDatabase) {}

  listViews(userId: string, scope: SpaceListScope): SpaceListEntry[] {
    return listSpaceViews(this._database, userId, scope);
  }

  getOwner(userId: string): SpaceView["owner"] {
    const row = this._database.connection.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
    if (!row) throw new Error("Space owner is missing");
    return row as unknown as SpaceView["owner"];
  }

  getDetails(spaceId: string): { readonly description: string; readonly slug: string | null } {
    const row = this._database.connection
      .prepare("SELECT description, slug FROM spaces WHERE id = ?")
      .get(spaceId) as { description: string; slug: string | null } | undefined;
    if (!row) throw new Error("Space is missing");
    return row;
  }

  /** Resolves `<username>/<slug>`; the personal Space is addressed by the reserved slug `personal`. */
  findIdByFullName(username: string, slug: string): string | null {
    const personal = slug.toLowerCase() === PERSONAL_SLUG;
    const row = this._database.connection
      .prepare(
        `SELECT spaces.id FROM spaces
         JOIN users ON users.id = spaces.owner_user_id
         WHERE users.username = ?
           AND ${personal ? "spaces.type = 'personal'" : "spaces.type = 'team' AND spaces.slug = ?"}`
      )
      .get(...(personal ? [username] : [username, slug])) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** The first free slug for the owner: `base`, then `base-2`, `base-3`, ... */
  freeSlug(ownerUserId: string, base: string): string {
    const taken = this._database.connection.prepare(
      "SELECT 1 FROM spaces WHERE owner_user_id = ? AND slug = ?"
    );
    for (let attempt = 1; ; attempt += 1) {
      const suffix = attempt === 1 ? "" : `-${attempt}`;
      const candidate = `${base.slice(0, 100 - suffix.length)}${suffix}`;
      if (!taken.get(ownerUserId, candidate)) return candidate;
    }
  }

  slugTaken(ownerUserId: string, slug: string, exceptSpaceId?: string): boolean {
    return Boolean(
      this._database.connection
        .prepare("SELECT 1 FROM spaces WHERE owner_user_id = ? AND slug = ? AND id <> ?")
        .get(ownerUserId, slug, exceptSpaceId ?? "")
    );
  }

  getStar(userId: string, spaceId: string): SpaceStar {
    const row = this._database.connection.prepare(`
      SELECT COUNT(*) AS star_count,
             COALESCE(MAX(user_id = ?), 0) AS starred
      FROM space_stars WHERE space_id = ?
    `).get(userId, spaceId) as { star_count: number; starred: number };
    return { starred: Boolean(row.starred), starCount: row.star_count };
  }

  setStar(userId: string, spaceId: string, starred: boolean, createdAt: number): SpaceStar {
    return this._database.transaction((database) => {
      if (starred) {
        database.prepare(`INSERT INTO space_stars (space_id, user_id, created_at)
          VALUES (?, ?, ?) ON CONFLICT (space_id, user_id) DO NOTHING`).run(spaceId, userId, createdAt);
      } else {
        database.prepare("DELETE FROM space_stars WHERE space_id = ? AND user_id = ?").run(spaceId, userId);
      }
      return this.getStar(userId, spaceId);
    });
  }

  createTeamSpace(input: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly publicRead: boolean;
    readonly ownerUserId: string;
    readonly createdAt: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO spaces
          (id, type, name, slug, public_read, owner_user_id, created_at, updated_at)
         VALUES (?, 'team', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.name,
        input.slug,
        input.publicRead ? 1 : 0,
        input.ownerUserId,
        input.createdAt,
        input.createdAt
      );
  }

  updateName(spaceId: string, name: string, updatedAt: number): void {
    this._database.connection
      .prepare("UPDATE spaces SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, updatedAt, spaceId);
  }

  updateSlug(spaceId: string, slug: string, updatedAt: number): void {
    this._database.connection
      .prepare("UPDATE spaces SET slug = ?, updated_at = ? WHERE id = ?")
      .run(slug, updatedAt, spaceId);
  }

  updateDescription(spaceId: string, description: string, updatedAt: number): void {
    this._database.connection
      .prepare("UPDATE spaces SET description = ?, updated_at = ? WHERE id = ?")
      .run(description, updatedAt, spaceId);
  }

  updatePublicRead(spaceId: string, publicRead: boolean, updatedAt: number): void {
    this._database.connection
      .prepare("UPDATE spaces SET public_read = ?, updated_at = ? WHERE id = ?")
      .run(publicRead ? 1 : 0, updatedAt, spaceId);
  }
}
