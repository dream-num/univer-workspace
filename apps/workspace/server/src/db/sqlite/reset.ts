import type { ProductDatabaseConfig } from "../product-database.js";
import { removeSqliteDatabaseFiles } from "../../integrations/sqlite/files.js";
import { openWorkspaceDatabase } from "./initialize.js";

export function resetSqliteProductDatabase({ filename }: ProductDatabaseConfig): void {
  removeSqliteDatabaseFiles(filename);
  openWorkspaceDatabase(filename).close();
}
