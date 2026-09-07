import { createServer } from "node:http";
import { createWorkspaceApplication } from "./app.js";
import { loadConfig } from "./config.js";
import { startOperationRecovery } from "./jobs/operation-recovery.js";
import { startBlobMaintenance } from "./jobs/blob-maintenance.js";
import { shutdownServer } from "./server-lifecycle.js";
import { logger } from "./middleware/logging.js";

const config = loadConfig();
const application = createWorkspaceApplication(config);
await application.initialize();
const operationRecovery = startOperationRecovery(application.resources);
const blobMaintenance = startBlobMaintenance(application.blobs);
const background = {
  async dispose() {
    await Promise.all([
      operationRecovery.dispose(),
      blobMaintenance.dispose(),
    ]);
  },
};
const server = createServer(application.app);
application.attachWebSocket(server);

server.listen(config.port, config.host, () => {
  logger.info(
    { host: config.host, port: config.port },
    "Univer Workspace is running"
  );
});

server.on("error", (error) => {
  void background.dispose().then(() => application.close()).finally(() => {
    throw error;
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownServer(server, background, application).catch(
      (error: unknown) => {
        logger.error({ err: error }, "failed to shut down server");
        process.exitCode = 1;
      }
    );
  });
}
