import type { Pool } from "pg";
import { resolveStoredSpaceAccess } from "../../../modules/access/index.js";
import { spaceNotFound, spaceUpdateForbidden } from "../../../modules/spaces/spaces.errors.js";
import type {
  CreateTeamSpaceInput, SpaceListEntry, SpaceListScope, SpaceSettingsPatch, SpacesRepository,
} from "../../../modules/spaces/spaces.repository.js";
import type { SpaceStar } from "../../../modules/spaces/spaces.types.js";
import { assertTeamSpaceQuota } from "../access/access.repository.js";
import { withPostgresTransaction } from "../transaction.js";
import { findSpaceView, listSpaceViews, readSpaceStar } from "./space-views.js";

export class PostgresSpacesRepository implements SpacesRepository {
  constructor(private readonly pool: Pool) {}

  listViews(userId: string, scope: SpaceListScope): Promise<SpaceListEntry[]> {
    return listSpaceViews(this.pool, userId, scope);
  }

  getView(userId: string, spaceId: string): Promise<SpaceListEntry | null> {
    return findSpaceView(this.pool, userId, { spaceId });
  }

  findViewByFullName(userId: string, username: string, slug: string): Promise<SpaceListEntry | null> {
    return findSpaceView(this.pool, userId, { username, slug });
  }

  getStar(userId: string, spaceId: string): Promise<SpaceStar | null> {
    return readSpaceStar(this.pool, userId, spaceId);
  }

  setStar(userId: string, spaceId: string, starred: boolean, createdAt: number): Promise<SpaceStar | null> {
    return withPostgresTransaction(this.pool, async (client) => {
      if (!(await findSpaceView(client, userId, { spaceId }))) return null;
      if (starred) {
        await client.query(`
          INSERT INTO space_stars (space_id, user_id, created_at) VALUES ($1, $2, $3)
          ON CONFLICT (space_id, user_id) DO NOTHING`, [spaceId, userId, createdAt]);
      } else {
        await client.query("DELETE FROM space_stars WHERE space_id = $1 AND user_id = $2", [spaceId, userId]);
      }
      const star = await readSpaceStar(client, userId, spaceId);
      if (!star) throw spaceNotFound();
      return star;
    });
  }

  createTeamSpace(input: CreateTeamSpaceInput): Promise<SpaceListEntry | null> {
    return withPostgresTransaction(this.pool, async (client) => {
      await assertTeamSpaceQuota(client, input.ownerUserId);
      let slug = input.slug ?? input.slugBase;
      for (let attempt = 2; ; attempt += 1) {
        const inserted = await client.query(`
          INSERT INTO spaces (id, type, name, slug, public_read, owner_user_id, created_at, updated_at, proposals)
          SELECT $1, 'team', $2, $3::text, $4, $5, $6, $6, $7
          WHERE NOT EXISTS (SELECT 1 FROM forks WHERE owner_user_id = $5 AND lower(name COLLATE "C") = lower($3::text COLLATE "C"))
          ON CONFLICT (owner_user_id, lower(slug COLLATE "C")) WHERE slug IS NOT NULL DO NOTHING`,
          [input.id, input.name, slug, input.publicRead, input.ownerUserId, input.createdAt, input.proposals],
        );
        if (inserted.rowCount) break;
        if (input.slugBase === undefined) return null;
        const suffix = `-${attempt}`;
        slug = input.slugBase.slice(0, 100 - suffix.length) + suffix;
      }
      const space = await findSpaceView(client, input.ownerUserId, { spaceId: input.id });
      if (!space) throw spaceNotFound();
      return space;
    });
  }

  async updateSettings(
    userId: string, spaceId: string, settings: SpaceSettingsPatch, updatedAt: number,
  ): Promise<SpaceListEntry | null> {
    try {
      return await withPostgresTransaction(this.pool, async (client) => {
        const before = await findSpaceView(client, userId, { spaceId });
        if (!before) throw spaceNotFound();
        if (!resolveStoredSpaceAccess(userId, before)?.capabilities.renameSpace) throw spaceUpdateForbidden();
        if (settings.slug !== undefined && (await client.query(
          `SELECT 1 FROM forks WHERE owner_user_id = $1 AND lower(name COLLATE "C") = lower($2::text COLLATE "C")`,
          [before.ownerUserId, settings.slug],
        )).rowCount) return null;

        const assignments = ["updated_at = $2"];
        const values: (string | number | boolean)[] = [spaceId, updatedAt];
        for (const [column, value] of [
          ["name", settings.name], ["description", settings.description], ["public_read", settings.publicRead], ["slug", settings.slug], ["proposals", settings.proposals],
        ] as const) {
          if (value === undefined) continue;
          values.push(value);
          assignments.push(`${column} = $${values.length}`);
        }
        await client.query(`UPDATE spaces SET ${assignments.join(", ")} WHERE id = $1`, values);
        const after = await findSpaceView(client, userId, { spaceId });
        if (!after) throw spaceNotFound();
        return after;
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23505" &&
          "constraint" in error && error.constraint === "spaces_owner_slug") return null;
      throw error;
    }
  }
}
