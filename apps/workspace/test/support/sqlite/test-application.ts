import { createWorkspaceApplication } from "../../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../../server/src/config.js";
import { openWorkspaceDatabase } from "../../../server/src/db/sqlite/initialize.js";
import { createSqliteRepositories } from "../../../server/src/db/sqlite/open.js";

export type SqliteTestApplication = Awaited<ReturnType<typeof createSqliteTestApplication>>;

/** Fixtures share the adapter connection to seed data and inspect transaction state, including :memory:. */
export async function createSqliteTestApplication(
  settings: Partial<WorkspaceConfig> & Pick<WorkspaceConfig, "productDatabase" | "collaborationDatabaseFilename">,
  dependencies?: Parameters<typeof createWorkspaceApplication>[2],
) {
  const config = { ...loadConfig({}), ...settings };
  const database = openWorkspaceDatabase(config.productDatabase.filename);
  try {
    const repositories = createSqliteRepositories(database);
    const application = createWorkspaceApplication(config, repositories, dependencies);
    try {
      await application.initialize();
    } catch (error) {
      await application.close();
      throw error;
    }
    return {
      ...application,
      repositories,
      database,
      async close() {
        try {
          await application.close();
        } finally {
          database.close();
        }
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
