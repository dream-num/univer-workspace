import { DatabaseSync } from "node:sqlite";

const PRODUCT_SCHEMA_VERSION = 6;
const REQUIRED_TABLES = [
  "users",
  "spaces",
  "nodes",
  "resources",
  "univer_resources",
  "worktree_node_intents",
  "worktrees",
  "operations",
  "blob_resources",
  "blob_upload_sessions",
  "object_deletion_jobs",
  "univer_assets",
] as const;

/** A query-only view of the Workspace-owned product database. */
export class ProductDatabaseReader {
  readonly connection: DatabaseSync;
  private _closed = false;

  constructor(filename: string) {
    this.connection = new DatabaseSync(filename, { readOnly: true });
    try {
      this.connection.exec("PRAGMA query_only = ON");
      this.connection.exec("PRAGMA busy_timeout = 5000");
      const version = this.connection.prepare("PRAGMA user_version").get() as {
        readonly user_version: number;
      };
      if (version.user_version !== PRODUCT_SCHEMA_VERSION) {
        throw new Error(
          `Unsupported Workspace product database version ${version.user_version}; expected ${PRODUCT_SCHEMA_VERSION}.`
        );
      }
      for (const table of REQUIRED_TABLES) {
        const found = this.connection
          .prepare(
            "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?"
          )
          .get(table);
        if (!found) {
          throw new Error(`Workspace product database table ${table} is unavailable.`);
        }
      }
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.connection.close();
  }
}
