import type { WorkspaceDatabaseConfig } from "../../../config.js";
import type { UnitCreationFactsReader } from "../../../db/index.js";
import type { CollaborationDatabase } from "./collaboration-database.js";

export async function openCollaborationDatabase(
  config: WorkspaceDatabaseConfig,
  productFacts: UnitCreationFactsReader,
): Promise<CollaborationDatabase> {
  if (config.provider === "postgres") {
    const { openPostgresCollaborationDatabase } = await import("./postgres/open.js");
    return openPostgresCollaborationDatabase(config.connectionString);
  }
  const { openSqliteCollaborationDatabase } = await import("./sqlite/open.js");
  return openSqliteCollaborationDatabase(config.collaborationFilename, productFacts);
}
