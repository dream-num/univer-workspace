import type { SpacePinsRepository, StoredSpacePins } from "../../../modules/spaces/space-pins.repository.js";
import type { SqliteDatabase } from "../connection.js";
import { spaceMemberJoin, visibleSpaceSql } from "../access/access.repository.js";
import { listSpaceViews, pinnableSql } from "./space-views.js";

export class SqliteSpacePinsRepository implements SpacePinsRepository {
  constructor(private readonly _database: SqliteDatabase) {}

  async getPins(userId: string, defaultLimit: number): Promise<StoredSpacePins> {
    const pins = listSpaceViews(this._database, userId, "pins");
    if (pins.length) return { customized: true, spaces: pins };
    return { customized: false, spaces: listSpaceViews(this._database, userId, "mine", defaultLimit) };
  }

  async replacePins(userId: string, spaceIds: readonly string[], createdAt: number): Promise<StoredSpacePins | null> {
    return this._database.transaction((database) => {
      const pinnable = database.prepare(`
        SELECT spaces.id FROM spaces ${spaceMemberJoin}
        WHERE spaces.id IN (SELECT value FROM json_each($ids)) AND ${visibleSpaceSql} AND ${pinnableSql}
      `).all({ userId, ids: JSON.stringify(spaceIds) });
      if (pinnable.length !== spaceIds.length) return null;
      database.prepare("DELETE FROM space_pins WHERE user_id = ?").run(userId);
      const insert = database.prepare(`
        INSERT INTO space_pins (user_id, space_id, position, created_at) VALUES (?, ?, ?, ?)
      `);
      spaceIds.forEach((spaceId, position) => insert.run(userId, spaceId, position, createdAt));
      return { customized: true, spaces: listSpaceViews(this._database, userId, "pins") };
    });
  }

  async resetPins(userId: string, defaultLimit: number): Promise<StoredSpacePins> {
    return this._database.transaction((db) => {
      db.prepare("DELETE FROM space_pins WHERE user_id = ?").run(userId);
      return { customized: false, spaces: listSpaceViews(this._database, userId, "mine", defaultLimit) };
    });
  }
}
