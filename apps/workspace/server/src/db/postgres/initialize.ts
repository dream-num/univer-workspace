import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { planDisplayNameRepair, type StoredDisplayName, type StoredPersonalSpaceName } from "../display-name-repair.js";

export async function productSchemaFingerprint(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ definition: string }>(`
    SELECT definition FROM (
      SELECT concat_ws('|', 'column', table_name, column_name, data_type, is_nullable,
                       column_default, is_identity) AS definition
      FROM information_schema.columns WHERE table_schema = current_schema()
      UNION ALL
      SELECT concat_ws('|', 'constraint', conrelid::regclass::text, conname, pg_get_constraintdef(oid))
      FROM pg_constraint WHERE connamespace = current_schema()::regnamespace
      UNION ALL
      SELECT concat_ws('|', 'index', indexname, indexdef) FROM pg_indexes WHERE schemaname = current_schema()
      UNION ALL
      SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = current_schema()::regnamespace AND NOT t.tgisinternal
      UNION ALL
      SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace = current_schema()::regnamespace AND prokind = 'f'
    ) AS structure ORDER BY definition COLLATE "C"`);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

// UPGRADES[n - 1] takes schema version n to n + 1 and must leave the structure schema.sql creates.
const UPGRADES: readonly ((client: PoolClient) => Promise<void>)[] = [repairDisplayNames, createExecutorAccess, addCopySource, repairDisplayNames, addDraftSourceWorktree, addDraftRevisions, addForks, addProposals, addIssueLink, addIssueVerdicts, addWorktreeChecks, addLanding];
const VERSION = UPGRADES.length + 1;

// Scope, failure semantics and exit condition: see planDisplayNameRepair in db/display-name-repair.ts.
async function repairDisplayNames(client: PoolClient): Promise<void> {
  const users = await client.query<StoredDisplayName>("SELECT id, username, display_name FROM users");
  const spaces = await client.query<StoredPersonalSpaceName>("SELECT id, owner_user_id, name FROM spaces WHERE type = 'personal'");
  const repair = planDisplayNameRepair(users.rows, spaces.rows);
  for (const { id, displayName } of repair.users) await client.query("UPDATE users SET display_name = $2 WHERE id = $1", [id, displayName]);
  for (const { id, name } of repair.spaces) await client.query("UPDATE spaces SET name = $2 WHERE id = $1", [id, name]);
}

async function createExecutorAccess(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE executor_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at BIGINT NOT NULL
)`);
}

// The copy source on Nodes and Worktree intents, two Link Sharing columns and the copy Operation kind.
// Existing rows read NULL, 'viewer' and NULL.
async function addCopySource(client: PoolClient): Promise<void> {
  await client.query(`
ALTER TABLE nodes ADD COLUMN copied_from_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL;
CREATE INDEX nodes_copied_from
  ON nodes(copied_from_node_id)
  WHERE copied_from_node_id IS NOT NULL;
ALTER TABLE worktree_node_intents ADD COLUMN copied_from_node_id TEXT;
ALTER TABLE node_link_sharing ADD COLUMN unverified_role TEXT NOT NULL DEFAULT 'viewer' CHECK (unverified_role IN ('editor', 'viewer'));
ALTER TABLE node_link_sharing ADD COLUMN making_of_note TEXT;
ALTER TABLE operations DROP CONSTRAINT operations_kind_check;
ALTER TABLE operations ADD CONSTRAINT operations_kind_check CHECK (
  kind IN (
    'create_resource',
    'create_blob_resource',
    'replace_blob_content',
    'create_worktree',
    'add_worktree_unit',
    'create_worktree_unit',
    'merge_worktree',
    'discard_worktree',
    'activate_worktree_resource',
    'copy_node'
  )
);`);
}

async function addDraftSourceWorktree(client: PoolClient): Promise<void> {
  await client.query(`ALTER TABLE html_view_drafts ADD COLUMN source_worktree_id TEXT;
CREATE INDEX html_view_drafts_source_worktree
  ON html_view_drafts(source_worktree_id, expires_at, id) WHERE state = 'pending';`);
}

async function addDraftRevisions(client: PoolClient): Promise<void> {
  await client.query(`ALTER TABLE html_view_drafts ADD COLUMN superseded_by TEXT;
