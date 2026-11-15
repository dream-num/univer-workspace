import type { Pool } from "pg";
import type { SpacePinsRepository, StoredSpacePins } from "../../../modules/spaces/space-pins.repository.js";
import { withPostgresTransaction } from "../transaction.js";
import { listSpaceViews, pinnableSpaceIds } from "./space-views.js";

export class PostgresSpacePinsRepository implements SpacePinsRepository {
  constructor(private readonly pool: Pool) {}

  getPins(userId: string, defaultLimit: number): Promise<StoredSpacePins> {
    return withPostgresTransaction(this.pool, async (client) => {
      const pins = await listSpaceViews(client, userId, "pins");
      if (pins.length) return { customized: true, spaces: pins };
      return { customized: false, spaces: await listSpaceViews(client, userId, "mine", defaultLimit) };
    });
  }

  replacePins(userId: string, spaceIds: readonly string[], createdAt: number): Promise<StoredSpacePins | null> {
    return withPostgresTransaction(this.pool, async (client) => {
      const eligible = await pinnableSpaceIds(client, userId, spaceIds);
      if (eligible.length !== spaceIds.length) return null;

      await client.query("DELETE FROM space_pins WHERE user_id = $1", [userId]);
      // Concurrent first replacements have no old rows to lock. Both insert position zero.
      // ON CONFLICT makes a conflict invisible to this serializable snapshot retry the transaction.
      const inserted = await client.query(`
        INSERT INTO space_pins (user_id, space_id, position, created_at)
        SELECT $1, id, ordinal - 1, $3 FROM unnest($2::text[]) WITH ORDINALITY AS requested(id, ordinal)
        ORDER BY ordinal ON CONFLICT DO NOTHING`, [userId, spaceIds, createdAt]);
      if (inserted.rowCount !== spaceIds.length) throw new Error("Incomplete space pin replacement");
      return { customized: true, spaces: await listSpaceViews(client, userId, "pins") };
    });
  }

  resetPins(userId: string, defaultLimit: number): Promise<StoredSpacePins> {
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("DELETE FROM space_pins WHERE user_id = $1", [userId]);
      return { customized: false, spaces: await listSpaceViews(client, userId, "mine", defaultLimit) };
    });
  }
}
