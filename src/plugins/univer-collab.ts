/**
 * Pure edge Univer Collaboration service running inside Cloudflare Durable Object.
 * Manages document snapshots, OT changesets, and real-time synchronization.
 */
import type { Context } from "@deepseek-ai/cordis";
import type { SqlExec } from "../kernel/sql.ts";

export const UNIVER_COLLAB_DDL = `
CREATE TABLE IF NOT EXISTS univer_units (
  unit_id TEXT PRIMARY KEY,
  type INTEGER NOT NULL, -- 1: Sheet, 2: Doc, 3: Slide
  name TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS univer_snapshots (
  unit_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  snapshot_data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (unit_id, rev),
  FOREIGN KEY (unit_id) REFERENCES univer_units(unit_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS univer_changesets (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  mutation TEXT NOT NULL,
  inverse_mutation TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (unit_id) REFERENCES univer_units(unit_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_univer_changesets_unit_rev ON univer_changesets(unit_id, rev ASC);
`;

export interface ChangesetPayload {
  id: string;
  unitId: string;
  rev: number;
  clientId: string;
  mutation: Record<string, unknown>;
  inverseMutation: Record<string, unknown>;
}

export class UniverCollabService {
  constructor(private readonly ctx: Context, private readonly sql: SqlExec) {
    this.initDatabase();
  }

  private initDatabase(): void {
    const statements = UNIVER_COLLAB_DDL.split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      this.sql.exec(statement);
    }
  }

  getUnit(unitId: string) {
    return this.sql
      .exec(`SELECT * FROM univer_units WHERE unit_id = ?`, unitId)
      .toArray()[0];
  }

  createUnit(unitId: string, type: number, name: string, initialSnapshot?: Record<string, unknown>) {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO univer_units (unit_id, type, name, rev, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT(unit_id) DO UPDATE SET updated_at = ?`,
      unitId, type, name, now, now, now
    );
    if (initialSnapshot) {
      this.saveSnapshot(unitId, 0, initialSnapshot);
    }
    return { unitId, type, name, rev: 0 };
  }

  saveSnapshot(unitId: string, rev: number, data: Record<string, unknown>) {
    this.sql.exec(
      `INSERT OR REPLACE INTO univer_snapshots (unit_id, rev, snapshot_data, created_at)
       VALUES (?, ?, ?, ?)`,
      unitId, rev, JSON.stringify(data), Date.now()
    );
  }

  getLatestSnapshot(unitId: string) {
    const row = this.sql
      .exec<{ snapshot_data: string; rev: number }>(
        `SELECT snapshot_data, rev FROM univer_snapshots WHERE unit_id = ? ORDER BY rev DESC LIMIT 1`,
        unitId
      )
      .toArray()[0];
    if (!row) return null;
    return {
      rev: row.rev,
      data: JSON.parse(row.snapshot_data)
    };
  }

  applyChangeset(payload: ChangesetPayload) {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO univer_changesets (id, unit_id, rev, client_id, mutation, inverse_mutation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      payload.id,
      payload.unitId,
      payload.rev,
      payload.clientId,
      JSON.stringify(payload.mutation),
      JSON.stringify(payload.inverseMutation),
      now
    );
    this.sql.exec(
      `UPDATE univer_units SET rev = ?, updated_at = ? WHERE unit_id = ?`,
      payload.rev,
      now,
      payload.unitId
    );
    return { success: true, rev: payload.rev };
  }

  getChangesetsSince(unitId: string, sinceRev: number) {
    return this.sql
      .exec<{
        id: string;
        unit_id: string;
        rev: number;
        client_id: string;
        mutation: string;
        inverse_mutation: string;
        created_at: number;
      }>(
        `SELECT * FROM univer_changesets WHERE unit_id = ? AND rev > ? ORDER BY rev ASC`,
        unitId,
        sinceRev
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        unitId: row.unit_id,
        rev: row.rev,
        clientId: row.client_id,
        mutation: JSON.parse(row.mutation),
        inverseMutation: JSON.parse(row.inverse_mutation),
        createdAt: row.created_at
      }));
  }
}

export const name = "univer-collab";

export function apply(ctx: Context): void {
  const host = ctx.get("host") as { sql?: SqlExec } | undefined;
  if (!host?.sql) {
    return;
  }
  const collabService = new UniverCollabService(ctx, host.sql);
  ctx.provide("collab", collabService);
}
