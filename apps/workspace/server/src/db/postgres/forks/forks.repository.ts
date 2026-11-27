import type { Pool, PoolClient } from "pg";
import type { CreateForkResult, ForksRepository, StoredFork } from "../../../modules/forks/index.js";
import { assertForkQuota, ownsSpaceSql } from "../access/access.repository.js";
import { withPostgresTransaction } from "../transaction.js";

const forkColumns = `
  forks.id, forks.owner_user_id AS "ownerUserId", users.username AS "ownerUsername",
  forks.upstream_space_id AS "upstreamSpaceId", forks.name, forks.created_at AS "createdAt",
  (SELECT id FROM worktrees WHERE fork_id = forks.id AND processed_at IS NULL) AS "openWorktreeId"
  FROM forks JOIN users ON users.id = forks.owner_user_id`;

type ForkKey = Parameters<ForksRepository["findOwned"]>[1];
type ForkRow = Omit<StoredFork, "createdAt"> & { readonly createdAt: string };

const stored = (row: ForkRow): StoredFork => ({ ...row, createdAt: Number(row.createdAt) });

const reachable = ownsSpaceSql("forks.owner_user_id", "$1");

async function findFork(db: Pool | PoolClient, actorUserId: string, key: ForkKey): Promise<StoredFork | null> {
  const [where, values] = "forkId" in key
    ? ["forks.id = $2", [key.forkId]]
    : [`lower(users.username COLLATE "C") = lower($2::text COLLATE "C") AND lower(forks.name COLLATE "C") = lower($3::text COLLATE "C")`, [key.username, key.name]];
  const { rows: [row] } = await db.query<ForkRow>(`SELECT ${forkColumns} WHERE ${reachable} AND ${where}`, [actorUserId, ...values]);
  return row ? stored(row) : null;
}

export class PostgresForksRepository implements ForksRepository {
  constructor(private readonly pool: Pool) {}

  create(input: Parameters<ForksRepository["create"]>[0]): Promise<CreateForkResult> {
    return withPostgresTransaction(this.pool, async (client) => {
      const { rows: [existing] } = await client.query<{ id: string; upstreamSpaceId: string }>(
        `SELECT id, upstream_space_id AS "upstreamSpaceId" FROM forks
         WHERE owner_user_id = $1 AND lower(name COLLATE "C") = lower($2::text COLLATE "C")`, [input.ownerUserId, input.name]);
      if (existing) {
        if (existing.upstreamSpaceId !== input.upstreamSpaceId) return { status: "nameTaken" };
        return { status: "existing", fork: (await findFork(client, input.ownerUserId, { forkId: existing.id }))! };
      }
      await assertForkQuota(client, input.ownerUserId);
      const slug = await client.query(
        `SELECT 1 FROM spaces WHERE owner_user_id = $1 AND lower(slug COLLATE "C") = lower($2::text COLLATE "C")`, [input.ownerUserId, input.name]);
      if (slug.rowCount) return { status: "nameTaken" };
      await client.query("INSERT INTO forks (id, owner_user_id, upstream_space_id, name, created_at) VALUES ($1, $2, $3, $4, $5)",
        [input.id, input.ownerUserId, input.upstreamSpaceId, input.name, input.createdAt]);
      return { status: "created", fork: (await findFork(client, input.ownerUserId, { forkId: input.id }))! };
    });
  }

  async listOwned(actorUserId: string): Promise<StoredFork[]> {
    const { rows } = await this.pool.query<ForkRow>(
      `SELECT ${forkColumns} WHERE ${reachable} ORDER BY lower(forks.name COLLATE "C"), forks.id`, [actorUserId]);
    return rows.map(stored);
  }

  findOwned(actorUserId: string, key: ForkKey): Promise<StoredFork | null> {
    return findFork(this.pool, actorUserId, key);
  }

  deleteOwned(actorUserId: string, forkId: string): Promise<StoredFork | null> {
    return withPostgresTransaction(this.pool, async (client) => {
      const fork = await findFork(client, actorUserId, { forkId });
      if (fork) await client.query("DELETE FROM forks WHERE id = $1", [forkId]);
      return fork;
    });
  }
}
