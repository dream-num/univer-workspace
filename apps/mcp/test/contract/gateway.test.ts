import { createServer } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateway } from "../gateway.js";
import { listenGateway } from "../listen-gateway.js";
import { parseGatewayConfig } from "../../src/shared/config.js";
import { testStagingDirectory } from "../staging-directory.js";
import { closeServer, executorToken, listen, logger } from "./harness.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});
async function start(versions: number[]) {
  const replicas = versions.map((v) => ({ v, calls: 0, writes: 0, status: 200 }));
  const urls: string[] = [];
  for (const replica of replicas) {
    const server = createServer((req, res) => {
      if (req.url === "/rpc/v1/capabilities") {
        replica.calls++;
        res
          .writeHead(replica.status, { "content-type": "application/json" })
          .end(
            JSON.stringify({
              v: replica.v,
              operations: ["content.execute", "content.inspect", "not-in-catalog"],
            }),
          );
      } else {
        req.resume();
        req.on("end", () => {
          replica.writes++;
          res.destroy();
        });
      }
    });
    urls.push(await listen(server));
    cleanup.push(() => closeServer(server));
  }
  const { gateway, url } = await listenGateway((url) =>
    createGateway(
      parseGatewayConfig({
        WORKSPACE_ORIGIN: "https://workspace.test",
        MCP_PUBLIC_URL: url,
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        MCP_STAGING_DIRECTORY: testStagingDirectory(),
        MCP_EXECUTOR_URLS: urls.join(","),
        MCP_EXECUTOR_TOKEN: executorToken,
      }),
      {
        logger,
        fetcher: async (url) =>
          String(url).endsWith("/healthz")
            ? new Response("ok")
            : Response.json({
                authenticated: true,
                user: { id: "contract-user", displayName: "Contract" },
              }),
      },
    ),
  );
  const base = new URL(url).origin;
  cleanup.push(async () => {
    await gateway.close();
    await closeServer(gateway.server);
  });
  const client = new Client({ name: "backend-contract", version: "1" });
  cleanup.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: "Bearer contract-session" } },
    }),
  );
  const ready = async () => {
    const response = await fetch(`${base}/readyz`);
    return { status: response.status, body: await response.json() };
  };
  const names = async () => (await client.listTools()).tools.map((tool) => tool.name);
  return { replicas, client, ready, names };
}

describe.skipIf(!!process.env.MCP_CONTRACT_URL)(
  "gateway protocol §15 (deployed backend mode cannot control gateway replicas)",
  () => {
    it("§3.3, §12 excludes incompatible replicas from routing while a compatible executor keeps readiness", async () => {
      const f = await start([1, 2]);
      expect(await f.ready()).toMatchObject({ status: 200, body: { checks: { executor: "ok" } } });
      expect(await f.names()).toContain("execute");
      await f.client.callTool({
        name: "execute",
        arguments: { worktree: "wt", unit: "unit", code: "increment" },
      });
      expect(f.replicas.map((r) => r.writes)).toEqual([1, 0]);
    });

    it("§3.3, §12 is unready when the only executor has been incompatible since startup", async () => {
      const f = await start([2]);
      expect(await f.ready()).toMatchObject({
        status: 503,
        body: { checks: { executor: "failed" } },
      });
      expect(await f.names()).not.toContain("execute");
      expect(await f.names()).not.toContain("inspect");
    });

    it("§3.3, §12 keeps readiness after silence and version changes but hides incompatible tools", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const f = await start([1]);
      expect((await f.ready()).status).toBe(200);
      expect(await f.names()).toContain("execute");
      f.replicas[0]!.status = 503;
      await vi.advanceTimersByTimeAsync(60_000);
      await expect.poll(() => f.replicas[0]!.calls).toBe(2);
      expect((await f.ready()).status).toBe(200);
      expect(await f.names()).toContain("execute");
      f.replicas[0]!.status = 200;
      f.replicas[0]!.v = 2;
      await vi.advanceTimersByTimeAsync(60_000);
      await expect.poll(f.names).not.toContain("execute");
      expect(await f.names()).not.toContain("inspect");
      expect(await f.ready()).toMatchObject({ status: 200, body: { checks: { executor: "ok" } } });
    });

    it("§8.2, §8.3 never retries a write accepted before the executor disconnects", async () => {
      const f = await start([1, 1]);
      await expect.poll(f.names).toContain("execute");
      const response = await f.client.callTool({
        name: "execute",
        arguments: { worktree: "wt", unit: "unit", code: "increment" },
      });
      expect(response).toMatchObject({
        isError: true,
        structuredContent: { code: "workspace-result-unknown", detail: { retryable: false } },
      });
      expect(f.replicas.reduce((sum, r) => sum + r.writes, 0)).toBe(1);
    });
  },
);
