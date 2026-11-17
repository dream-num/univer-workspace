import type { WorkspaceConfig } from "../../../config.js";
import type { UnitCreationFactsReader } from "../../../db/index.js";
import type { CollaborationDatabase } from "./collaboration-database.js";

export async function openCollaborationDatabase(
  { database, s3BlobStore }: Pick<WorkspaceConfig, "database" | "s3BlobStore">,
  productFacts: UnitCreationFactsReader,
): Promise<CollaborationDatabase> {
  if (database.provider === "postgres") {
    if (!s3BlobStore) throw new Error("PostgreSQL collaboration requires S3 storage");
    const { openPostgresCollaborationDatabase } = await import("./postgres/open.js");
    return openPostgresCollaborationDatabase(database.connectionString, s3BlobStore);
  }
  const { openSqliteCollaborationDatabase } = await import("./sqlite/open.js");
  return openSqliteCollaborationDatabase(database.collaborationFilename, productFacts);
}
