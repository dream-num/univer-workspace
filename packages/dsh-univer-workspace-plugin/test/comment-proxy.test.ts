import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, expect, it, vi } from "vitest";
import { createHttpHandler } from "../src/collab-proxy/plugin.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

it("forwards comment reads with the server session and refuses every body write before forwarding", async () => {
  const received = vi.fn();
  const upstream = await listen(
    createServer((req, res) => {
      received(req.url, req.headers.cookie);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ comments: { thread: { replies: [] } } }));
    }),
  );
  const ctx = {
    get: () => ({ currentClient: () => ({ origin: upstream, sessionToken: "test-session" }) }),
  } as unknown as Context;
  const handler = createHttpHandler(ctx);
  const proxy = await listen(
    createServer((req, res) => {
      void handler(req, res);
    }),
  );
  const base = `${proxy}/univer-workspace/collab/universer-api/comment/unit/unit-1`;
  const read = await fetch(`${base}/list`, {
    method: "POST",
    headers: { cookie: "browser=untrusted" },
    body: JSON.stringify({ threadId: ["thread"] }),
  });
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({ comments: { thread: { replies: [] } } });
  expect(received).toHaveBeenCalledOnce();
  expect(received.mock.calls[0]?.[0]).toBe("/universer-api/comment/unit/unit-1/list");
  expect(received.mock.calls[0]?.[1]).toContain("test-session");
  expect(received.mock.calls[0]?.[1]).not.toContain("browser");
  for (const action of ["add", "reply", "edit", "solved", "delete"]) {
    const response = await fetch(`${base}/${action}`, { method: "POST", body: "{}" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "comments_read_only" });
  }
  expect((await fetch(`${base}/unexpected`, { method: "POST" })).status).toBe(404);
  expect(received).toHaveBeenCalledOnce();
});
