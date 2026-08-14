import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export class WorkspaceDatabase {
  readonly connection: DatabaseSync;
  private _closed = false;

  constructor(filename: string) {
    this.connection = new DatabaseSync(filename);
    try {
      this.connection.exec("PRAGMA foreign_keys = ON");
      this.connection.exec("PRAGMA busy_timeout = 5000");
      if (filename !== ":memory:") {
        this.connection.exec("PRAGMA journal_mode = WAL");
      }
      this.connection.exec(readSchema());
      const version = this.connection
        .prepare("PRAGMA user_version")
        .get() as { readonly user_version: number };
      if (version.user_version !== 6) {
        throw new Error(
          `Unsupported product database version ${version.user_version}; expected 6.`
        );
      }
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }

  transaction<T>(operation: (database: DatabaseSync) => T): T {
    this._assertOpen();
    if (this.connection.isTransaction) {
      throw new Error("Nested product database transactions are not supported");
    }

    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(this.connection);
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.connection.isTransaction) this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.connection.close();
  }

  private _assertOpen(): void {
    if (this._closed) throw new Error("Product database is closed");
  }
}

function readSchema(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(`${directory}/schema.sql`, "utf8");
}
