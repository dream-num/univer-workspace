import { existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface UnitCreation {
  readonly creatorID: string;
  readonly createdAt: number;
}

export interface UnitCreationResolvers {
  resolveUnitCreation(unitID: string): UnitCreation;
  resolveWorktreeUnitCreation(worktreeID: string, unitID: string): UnitCreation;
}

interface CreationFact {
  readonly creatorID?: string;
  readonly createdAt?: number;
}

const ANONYMOUS = "anonymous";

/**
 * Creation facts for the SDK 1.0.0 Core and Worktree migrations. A resolver
 * replaces the SDK's own History V1 lookup, so History stays first and product
 * records fill what History lacks before falling back to the SDK defaults.
 * Everything is read up front: the SDK migrations use a different SQLite
 * library, and two libraries must not hold the same file open concurrently.
 */
export function readUnitCreationFacts(
  collaboration: DatabaseSync,
  productDatabaseFilename: string,
  fallbackTime: number,
): UnitCreationResolvers {
  const history = new Map<string, CreationFact>();
  if (hasTable(collaboration, "collaboration_history_revisions")) {
    for (const row of collaboration
      .prepare(
        "SELECT unit_id, user_id, committed_at FROM collaboration_history_revisions WHERE revision = 1",
      )
      .all()) {
      history.set(String(row.unit_id), fact(row.user_id, row.committed_at));
    }
  }
  const worktreeSources = new Map<string, string>();
  if (hasTable(collaboration, "collaboration_worktree_units")) {
    for (const row of collaboration
      .prepare("SELECT worktree_id, unit_id, source FROM collaboration_worktree_units")
      .all()) {
      worktreeSources.set(
        worktreeKey(String(row.worktree_id), String(row.unit_id)),
        String(row.source),
      );
    }
  }
  const product = readProductFacts(productDatabaseFilename);

  const resolveUnitCreation = (unitID: string) =>
    merge([history.get(unitID), product.units.get(unitID)], fallbackTime);
  return {
    resolveUnitCreation,
    resolveWorktreeUnitCreation(worktreeID, unitID) {
      const key = worktreeKey(worktreeID, unitID);
      return worktreeSources.get(key) === "worktree"
        ? merge([product.worktreeUnits.get(key)], fallbackTime)
        : resolveUnitCreation(unitID);
    },
  };
}

function readProductFacts(filename: string): {
  readonly units: ReadonlyMap<string, CreationFact>;
  readonly worktreeUnits: ReadonlyMap<string, CreationFact>;
} {
  const units = new Map<string, CreationFact>();
  const worktreeUnits = new Map<string, CreationFact>();
  if (!existsSync(filename) || statSync(filename).size === 0) {
    return { units, worktreeUnits };
  }
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    if (database.prepare("PRAGMA user_version").get()?.user_version !== 7) {
      throw new Error(
        "Prepare the product database to V7 before migrating the Collaboration database.",
      );
    }
    for (const row of database
      .prepare(
        `SELECT univer.unit_id, node.created_by, node.created_at
         FROM univer_resources AS univer
         JOIN resources AS resource ON resource.id = univer.resource_id
         JOIN nodes AS node ON node.id = resource.node_id`,
      )
      .all()) {
      units.set(String(row.unit_id), fact(row.created_by, row.created_at));
    }
    for (const row of database
      .prepare(
        "SELECT worktree_id, unit_id, created_by, created_at FROM worktree_node_intents",
      )
      .all()) {
      worktreeUnits.set(
        worktreeKey(String(row.worktree_id), String(row.unit_id)),
        fact(row.created_by, row.created_at),
      );
    }
  } finally {
    database.close();
  }
  return { units, worktreeUnits };
}

function merge(
  candidates: readonly (CreationFact | undefined)[],
  fallbackTime: number,
): UnitCreation {
  return {
    creatorID:
      candidates.find((candidate) => candidate?.creatorID !== undefined)?.creatorID ??
      ANONYMOUS,
    createdAt:
      candidates.find((candidate) => candidate?.createdAt !== undefined)?.createdAt ??
      fallbackTime,
  };
}

function fact(creatorID: unknown, createdAt: unknown): CreationFact {
  return {
    ...(typeof creatorID === "string" && creatorID.length > 0 ? { creatorID } : {}),
    ...(typeof createdAt === "number" && Number.isSafeInteger(createdAt) && createdAt >= 0
      ? { createdAt }
      : {}),
  };
}

function worktreeKey(worktreeID: string, unitID: string): string {
  return `${worktreeID}\u0000${unitID}`;
}

function hasTable(database: DatabaseSync, name: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(name),
  );
}
