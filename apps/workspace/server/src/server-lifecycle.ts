import type { Server } from "node:http";
import type { WorkspaceApplication } from "./app.js";
import type { OperationRecovery } from "./jobs/operation-recovery.js";

export async function shutdownServer(
  server: Server,
  operationRecovery: OperationRecovery,
  application: WorkspaceApplication
): Promise<void> {
  const cleanup = new AsyncDisposableStack();
  cleanup.defer(() => application.close());
  cleanup.defer(() => closeHttpServer(server));
  cleanup.defer(() => application.closeRealtime());
  cleanup.defer(() => operationRecovery.dispose());
  await cleanup.disposeAsync();
}

function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
