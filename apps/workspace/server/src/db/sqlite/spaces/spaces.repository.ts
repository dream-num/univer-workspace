import { resolveStoredSpaceAccess } from "../../../modules/access/index.js";
import { spaceNotFound, spaceUpdateForbidden } from "../../../modules/spaces/spaces.errors.js";
import type {
  CreateTeamSpaceInput, SpaceListEntry, SpaceListScope, SpaceSettingsPatch, SpacesRepository,
} from "../../../modules/spaces/spaces.repository.js";
import type { SpaceStar } from "../../../modules/spaces/spaces.types.js";
import { assertTeamSpaceQuota, spaceMemberJoin, visibleSpaceSql } from "../access/access.repository.js";
import type { SqliteDatabase } from "../connection.js";
import { findSpaceView, listSpaceViews } from "./space-views.js";

export class SqliteSpacesRepository implements SpacesRepository {
  constructor(private readonly _database: SqliteDatabase) {}

  async listViews(userId: string, scope: SpaceListScope): Promise<SpaceListEntry[]> {
    return listSpaceViews(this._database, userId, scope);
  }

  async getView(userId: string, spaceId: string): Promise<SpaceListEntry | null> {
    return findSpaceView(this._database, userId, { spaceId });
  }

  async findViewByFullName(userId: string, username: string, slug: string): Promise<SpaceListEntry | null> {
    return findSpaceView(this._database, userId, { username, slug });
  }

  async getStar(userId: string, spaceId: string): Promise<SpaceStar | null> {
    return this._readStar(userId, spaceId);
  }

  async setStar(userId: string, spaceId: string, starred: boolean, createdAt: number): Promise<SpaceStar | null> {
    return this._database.transaction((database) => {
      if (!findSpaceView(this._database, userId, { spaceId })) return null;
      if (starred) {
        database.prepare(`INSERT INTO space_stars (space_id, user_id, created_at)
          VALUES (?, ?, ?) ON CONFLICT (space_id, user_id) DO NOTHING`).run(spaceId, userId, createdAt);
      } else {
        database.prepare("DELETE FROM space_stars WHERE space_id = ? AND user_id = ?").run(spaceId, userId);
      }
      const result = this._readStar(userId, spaceId);
      if (!result) throw spaceNotFound();
      return result;
    });
  }

  async createTeamSpace(input: CreateTeamSpaceInput): Promise<SpaceListEntry | null> {
    return this._database.transaction((database) => {
      assertTeamSpaceQuota(database, input.ownerUserId);
      const insert = database.prepare(`
        INSERT INTO spaces (id, type, name, slug, public_read, proposals, owner_user_id, created_at, updated_at)
        SELECT $id, 'team', $name, $slug, $publicRead, $proposals, $ownerUserId, $createdAt, $createdAt
        WHERE NOT EXISTS (SELECT 1 FROM forks WHERE owner_user_id = $ownerUserId AND name = $slug)
        ON CONFLICT (owner_user_id, slug) WHERE slug IS NOT NULL DO NOTHING
      `);
      let slug = input.slug ?? input.slugBase;
      for (let attempt = 2; ; attempt += 1) {
        const result = insert.run({
          id: input.id, name: input.name, slug, publicRead: Number(input.publicRead), proposals: input.proposals, ownerUserId: input.ownerUserId, createdAt: input.createdAt,
        });
        if (result.changes) break;
        if (input.slugBase === undefined) return null;
        const suffix = `-${attempt}`;
        slug = input.slugBase.slice(0, 100 - suffix.length) + suffix;
      }
      const space = findSpaceView(this._database, input.ownerUserId, { spaceId: input.id });
      if (!space) throw spaceNotFound();
      return space;
    });
  }

  async updateSettings(userId: string, spaceId: string, settings: SpaceSettingsPatch, updatedAt: number): Promise<SpaceListEntry | null> {
    return this._database.transaction((database) => {
      const before = findSpaceView(this._database, userId, { spaceId });
      if (!before) throw spaceNotFound();
      if (!resolveStoredSpaceAccess(userId, before)?.capabilities.renameSpace) throw spaceUpdateForbidden();
      if (settings.slug !== undefined && database.prepare(`
        SELECT 1 FROM spaces WHERE owner_user_id = $owner AND slug = $slug AND id <> $spaceId
        UNION ALL SELECT 1 FROM forks WHERE owner_user_id = $owner AND name = $slug
      `).get({ owner: before.ownerUserId, slug: settings.slug, spaceId })) return null;

      const assignments = ["updated_at = ?"];
      const values: (string | number | null)[] = [updatedAt];
      for (const [column, value] of [
        ["name", settings.name], ["description", settings.description], ["public_read", settings.publicRead], ["slug", settings.slug], ["proposals", settings.proposals], ["accept_after_hours", settings.acceptAfterHours], ["landing", settings.landing],
      ] as const) {
        if (value === undefined) continue;
        assignments.push(`${column} = ?`);
        values.push(typeof value === "boolean" ? Number(value) : value);
      }
      database.prepare(`UPDATE spaces SET ${assignments.join(", ")} WHERE id = ?`).run(...values, spaceId);
      const after = findSpaceView(this._database, userId, { spaceId });
      if (!after) throw spaceNotFound();
      return after;
    });
  }

  private _readStar(userId: string, spaceId: string): SpaceStar | null {
    const row = this._database.connection.prepare(`
      SELECT (SELECT COUNT(*) FROM space_stars WHERE space_id = spaces.id) AS starCount,
             EXISTS (SELECT 1 FROM space_stars WHERE space_id = spaces.id AND user_id = $userId) AS starred
      FROM spaces ${spaceMemberJoin}
      WHERE spaces.id = $spaceId AND ${visibleSpaceSql}
    `).get({ userId, spaceId }) as { starCount: number; starred: number } | undefined;
    return row ? { starred: Boolean(row.starred), starCount: row.starCount } : null;
  }
}
