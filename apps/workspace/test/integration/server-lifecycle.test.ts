import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { expect, it, vi } from "vitest";
import { createSqliteTestApplication } from "../support/sqlite/test-application.js";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { shutdownServer } from "../../server/src/server-lifecycle.js";

it("shuts down while a collaboration WebSocket is connected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "univer-lifecycle-"));
  const application = await createSqliteTestApplication({
    host: "127.0.0.1",
    port: 3020,
    database: { provider: "sqlite", filename: join(directory, "product.sqlite"), collaborationFilename: join(directory, "collaboration.sqlite") },
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
  const server = createServer(application.app);
  application.attachWebSocket(server);
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP address");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const issued = await application.identity.registerWithPassword({
    username: "lifecycle-user",
    displayName: "Lifecycle User",
    password: "correct horse battery staple",
  });
  const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
  const ticketResponse = await fetch(
    `${origin}/universer-api/user/session-ticket`,
    { headers: { cookie } }
  );
  const { ticket } = (await ticketResponse.json()) as {
    readonly ticket: string;
  };
  const socket = new WebSocket(
    `${origin.replace("http:", "ws:")}/universer-api/comb/connect?sessionTicket=${ticket}`
  );
  await opened(socket);

  const shutdown = shutdownServer(
    server,
    { dispose: async () => {} },
    application
  );
  const completedPromptly = await Promise.race([
    shutdown.then(() => true),
    delay(300).then(() => false),
  ]);

  if (!completedPromptly) socket.close();
  await shutdown;
  rmSync(directory, { recursive: true, force: true });
  expect(completedPromptly).toBe(true);
});

const s3Config = {
  ...loadConfig({ BLOB_STORE: "s3", BLOB_S3_BUCKET: "test-bucket", BLOB_S3_REGION: "us-east-1" }),
  database: { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
} satisfies WorkspaceConfig;

it("releases its configured S3 client and leaves the product database to its caller", async () => {
  const database = await openProductDatabase(s3Config.database);
  const collaboration = await openCollaborationDatabase(s3Config.database, database.unitCreationFacts);
  const application = createWorkspaceApplication(s3Config, database.repositories, collaboration);
  const destroy = vi.spyOn(S3Client.prototype, "destroy");
  try {
    await application.close();
    expect(destroy).toHaveBeenCalledOnce();
    await expect(database.unitCreationFacts.read()).resolves.toEqual({ units: [], worktreeUnits: [] });
  } finally {
    destroy.mockRestore();
    await collaboration.close();
    await database.close();
  }
});

it("leaves disposal of an injected blob store to its owner", async () => {
  const blobStore = { put: vi.fn(), head: vi.fn(), open: vi.fn(), delete: vi.fn(), dispose: vi.fn() };
  const application = await createSqliteTestApplication(s3Config, { blobStore });
  await application.close();
  expect(blobStore.dispose).not.toHaveBeenCalled();
});

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(socket), { once: true });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
