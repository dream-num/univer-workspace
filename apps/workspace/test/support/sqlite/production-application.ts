import { openCollaborationDatabase } from "../../../dist/server/integrations/univer/collaboration-database/open-collaboration-database.js";
import { DatabaseSync } from "node:sqlite";
import { createWorkspaceApplication } from "../../../dist/server/app.js";
import { openProductDatabase } from "../../../dist/server/db/index.js";

/** Exercise the shipped adapter while allowing offline V0–V4 fixtures to inspect or seed the file. */
export async function createProductionTestApplication(
  config: Parameters<typeof createWorkspaceApplication>[0],
  dependencies: Parameters<typeof createWorkspaceApplication>[3],
) {
  if (config.database.provider !== "sqlite") throw new Error("Expected a SQLite fixture");
  const product = await openProductDatabase(config.database);
  const cleanup = new AsyncDisposableStack();
  cleanup.defer(() => product.close());
  try {
    const collaboration = await openCollaborationDatabase(config, product.unitCreationFacts);
    cleanup.defer(() => collaboration.close());
    const application = createWorkspaceApplication(config, product.repositories, collaboration, dependencies);
    cleanup.defer(() => application.close());
    await application.initialize();
    const connection = new DatabaseSync(config.database.filename);
    cleanup.defer(() => connection.close());
    return { ...application, connection, close: () => cleanup.disposeAsync() };
  } catch (error) {
    await cleanup.disposeAsync();
    throw error;
  }
}
