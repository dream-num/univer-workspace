import { once } from "node:events";
import { createServer, type Server } from "node:http";

export async function listenGateway<T extends { server: Server; close(): Promise<void> }>(
  create: (url: string) => T,
): Promise<{ gateway: T; url: string }> {
  for (let attempt = 1; ; attempt++) {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP server");
    const port = address.port;
    await new Promise<void>((resolve, reject) => {
      reservation.close((error) => error ? reject(error) : resolve());
    });
    const url = `http://127.0.0.1:${String(port)}/mcp`;
    const gateway = create(url);
    try {
      gateway.server.listen(port, "127.0.0.1");
      await once(gateway.server, "listening");
      return { gateway, url };
    } catch (error) {
      await gateway.close();
      // Another listener can claim the reserved port before the gateway binds it.
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE" || attempt === 5) {
        throw error;
      }
    }
  }
}
