import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { openProductDatabase, type ProductDatabase } from "./db/index.js";
import { startOperationRecovery, type OperationRecovery } from "./jobs/operation-recovery.js";
import { startBlobMaintenance } from "./jobs/blob-maintenance.js";
import { shutdownServer } from "./server-lifecycle.js";
import { logger } from "./logging/logger.js";
import { beginStartupStage, startupStage, startupStageAsync } from "./logging/startup.js";

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
if (config.emailAuth?.provider === "console") {
  logger.warn(
    "Email sign-in uses the console provider; verification codes are written to the server log. Configure SMTP before using it in production."
  );
}
const database = await startupStageAsync("database.product.prepare", () =>
  openProductDatabase(config.productDatabase),
);
try {
  await serve(database);
} finally {
  await database.close();
}

async function serve(product: ProductDatabase): Promise<void> {
  await startupStageAsync("database.collaboration.prepare", () =>
    prepareCollaborationDatabase(config.collaborationDatabaseFilename, product.unitCreationFacts),
  );
  const application = startupStage("application.create", () =>
    createWorkspaceApplication(config, product.repositories),
  );
  const server = createServer(application.app);
  const jobs: OperationRecovery[] = [];
  try {
    await startupStageAsync("application.initialize", () => application.initialize());
    jobs.push(startOperationRecovery(application.resources));
    jobs.push(startBlobMaintenance(application.blobs, {
      drafts: application.htmlViewDrafts,
      skillDrafts: application.skillDrafts,
    }));
    application.attachWebSocket(server);

    const logListen = beginStartupStage("server.listen");
    const stop = new AbortController();
    const onSignal = () => stop.abort();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
      await new Promise<void>((resolve, reject) => {
        stop.signal.addEventListener("abort", () => {
          if (server.listening) resolve();
        }, { once: true });
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          logListen("completed");
          logger.info({ host: config.host, port: config.port }, "Univer Workspace is running");
          // A signal during hostname resolution must still drain the newly opened listener.
          if (stop.signal.aborted) resolve();
        });
      });
    } catch (error) {
      if (!server.listening) logListen("failed", error);
      throw error;
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  } finally {
    await shutdownServer(server, {
      async dispose() { await Promise.all(jobs.map((job) => job.dispose())); },
    }, application);
  }
}
