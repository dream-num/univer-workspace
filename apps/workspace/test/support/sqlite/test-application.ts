import { openCollaborationDatabase } from "../../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { createSqliteUnitCreationFactsReader } from "../../../server/src/db/sqlite/unit-creation-facts.js";
import { createWorkspaceApplication } from "../../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../../server/src/config.js";
import { openWorkspaceDatabase } from "../../../server/src/db/sqlite/initialize.js";
import { createSqliteRepositories } from "../../../server/src/db/sqlite/open.js";

export type SqliteTestApplication = Awaited<ReturnType<typeof createSqliteTestApplication>>;

/** Fixtures share the adapter connection to seed data and inspect transaction state, including :memory:. */
export async function createSqliteTestApplication(
  settings: Partial<WorkspaceConfig> & Pick<WorkspaceConfig, "database">,
  dependencies?: Parameters<typeof createWorkspaceApplication>[3],
) {
  const config = { ...loadConfig({}), ...settings };
  if (config.database.provider !== "sqlite") throw new Error("Expected a SQLite fixture");
  const database = openWorkspaceDatabase(config.database.filename);
  const cleanup = new AsyncDisposableStack();
  cleanup.defer(() => database.close());
  try {
    const repositories = createSqliteRepositories(database);
    const collaboration = await openCollaborationDatabase(config.database, createSqliteUnitCreationFactsReader(database.connection));
    cleanup.defer(() => collaboration.close());
    const application = createWorkspaceApplication(config, repositories, collaboration, dependencies);
    cleanup.defer(() => application.close());
    await application.initialize();
    return { ...application, repositories, database, close: () => cleanup.disposeAsync() };
  } catch (error) {
    await cleanup.disposeAsync();
    throw error;
  }
}
