/**
 * Durable `plugin_tree` SQLite helpers used by kernel boot.
 *
 * @see {@link migratePluginTree}
 * @see {@link seedPluginTree}
 * @see {@link listEnabledPluginTree}
 */
import type { SqlExec } from "./sql.ts";
import type { PluginTreeRow } from "./types.ts";

/**
 * Safely serialize a plugin config object to JSON text.
 */
function safeStringifyConfig(
  config: Record<string, unknown> | undefined,
  id: string
): string {
  try {
    return JSON.stringify(config ?? {});
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `plugin tree: invalid config for ${id} (cannot serialize to JSON): ${detail}`
    );
  }
}

/** Max bytes for `plugin_tree.id` / `plugin_tree.name`. */
export const PLUGIN_TREE_IDENTITY_MAX_BYTES = 128;

/**
 * Reject plugin ids/names that look like filesystem paths or URL/specifiers.
 */
export function assertPluginTreeIdentity(idOrName: string): void {
  if (typeof idOrName !== "string" || idOrName.length === 0) {
    throw new Error("plugin tree failed to load: invalid plugin identity");
  }
  if (idOrName.trim() !== idOrName) {
    throw new Error(
      `plugin tree failed to load: invalid plugin identity ${idOrName}`
    );
  }
  const bytes = new TextEncoder().encode(idOrName).byteLength;
  if (bytes > PLUGIN_TREE_IDENTITY_MAX_BYTES) {
    throw new Error(
      `plugin tree failed to load: invalid plugin identity ${idOrName}`
    );
  }
  if (
    idOrName.includes("\0") ||
    idOrName.includes("\\") ||
    idOrName.includes("..") ||
    idOrName.startsWith("/") ||
    idOrName.startsWith("./") ||
    /^(node|file|data|javascript|http|https):/i.test(idOrName)
  ) {
    throw new Error(
      `plugin tree failed to load: invalid plugin identity ${idOrName}`
    );
  }
}

export const migratedSql = new WeakSet<SqlExec>();
export const seededSql = new WeakSet<SqlExec>();

/**
 * Create-table DDL for the durable Cordis plugin tree.
 */
export const PLUGIN_TREE_TABLE_DDL = `CREATE TABLE IF NOT EXISTS plugin_tree (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  grouping TEXT
)`;

/**
 * Index DDL for `plugin_tree.disabled`.
 */
export const PLUGIN_TREE_INDEX_DDL = `CREATE INDEX IF NOT EXISTS idx_plugin_tree_disabled ON plugin_tree(disabled)`;

export const PLUGIN_TREE_DDL = `${PLUGIN_TREE_TABLE_DDL};
${PLUGIN_TREE_INDEX_DDL}`;

/**
 * Create `plugin_tree` if it does not exist.
 */
export function migratePluginTree(sql: SqlExec): void {
  if (migratedSql.has(sql)) return;
  sql.exec(PLUGIN_TREE_TABLE_DDL);
  sql.exec(PLUGIN_TREE_INDEX_DDL);
  migratedSql.add(sql);
}

/**
 * Insert `rows` only when `plugin_tree` is empty (first boot).
 */
export function seedPluginTree(sql: SqlExec, rows: PluginTreeRow[]): void {
  if (seededSql.has(sql)) return;
  const count = sql
    .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM plugin_tree`)
    .toArray()[0]?.n;
  if ((count ?? 0) > 0) {
    seededSql.add(sql);
    return;
  }
  for (const row of rows) {
    assertPluginTreeIdentity(row.id);
    assertPluginTreeIdentity(row.name);
    sql.exec(
      `INSERT INTO plugin_tree (id, name, disabled, config, grouping) VALUES (?, ?, ?, ?, ?)`,
      row.id,
      row.name,
      row.disabled,
      safeStringifyConfig(row.config, row.id),
      row.grouping ?? null
    );
  }
  seededSql.add(sql);
}

/**
 * Insert one seed row if missing. Does not rewrite existing config.
 */
export function ensurePluginTreeRow(sql: SqlExec, row: PluginTreeRow): boolean {
  assertPluginTreeIdentity(row.id);
  assertPluginTreeIdentity(row.name);
  const existing = sql
    .exec<{ id: string }>(`SELECT id FROM plugin_tree WHERE id = ?`, row.id)
    .toArray()[0];
  if (existing) return false;
  sql.exec(
    `INSERT INTO plugin_tree (id, name, disabled, config, grouping) VALUES (?, ?, ?, ?, ?)`,
    row.id,
    row.name,
    row.disabled,
    safeStringifyConfig(row.config, row.id),
    row.grouping ?? null
  );
  return true;
}

/**
 * Parse a `plugin_tree.config` JSON text (or object) into a plain object.
 */
export function parseRowConfig(
  raw: unknown,
  id: string,
  strict: boolean = true
): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") {
    if (strict) {
      throw new Error(`plugin tree: invalid config for ${id} (expected string/object)`);
    }
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
    if (strict) {
      throw new Error(`plugin tree: invalid config for ${id} (expected JSON object)`);
    }
    return {};
  } catch (err) {
    if (strict) {
      throw new Error(
        `plugin tree: invalid config for ${id} (JSON parse error): ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return {};
  }
}

/**
 * Enabled (`disabled = 0`) plugin rows in id order, with `config` parsed as JSON.
 */
export function listEnabledPluginTree(sql: SqlExec): PluginTreeRow[] {
  return sql
    .exec<{
      id: string;
      name: string;
      disabled: number;
      config: string;
      grouping: string | null;
    }>(
      `SELECT id, name, disabled, config, grouping FROM plugin_tree WHERE disabled = 0 ORDER BY id`
    )
    .toArray()
    .map((row) => ({
      id: row.id,
      name: row.name,
      disabled: row.disabled,
      config: parseRowConfig(row.config, row.id, true),
      grouping: row.grouping
    }));
}
