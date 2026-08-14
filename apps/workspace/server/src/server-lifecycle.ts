import type { Server } from "node:http";
import type { WorkspaceApplication } from "./app.js";
import type { OperationRecovery } from "./jobs/operation-recovery.js";

export function shutdownServer(
  server: Server,
  operationRecovery: OperationRecovery,
  application: WorkspaceApplication
): Promise<void> {
  return shutdown();

  async function shutdown(): Promise<void> {
    await operationRecovery.dispose();
    await application.closeRealtime();
    await closeHttpServer(server);
    await application.close();
  }
}

function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
