import type { DatabaseSync } from "node:sqlite";
import type {
  ProductUnitCreation,
  ProductWorktreeUnitCreation,
  UnitCreationFactsReader,
} from "../unit-creation-facts.js";

export function createSqliteUnitCreationFactsReader(database: DatabaseSync): UnitCreationFactsReader {
  return {
    async read() {
      if (database.prepare("PRAGMA user_version").get()?.user_version !== 35) {
        throw new Error("Prepare the product database to V35 before migrating the Collaboration database.");
      }
      const units = database.prepare(`
        SELECT univer.unit_id AS unitId, node.created_by AS creatorId, node.created_at AS createdAt
        FROM univer_resources AS univer
        JOIN resources AS resource ON resource.id = univer.resource_id
        JOIN nodes AS node ON node.id = resource.node_id
      `).all() as unknown as ProductUnitCreation[];
      const worktreeUnits = database.prepare(`
        SELECT worktree_id AS worktreeId, unit_id AS unitId, created_by AS creatorId, created_at AS createdAt
        FROM worktree_node_intents
      `).all() as unknown as ProductWorktreeUnitCreation[];
      return { units, worktreeUnits };
    },
  };
}
