import type { DatabaseSync } from "node:sqlite";
import type { UnitCreationFactsReader } from "../../../../../db/index.js";

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
export async function readUnitCreationFacts(
  collaboration: DatabaseSync,
  reader: UnitCreationFactsReader,
  fallbackTime: number,
): Promise<UnitCreationResolvers> {
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
  const product = await reader.read();
  const units = new Map(product.units.map((row) => [row.unitId, fact(row.creatorId, row.createdAt)]));
  const worktreeUnits = new Map(product.worktreeUnits.map((row) => [
    worktreeKey(row.worktreeId, row.unitId),
    fact(row.creatorId, row.createdAt),
  ]));

  const resolveUnitCreation = (unitID: string) =>
    merge([history.get(unitID), units.get(unitID)], fallbackTime);
  return {
    resolveUnitCreation,
    resolveWorktreeUnitCreation(worktreeID, unitID) {
      const key = worktreeKey(worktreeID, unitID);
      return worktreeSources.get(key) === "worktree"
        ? merge([worktreeUnits.get(key)], fallbackTime)
        : resolveUnitCreation(unitID);
    },
  };
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
