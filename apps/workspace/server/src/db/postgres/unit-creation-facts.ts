import type { PostgresDatabase } from "./connection.js";
import type {
  ProductUnitCreation,
  ProductWorktreeUnitCreation,
  UnitCreationFactsReader,
} from "../unit-creation-facts.js";

export function createPostgresUnitCreationFactsReader(database: PostgresDatabase): UnitCreationFactsReader {
  return {
    read: () => database.transaction(async () => {
      const units = await database.prepare(`
        SELECT univer.unit_id AS "unitId", node.created_by AS "creatorId", node.created_at AS "createdAt"
        FROM univer_resources AS univer
        JOIN resources AS resource ON resource.id = univer.resource_id
        JOIN nodes AS node ON node.id = resource.node_id
      `).all() as unknown as ProductUnitCreation[];
      const worktreeUnits = await database.prepare(`
        SELECT worktree_id AS "worktreeId", unit_id AS "unitId", created_by AS "creatorId", created_at AS "createdAt"
        FROM worktree_node_intents
      `).all() as unknown as ProductWorktreeUnitCreation[];
      return { units, worktreeUnits };
    }),
  };
}
