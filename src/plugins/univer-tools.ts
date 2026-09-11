/**
 * Universal Actions & Agent Tools for Univer Workspace inside Cloudflare Durable Object.
 * Implements Revertible Effects (\mathfrak{E}_\Gamma) in the twisted composition monoid.
 */
import type { Context } from "@deepseek-ai/cordis";
import type { SqlExec } from "../kernel/sql.ts";

export const UNIVER_TOOLS_DDL = `
CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  baseline_rev INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'ready', 'merged', 'discarded')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worktree_changes (
  id TEXT PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  mutation TEXT NOT NULL,
  inverse_mutation TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_worktree_changes_wt ON worktree_changes(worktree_id, applied_at ASC);

CREATE TABLE IF NOT EXISTS ast_crdt_journal (
  id TEXT PRIMARY KEY,
  node_path TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('insert', 'replace', 'delete', 'attribute')),
  payload TEXT NOT NULL,
  inverse_payload TEXT NOT NULL,
  lamport_clock INTEGER NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ast_crdt_clock ON ast_crdt_journal(lamport_clock ASC);
`;

export class UniverToolsService {
  constructor(private readonly ctx: Context, private readonly sql: SqlExec) {
    this.initDatabase();
  }

  private initDatabase(): void {
    const statements = UNIVER_TOOLS_DDL.split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      this.sql.exec(statement);
    }
  }

  createWorktree(id: string, name: string, baselineRev: number, createdBy: string) {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO worktrees (id, name, baseline_rev, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      id, name, baselineRev, createdBy, now, now
    );
    return { id, name, baselineRev, status: "draft" };
  }

  recordWorktreeChange(id: string, worktreeId: string, unitId: string, mutation: unknown, inverseMutation: unknown) {
    this.sql.exec(
      `INSERT INTO worktree_changes (id, worktree_id, unit_id, mutation, inverse_mutation, applied_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, worktreeId, unitId, JSON.stringify(mutation), JSON.stringify(inverseMutation), Date.now()
    );
  }

  getWorktreeChanges(worktreeId: string) {
    return this.sql
      .exec<{
        id: string;
        worktree_id: string;
        unit_id: string;
        mutation: string;
        inverse_mutation: string;
        applied_at: number;
      }>(`SELECT * FROM worktree_changes WHERE worktree_id = ? ORDER BY applied_at ASC`, worktreeId)
      .toArray()
      .map((row) => ({
        id: row.id,
        worktreeId: row.worktree_id,
        unitId: row.unit_id,
        mutation: JSON.parse(row.mutation),
        inverseMutation: JSON.parse(row.inverse_mutation),
        appliedAt: row.applied_at
      }));
  }

  setWorktreeStatus(worktreeId: string, status: "draft" | "ready" | "merged" | "discarded") {
    this.sql.exec(
      `UPDATE worktrees SET status = ?, updated_at = ? WHERE id = ?`,
      status, Date.now(), worktreeId
    );
  }
}

export const name = "univer-tools";

export function apply(ctx: Context): void {
  const host = ctx.get("host") as { sql?: SqlExec } | undefined;
  if (!host?.sql) {
    return;
  }
  const toolsService = new UniverToolsService(ctx, host.sql);
  ctx.provide("worktrees", toolsService);
}