ALTER TABLE html_view_drafts ADD COLUMN revises_draft_id TEXT;
ALTER TABLE html_view_drafts DROP CONSTRAINT html_view_drafts_state_check;
ALTER TABLE html_view_drafts ADD CONSTRAINT html_view_drafts_state_check
  CHECK (state IN ('receiving', 'pending', 'published', 'rejected', 'expired', 'conflicted', 'superseded'));`);
}

async function addForks(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE forks (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  upstream_space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (upstream_space_id) REFERENCES spaces(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX forks_owner_name
  ON forks(owner_user_id, lower(name COLLATE "C"));
ALTER TABLE worktrees ADD COLUMN fork_id TEXT REFERENCES forks(id) ON DELETE SET NULL;
ALTER TABLE worktrees ADD CONSTRAINT worktrees_fork_team CHECK (fork_id IS NULL OR kind = 'team');
CREATE UNIQUE INDEX worktrees_open_fork
  ON worktrees(fork_id)
  WHERE fork_id IS NOT NULL AND processed_at IS NULL;`);
}

async function addProposals(client: PoolClient): Promise<void> {
  await client.query("ALTER TABLE spaces ADD COLUMN proposals TEXT NOT NULL DEFAULT 'members' CHECK (proposals IN ('members', 'accountable', 'anyone'))");
}

async function addIssueLink(client: PoolClient): Promise<void> {
  await client.query(`ALTER TABLE worktrees ADD COLUMN issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL;
ALTER TABLE worktrees ADD CONSTRAINT worktrees_issue_team CHECK (issue_id IS NULL OR kind = 'team');
CREATE INDEX worktrees_issue
  ON worktrees(issue_id)
  WHERE issue_id IS NOT NULL;`);
}

async function addIssueVerdicts(client: PoolClient): Promise<void> {
  await client.query(`ALTER TABLE spaces ADD COLUMN accept_after_hours INTEGER CHECK (accept_after_hours > 0);
CREATE TABLE issue_verdicts (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('submitted', 'accepted', 'sent_back', 'reverted')),
  actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL DEFAULT '',
  operation_id TEXT,
  created_at BIGINT NOT NULL,
  CHECK (actor_user_id IS NOT NULL OR kind = 'accepted'),
  CHECK (operation_id IS NULL OR kind = 'reverted')
);
CREATE INDEX issue_verdicts_issue ON issue_verdicts(issue_id, created_at, id);`);
}

async function addWorktreeChecks(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE worktree_checks (
  worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
  content_key TEXT NOT NULL,
  name TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('passed', 'failed')),
  summary TEXT NOT NULL DEFAULT '',
  reported_at BIGINT NOT NULL,
  PRIMARY KEY (worktree_id, content_key, name, reporter_user_id)
)`);
}

async function addLanding(client: PoolClient): Promise<void> {
  await client.query("ALTER TABLE spaces ADD COLUMN landing TEXT NOT NULL DEFAULT 'review' CHECK (landing IN ('review', 'checks'))");
}

export async function initializePostgresSchema(pool: Pool): Promise<void> {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Concurrent first starts must inspect the schema after the winning creator commits.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('univer-workspace-product'), hashtext(current_schema()))");
    const tables = await client.query<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relkind IN ('r','p','v','m','S','f')",
    );
    if (!tables.rowCount) {
      await client.query(sql);
      await client.query("CREATE TABLE workspace_product_schema (version integer PRIMARY KEY, fingerprint text NOT NULL)");
      await client.query("INSERT INTO workspace_product_schema VALUES ($1, $2)", [VERSION, await productSchemaFingerprint(client)]);
    } else {
      if (!tables.rows.some((row) => row.relname === "workspace_product_schema")) {
        throw new Error("PostgreSQL product database requires an empty schema or an initialized Workspace schema");
      }
      const { rows } = await client.query("SELECT version, fingerprint FROM workspace_product_schema");
      const stored = rows.length === 1 ? rows[0] : undefined;
      if (!stored || !Number.isInteger(stored.version) || stored.version < 1 || stored.version > VERSION || stored.fingerprint !== await productSchemaFingerprint(client)) {
        throw new Error("Unsupported or modified PostgreSQL product schema");
      }
      if (stored.version < VERSION) {
        for (const upgrade of UPGRADES.slice(stored.version - 1)) await upgrade(client);
        await client.query("UPDATE workspace_product_schema SET version = $1, fingerprint = $2", [VERSION, await productSchemaFingerprint(client)]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
