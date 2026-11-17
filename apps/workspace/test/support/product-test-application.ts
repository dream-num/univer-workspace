import { createTestBucket } from "./postgres/s3.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { createPostgresTestDatabase } from "./postgres/schema.js";

export type ProductTestApplication = Awaited<ReturnType<typeof createProductTestApplication>>;

export async function createProductTestApplication(
  { productFilename, collaborationDatabaseFilename, ...settings }: Partial<Omit<WorkspaceConfig, "database">> & { productFilename: string; collaborationDatabaseFilename: string },
  dependencies?: Parameters<typeof createWorkspaceApplication>[3],
) {
  const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
  const postgres = url ? await createPostgresTestDatabase(url) : undefined;
  const cleanup = new AsyncDisposableStack();
  if (postgres) cleanup.defer(postgres.close);
  try {
    const config: WorkspaceConfig = {
      ...loadConfig({}), ...settings,
      ...(postgres && { s3BlobStore: await createTestBucket(cleanup) }),
      database: postgres
        ? { provider: "postgres", connectionString: postgres.connectionString }
        : { provider: "sqlite", filename: productFilename, collaborationFilename: collaborationDatabaseFilename },
    };
    const database = await openProductDatabase(config.database);
    cleanup.defer(() => database.close());
    const collaboration = await openCollaborationDatabase(config, database.unitCreationFacts);
    cleanup.defer(() => collaboration.close());
    const application = createWorkspaceApplication(config, database.repositories, collaboration, dependencies);
    cleanup.defer(() => application.close());
    await application.initialize();
    return {
      ...application,
      repositories: database.repositories,
      postgresUrl: postgres?.connectionString,
      close: () => cleanup.disposeAsync(),
    };
  } catch (error) {
    await cleanup.disposeAsync();
    throw error;
  }
}
