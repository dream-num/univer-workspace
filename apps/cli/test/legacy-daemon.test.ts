import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stopLegacyWorkspaceDaemonIfPresent } from "../src/runtime/legacy-daemon.js";

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      async (server) =>
        await new Promise<void>((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

describe("legacy Workspace daemon shutdown", () => {
  it("stops a verified legacy Workspace daemon", async () => {
    const fixture = await startLegacyDaemon("univer-workspace-cli");

    await expect(
      stopLegacyWorkspaceDaemonIfPresent({
        currentStatus: {
          diagnostic: { message: "Invalid daemon response" },
          socketPath: fixture.socketPath,
          state: "unreachable",
        },
        socketPath: fixture.socketPath,
      }),
    ).resolves.toBe(true);
    expect(fixture.methods).toEqual(["daemon.health", "daemon.shutdown"]);
  });

  it("does not stop an unrecognized daemon", async () => {
    const fixture = await startLegacyDaemon("another-distribution");

    await expect(
      stopLegacyWorkspaceDaemonIfPresent({
        currentStatus: {
          diagnostic: { message: "Invalid daemon response" },
          socketPath: fixture.socketPath,
          state: "unreachable",
        },
        socketPath: fixture.socketPath,
      }),
    ).resolves.toBe(false);
    expect(fixture.methods).toEqual(["daemon.health"]);
    expect(fixture.server.listening).toBe(true);
  });
});

async function startLegacyDaemon(distributionId: string): Promise<{
  readonly methods: string[];
  readonly server: Server;
  readonly socketPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "univer-legacy-daemon-"));
  directories.push(directory);
  const socketPath = join(directory, "daemon.sock");
  const methods: string[] = [];
  const server = createServer((socket) =>
    handleConnection(socket, server, socketPath, distributionId, methods),
  );
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return { methods, server, socketPath };
}

function handleConnection(
  socket: Socket,
  server: Server,
  socketPath: string,
  distributionId: string,
  methods: string[],
): void {
  let source = "";
  socket.on("data", (chunk) => {
    source += chunk.toString("utf8");
    const newline = source.indexOf("\n");
    if (newline < 0) return;
    const request = JSON.parse(source.slice(0, newline)) as {
      readonly id: string;
      readonly method: string;
    };
    methods.push(request.method);
    const result =
      request.method === "daemon.health"
        ? { distributionId, ok: true, pid: process.pid, socketPath }
        : { stopping: true };
    socket.end(`${JSON.stringify({ id: request.id, jsonrpc: "2.0", result })}\n`, () => {
      if (request.method === "daemon.shutdown") server.close();
    });
  });
}
