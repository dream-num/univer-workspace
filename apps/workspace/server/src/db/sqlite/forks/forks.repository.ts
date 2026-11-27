import type { DatabaseSync } from "node:sqlite";
import type { CreateForkResult, ForksRepository, StoredFork } from "../../../modules/forks/index.js";
import { assertForkQuota, ownsSpaceSql } from "../access/access.repository.js";
import type { SqliteDatabase } from "../connection.js";

const forkColumns = `
  forks.id, forks.owner_user_id AS ownerUserId, users.username AS ownerUsername,
  forks.upstream_space_id AS upstreamSpaceId, forks.name, forks.created_at AS createdAt,
  (SELECT id FROM worktrees WHERE fork_id = forks.id AND processed_at IS NULL) AS openWorktreeId
  FROM forks JOIN users ON users.id = forks.owner_user_id`;

type ForkKey = Parameters<ForksRepository["findOwned"]>[1];

const reachable = ownsSpaceSql("forks.owner_user_id", "$actorUserId");

function findFork(database: DatabaseSync, actorUserId: string, key: ForkKey): StoredFork | null {
  const where = "forkId" in key
    ? "forks.id = $forkId"
    : "users.username = $username AND forks.name = $name";
  return (database.prepare(`SELECT ${forkColumns} WHERE ${reachable} AND ${where}`)
    .get({ actorUserId, ...key }) as StoredFork | undefined) ?? null;
}

export class SqliteForksRepository implements ForksRepository {
  constructor(private readonly _database: SqliteDatabase) {}

  async create(input: Parameters<ForksRepository["create"]>[0]): Promise<CreateForkResult> {
    return this._database.transaction((database) => {
      const existing = database.prepare("SELECT upstream_space_id AS upstreamSpaceId, id FROM forks WHERE owner_user_id = ? AND name = ?")
        .get(input.ownerUserId, input.name) as { upstreamSpaceId: string; id: string } | undefined;
      if (existing) {
        if (existing.upstreamSpaceId !== input.upstreamSpaceId) return { status: "nameTaken" };
        return { status: "existing", fork: findFork(database, input.ownerUserId, { forkId: existing.id })! };
      }
      assertForkQuota(database, input.ownerUserId);
      if (database.prepare("SELECT 1 FROM spaces WHERE owner_user_id = ? AND slug = ?").get(input.ownerUserId, input.name)) {
        return { status: "nameTaken" };
      }
      database.prepare("INSERT INTO forks (id, owner_user_id, upstream_space_id, name, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(input.id, input.ownerUserId, input.upstreamSpaceId, input.name, input.createdAt);
      return { status: "created", fork: findFork(database, input.ownerUserId, { forkId: input.id })! };
    });
  }

  async listOwned(actorUserId: string): Promise<StoredFork[]> {
    return this._database.connection.prepare(`SELECT ${forkColumns} WHERE ${reachable} ORDER BY forks.name, forks.id`)
      .all({ actorUserId }) as unknown as StoredFork[];
  }

  async findOwned(actorUserId: string, key: ForkKey): Promise<StoredFork | null> {
    return findFork(this._database.connection, actorUserId, key);
  }

  async deleteOwned(actorUserId: string, forkId: string): Promise<StoredFork | null> {
    return this._database.transaction((database) => {
      const fork = findFork(database, actorUserId, { forkId });
      if (fork) database.prepare("DELETE FROM forks WHERE id = ?").run(forkId);
      return fork;
    });
  }
}
