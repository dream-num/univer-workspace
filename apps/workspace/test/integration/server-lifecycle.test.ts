import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { expect, it, vi } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { loadConfig } from "../../server/src/config.js";
import { shutdownServer } from "../../server/src/server-lifecycle.js";

it("shuts down while a collaboration WebSocket is connected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "univer-lifecycle-"));
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
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
  databaseFilename: ":memory:",
  collaborationDatabaseFilename: ":memory:",
};

it("releases the configured S3 client even when closing the database fails", async () => {
  const application = createWorkspaceApplication(s3Config);
  const destroy = vi.spyOn(S3Client.prototype, "destroy");
  const error = new Error("database shutdown failed");
  const close = vi.spyOn(application.database, "close").mockImplementationOnce(() => { throw error; });
  try {
    await expect(application.close()).rejects.toBe(error);
    expect(destroy).toHaveBeenCalledOnce();
  } finally {
    close.mockRestore();
    application.database.close();
    destroy.mockRestore();
  }
});

it("leaves disposal of an injected blob store to its owner", async () => {
  const blobStore = { put: vi.fn(), head: vi.fn(), open: vi.fn(), delete: vi.fn(), dispose: vi.fn() };
  const application = createWorkspaceApplication(s3Config, { blobStore });
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
