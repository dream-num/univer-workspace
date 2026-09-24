import { createServer } from "node:http";
import { beginStartupStage, startupStage, startupStageAsync } from "./startup-logging.js";

// Dynamic imports expose OOMs during SDK/module evaluation before main runs.
const { prepareCollaborationDatabase } = await startupStageAsync(
  "modules.collaboration-migrations",
  () => import("./integrations/univer/migrations/prepare-collaboration-database.js"),
);
const { createWorkspaceApplication } = await startupStageAsync(
  "modules.application",
  () => import("./app.js"),
);
const [
  { loadConfig },
  { prepareCurrentDatabase },
  { startOperationRecovery },
  { startBlobMaintenance },
  { shutdownServer },
  { logger },
] = await startupStageAsync("modules.startup", () =>
  Promise.all([
    import("./config.js"),
    import("./db/migrations/prepare-current-database.js"),
    import("./jobs/operation-recovery.js"),
    import("./jobs/blob-maintenance.js"),
    import("./server-lifecycle.js"),
    import("./middleware/logging.js"),
  ]),
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
