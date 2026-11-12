import { createServer, type Server } from "node:http";
import { expect, it, vi } from "vitest";
import { listenGateway } from "./listen-gateway.js";

it("retries with a new gateway and port when the reserved port is occupied", async () => {
  const servers: Server[] = [];
  const firstClose = vi.fn(async () => {});
  let occupiedPort = 0;
  let createCalls = 0;
  const create = vi.fn((url: string) => {
    createCalls++;
    if (createCalls === 1) {
      occupiedPort = Number(new URL(url).port);
      const occupied = createServer();
      servers.push(occupied);
      occupied.listen(occupiedPort, "127.0.0.1");
    }
    const server = createServer();
    servers.push(server);
    return { server, close: createCalls === 1 ? firstClose : async () => {} };
  });

  try {
    const { gateway, url } = await listenGateway(create);
    expect(create).toHaveBeenCalledTimes(2);
    expect(Number(new URL(url).port)).not.toBe(occupiedPort);
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(gateway.server.listening).toBe(true);
    expect(gateway.server.address()).toMatchObject({ port: Number(new URL(url).port) });
  } finally {
    await Promise.all(servers.filter((server) => server.listening).map((server) =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }),
    ));
  }
});
