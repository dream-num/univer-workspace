import { DatabaseSync } from "node:sqlite";
import { createWorkspaceApplication } from "../../../dist/server/app.js";
import { openProductDatabase } from "../../../dist/server/db/index.js";

/** Exercise the shipped adapter while allowing offline V0–V4 fixtures to inspect or seed the file. */
export async function createProductionTestApplication(
  config: Parameters<typeof createWorkspaceApplication>[0],
  dependencies: Parameters<typeof createWorkspaceApplication>[2],
) {
  const product = await openProductDatabase(config.productDatabase);
  const cleanup = new AsyncDisposableStack();
  cleanup.defer(() => product.close());
  try {
    const application = createWorkspaceApplication(config, product.repositories, dependencies);
    cleanup.defer(() => application.close());
    const connection = new DatabaseSync(config.productDatabase.filename);
    cleanup.defer(() => connection.close());
    return { ...application, connection, close: () => cleanup.disposeAsync() };
  } catch (error) {
    await cleanup.disposeAsync();
    throw error;
  }
}
