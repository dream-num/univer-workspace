import { openSqliteCollaborationDatabase } from "../../../server/src/integrations/univer/collaboration-database/sqlite/open.js";
import { createCollaborationRuntime } from "../../../server/src/integrations/univer/unit-store.js";

export async function createSqliteTestRuntime(filename: string) {
  const database = await openSqliteCollaborationDatabase(filename, {
    async read() {
      throw new Error("This fixture expects a fresh or current collaboration database");
    },
  });
  const cleanup = new AsyncDisposableStack();
  cleanup.defer(() => database.close());
  try {
    const runtime = createCollaborationRuntime(database);
    cleanup.defer(() => runtime.dispose());
    return { ...runtime, dispose: () => cleanup.disposeAsync() };
  } catch (error) {
    await cleanup.disposeAsync();
    throw error;
  }
}
