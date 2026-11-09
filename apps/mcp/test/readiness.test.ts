import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway/server.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { PROTOCOL_VERSION } from "../src/shared/executor-protocol.js";
import { testStagingDirectory } from "./staging-directory.js";

const exchangeGrant = "urn:ietf:params:oauth:grant-type:token-exchange";
const secret = "readiness-private-token-".repeat(2);
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function start({ oauth = false, executor = false, failure = "" } = {}) {
  const workspacePaths: string[] = [];
  const state = {
    healthStatus: 200,
    healthHang: false,
    metadataStatus: 200,
    metadataHang: false,
    metadata: JSON.stringify({ grant_types_supported: [exchangeGrant] }),
    executorStatus: failure === "unavailable" ? 503 : 200,
    executorVersion: failure === "incompatible" ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION,
    executorHang: failure === "pending",
    executorBody: failure === "malformed" ? `private upstream ${secret}` : undefined,
    executorCalls: 0,
    workspacePaths,
  };
  const workspaceUrl = await listen(
    createServer((request, response) => {
      const path = request.url ?? "/";
      state.workspacePaths.push(path);
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers.cookie).toBeUndefined();
      if (path === "/healthz") {
        if (!state.healthHang)
          response.writeHead(state.healthStatus).end(`private upstream ${secret} ${workspaceUrl}`);
      } else if (path === "/.well-known/oauth-authorization-server") {
        if (!state.metadataHang) response.writeHead(state.metadataStatus).end(state.metadata);
      } else response.writeHead(404).end();
    }),
  );
  const executorUrl = executor
    ? await listen(
        createServer((request, response) => {
          expect(request.url).toBe("/rpc/v1/capabilities");
          expect(request.headers.authorization).toBe(`Bearer ${secret}`);
          state.executorCalls++;
          if (!state.executorHang)
            response.writeHead(state.executorStatus).end(
              state.executorBody ??
                JSON.stringify({
                  v: state.executorVersion,
                  operations: [],
                }),
            );
        }),
      )
    : undefined;
  const gateway = createGateway(
    parseGatewayConfig({
      MCP_DEV_SESSION_PASSTHROUGH: "1",
      WORKSPACE_ORIGIN: "https://identity.invalid",
      WORKSPACE_TRANSPORT_URL: workspaceUrl,
      MCP_PUBLIC_URL: "https://gateway.invalid/mcp",
      MCP_STAGING_DIRECTORY: testStagingDirectory(),
      ...(oauth
        ? { MCP_OAUTH_CLIENT_ID: "readiness-client", MCP_OAUTH_CLIENT_SECRET: secret }
        : {}),
      ...(executorUrl ? { MCP_EXECUTOR_URLS: executorUrl, MCP_INTERNAL_TOKEN: secret } : {}),
    }),
    { logger: pino({ level: "silent" }) },
  );
  const url = await listen(gateway.server);
  cleanup.push(() => gateway.close());
  const probe = async () => {
    const response = await fetch(`${url}/readyz`);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body: unknown = await response.json();
    return { status: response.status, body };
  };
  return { state, probe, url };
}

describe("gateway readiness over real HTTP", () => {
  it("passes every applicable check without a bearer, including compatible empty capabilities", async () => {
    const { probe } = await start({ oauth: true, executor: true });
    expect(await probe()).toEqual({
      status: 200,
      body: { status: "ok", checks: { workspace: "ok", token_exchange: "ok", executor: "ok" } },
    });
  });

  it("skips token exchange and executor checks when neither is configured", async () => {
    const { state, probe } = await start();
    expect(await probe()).toEqual({
      status: 200,
      body: { status: "ok", checks: { workspace: "ok" } },
    });
    expect(state.workspacePaths).toEqual(["/healthz"]);
  });

  it.each([false, true])(
    "names Workspace failures without upstream details, OAuth=%s",
    async (oauth) => {
      const { state, probe } = await start({ oauth });
      state.healthStatus = 503;
      expect(await probe()).toEqual({
        status: 503,
        body: {
          status: "failed",
          checks: { workspace: "failed", ...(oauth ? { token_exchange: "ok" } : {}) },
        },
      });
    },
  );

  it("times out concurrent Workspace checks within the probe budget", async () => {
    const { state, probe } = await start({ oauth: true });
    state.healthHang = true;
    state.metadataHang = true;
    expect(await probe()).toEqual({
      status: 503,
      body: { status: "failed", checks: { workspace: "failed", token_exchange: "failed" } },
    });
  }, 3_500);

  it.each([
    "{}",
    JSON.stringify({ grant_types_supported: ["authorization_code"] }),
    JSON.stringify({ grant_types_supported: exchangeGrant }),
    `private upstream error https://workspace.private ${secret}`,
  ])(
    "rejects unsupported or malformed OAuth metadata without exposing it (%s)",
    async (metadata) => {
      const { state, probe } = await start({ oauth: true });
      state.metadata = metadata;
      expect(await probe()).toEqual({
        status: 503,
        body: { status: "failed", checks: { workspace: "ok", token_exchange: "failed" } },
      });
    },
  );

  it("fails token exchange when the metadata endpoint fails", async () => {
    const { state, probe } = await start({ oauth: true });
    state.metadataStatus = 503;
    expect(await probe()).toEqual({
      status: 503,
      body: { status: "failed", checks: { workspace: "ok", token_exchange: "failed" } },
    });
  });

  it.each(["unavailable", "incompatible", "malformed", "pending"])(
    "names an executor with %s capabilities and refreshes for recovery",
    async (failure) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { state, probe } = await start({ executor: true, failure });
      expect(await probe()).toEqual({
        status: 503,
        body: { status: "failed", checks: { workspace: "ok", executor: "failed" } },
      });
      expect(state.executorCalls).toBeGreaterThan(0);
      if (failure === "pending") return;
      const calls = state.executorCalls;
      state.executorStatus = 200;
      state.executorVersion = PROTOCOL_VERSION;
      state.executorBody = undefined;
      expect(await probe()).toEqual({
        status: 200,
        body: { status: "ok", checks: { workspace: "ok", executor: "ok" } },
      });
      expect(state.executorCalls).toBeGreaterThan(calls);
    },
    7_500,
  );

  it("keeps healthz public and independent of all upstream checks", async () => {
    const { state, url } = await start({ oauth: true });
    state.healthHang = true;
    state.metadataHang = true;
    const response = await fetch(`${url}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(state.workspacePaths).toEqual([]);
  });
});
