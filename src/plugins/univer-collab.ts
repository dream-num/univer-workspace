/**
 * Pure edge Univer Collaboration service running inside Cloudflare Durable Object.
 * Manages document snapshots, OT changesets, and real-time synchronization.
 */
import type { Context } from "@deepseek-ai/cordis";
import type { SqlExec } from "../kernel/sql.ts";

export const UNIVER_COLLAB_DDL = `
CREATE TABLE IF NOT EXISTS univer_units (
  unit_id TEXT PRIMARY KEY,
  type INTEGER NOT NULL, -- 1: Doc, 2: Sheet, 3: Slide
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
  mutation TEXT DEFAULT '',
  inverse_mutation TEXT DEFAULT '',
  changeset_data TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_univer_changesets_unit_rev ON univer_changesets(unit_id, rev ASC);
`;

export interface ChangesetPayload {
  id?: string;
  unitId?: string;
  unitID?: string;
  rev?: number;
  revision?: number;
  baseRev?: number;
  clientId?: string;
  memberID?: string;
  mutation?: Record<string, unknown>;
  inverseMutation?: Record<string, unknown>;
  [key: string]: any;
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
      try {
        this.sql.exec(statement);
      } catch (err) {
        console.warn("Collab DDL statement error:", err);
      }
    }
    // Migration: add changeset_data if missing
    try {
      this.sql.exec("ALTER TABLE univer_changesets ADD COLUMN changeset_data TEXT DEFAULT ''");
    } catch {}
  }

  getUnit(unitId: string) {
    return this.sql
      .exec<{ unit_id: string; type: number; name: string; rev: number; created_at: number; updated_at: number }>(
        `SELECT * FROM univer_units WHERE unit_id = ?`,
        unitId
      )
      .toArray()[0] ?? null;
  }

  createUnit(unitId: string, type: number, name: string, initialSnapshot?: Record<string, unknown>) {
    const now = Date.now();
    const rev = initialSnapshot ? ((initialSnapshot as any).rev || 1) : 0;
    this.sql.exec(
      `INSERT INTO univer_units (unit_id, type, name, rev, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(unit_id) DO UPDATE SET updated_at = ?, rev = MAX(univer_units.rev, ?)`,
      unitId, type, name, rev, now, now, now, rev
    );
    if (initialSnapshot) {
      this.saveSnapshot(unitId, rev, initialSnapshot);
    }
    return { unitId, type, name, rev };
  }

  saveSnapshot(unitId: string, rev: number, data: Record<string, unknown>) {
    const now = Date.now();
    this.sql.exec(
      `INSERT OR REPLACE INTO univer_snapshots (unit_id, rev, snapshot_data, created_at)
       VALUES (?, ?, ?, ?)`,
      unitId, rev, JSON.stringify(data), now
    );
    this.sql.exec(
      `UPDATE univer_units SET rev = MAX(rev, ?), updated_at = ? WHERE unit_id = ?`,
      rev, now, unitId
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
    try {
      return {
        rev: row.rev,
        data: JSON.parse(row.snapshot_data)
      };
    } catch {
      return null;
    }
  }

  applyChangeset(payload: ChangesetPayload, clientId: string = "") {
    const now = Date.now();
    const unitId = payload.unitID || payload.unitId || "";
    const rev = payload.revision ?? payload.rev ?? 1;
    const id = payload.id || `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const senderId = clientId || payload.memberID || payload.clientId || "";

    const rawChangeset = payload.changeset || payload;
    const changesetStr = JSON.stringify(rawChangeset);
    const mutationStr = payload.mutation ? JSON.stringify(payload.mutation) : "";
    const inverseMutationStr = payload.inverseMutation ? JSON.stringify(payload.inverseMutation) : "";

    this.sql.exec(
      `INSERT OR REPLACE INTO univer_changesets (id, unit_id, rev, client_id, mutation, inverse_mutation, changeset_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      unitId,
      rev,
      senderId,
      mutationStr,
      inverseMutationStr,
      changesetStr,
      now
    );

    this.sql.exec(
      `UPDATE univer_units SET rev = MAX(rev, ?), updated_at = ? WHERE unit_id = ?`,
      rev,
      now,
      unitId
    );

    return { success: true, rev };
  }

  getChangesetsSince(unitId: string, sinceRev: number, toRev?: number): any[] {
    let query = `SELECT mutation, inverse_mutation, changeset_data, rev, id, client_id, created_at
                 FROM univer_changesets WHERE unit_id = ? AND rev > ?`;
    const params: any[] = [unitId, sinceRev];
    if (typeof toRev === "number" && toRev > sinceRev) {
      query += ` AND rev <= ?`;
      params.push(toRev);
    }
    query += ` ORDER BY rev ASC`;

    return this.sql
      .exec<{
        id: string;
        rev: number;
        client_id: string;
        mutation: string;
        inverse_mutation: string;
        changeset_data: string;
        created_at: number;
      }>(query, ...params)
      .toArray()
      .map((row) => {
        if (row.changeset_data && row.changeset_data !== "{}") {
          try {
            return JSON.parse(row.changeset_data);
          } catch {}
        }
        return {
          id: row.id,
          unitID: unitId,
          rev: row.rev,
          revision: row.rev,
          clientId: row.client_id,
          mutation: row.mutation ? JSON.parse(row.mutation) : {},
          inverseMutation: row.inverse_mutation ? JSON.parse(row.inverse_mutation) : {},
          createdAt: row.created_at
        };
      });
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
