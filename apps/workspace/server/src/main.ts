import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { prepareCurrentDatabase } from "./db/migrations/prepare-current-database.js";
import { startOperationRecovery } from "./jobs/operation-recovery.js";
import { startBlobMaintenance } from "./jobs/blob-maintenance.js";
import { shutdownServer } from "./server-lifecycle.js";
import { logger } from "./logging.js";
import { beginStartupStage, startupStage, startupStageAsync } from "./startup-logging.js";

// 只在 SDK 和应用模块加载边界保留动态导入，以记录初始化前的失败。
const { prepareCollaborationDatabase } = await startupStageAsync(
  "modules.collaboration-migrations",
  () => import("./integrations/univer/migrations/prepare-collaboration-database.js"),
);
const { createWorkspaceApplication } = await startupStageAsync(
  "modules.application",
  () => import("./app.js"),
);
const config = startupStage("config.load", () => loadConfig());
startupStage("database.product.prepare", () => prepareCurrentDatabase(config.databaseFilename));
await startupStageAsync("database.collaboration.prepare", () =>
  prepareCollaborationDatabase(config.collaborationDatabaseFilename, config.databaseFilename),
);
const application = startupStage("application.create", () => createWorkspaceApplication(config));
await startupStageAsync("application.initialize", () => application.initialize());
const operationRecovery = startupStage("jobs.operation-recovery.start", () =>
  startOperationRecovery(application.resources),
);
const blobMaintenance = startupStage("jobs.blob-maintenance.start", () =>
  startBlobMaintenance(application.blobs),
);
const background = {
  async dispose() {
    await Promise.all([operationRecovery.dispose(), blobMaintenance.dispose()]);
  },
};
const server = createServer(application.app);
startupStage("server.attach-websocket", () => application.attachWebSocket(server));

const logListen = beginStartupStage("server.listen");
server.listen(config.port, config.host, () => {
  logListen("completed");
  logger.info({ host: config.host, port: config.port }, "Univer Workspace is running");
});

server.on("error", (error) => {
  if (!server.listening) logListen("failed", error);
  void background
    .dispose()
    .then(() => application.close())
    .finally(() => {
      throw error;
    });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownServer(server, background, application).catch((error: unknown) => {
      logger.error({ err: error }, "failed to shut down server");
      process.exitCode = 1;
    });
  });
}
