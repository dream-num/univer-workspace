import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { MemoryEpochStore } from "../src/gateway/executor/affinity/epoch-store.js";
import {
  RedisEpochStore,
  createRedisClient,
  createRedisEpochStore,
  redisEpochKey,
  type RedisEpochClient,
} from "../src/gateway/executor/affinity/redis-epoch-store.js";
import { deriveSessionId } from "../src/gateway/executor/affinity/session.js";
import { createAffinityTransport } from "../src/gateway/executor/affinity/transport.js";
import { ExecutorCapabilities } from "../src/gateway/executor/capabilities.js";
import { callExecutor } from "../src/gateway/executor/client.js";
import { createEpochStore, redisEpochStoreOptions } from "../src/gateway/executor/epochs.js";
import { ExecutorRouter } from "../src/gateway/executor/router.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { encodeFrame } from "../src/shared/frame.js";
import { AFFINITY_HEADER, opSpecs, type ExecutorGrant } from "../src/shared/executor-protocol.js";
import { zeroCost } from "../src/shared/usage.js";
import { testStagingDirectory } from "./staging-directory.js";

const token = "executor-token-".repeat(4);
const grant: ExecutorGrant = {
  kind: "session",
  userId: "user-1",
  session: "secret-session",
  expiresAt: Date.now() + 600_000,
};
const key = "user-1\0worktree:wt\0unit";
const meta = { executor: "none" as const, cost: { ...zeroCost } };
const gatewayEnv = {
  WORKSPACE_ORIGIN: "https://workspace.test",
  MCP_PUBLIC_URL: "https://mcp.test/mcp",
  MCP_STAGING_DIRECTORY: testStagingDirectory(),
  MCP_DEV_SESSION_PASSTHROUGH: "1",
  MCP_EXECUTOR_URLS: "http://one.test,http://two.test",
  MCP_EXECUTOR_TOKEN: token,
};

/** An FC-style executor: its capabilities advertised `affinity: "header"`. */
const affineRouter = (urls: string[]) => new ExecutorRouter(urls, new Set(urls));

function connection(transport = createAffinityTransport({ epochs: new MemoryEpochStore() })) {
  return {
    router: affineRouter(["http://one.test"]),
    transport,
    executorToken: token,
    grant,
    requestId: "affinity",
    deadlineAt: Date.now() + 30_000,
  };
}

function okFrame(output: Record<string, unknown>): Response {
  return new Response(new Uint8Array(encodeFrame({ ok: true, output, meta })));
}

describe("executor epoch configuration", () => {
  it("defaults to a memory store and keeps the existing multi-URL routing", () => {
    const config = parseGatewayConfig(gatewayEnv);
    expect(config.executor?.urls).toEqual(["http://one.test", "http://two.test"]);
    expect(config.executor?.epochs).toEqual({
      store: "memory",
      keyPrefix: "mcp:executor-epoch:",
    });
    // The parser consumes the names; they never leak into the readonly config.
    expect(config).not.toHaveProperty("MCP_GATEWAY_EPOCH_STORE");
    expect(config.executor).not.toHaveProperty("MCP_GATEWAY_REDIS_URL");
  });

  it("selects Redis and carries the URL and prefix", () => {
    const config = parseGatewayConfig({
      ...gatewayEnv,
      MCP_GATEWAY_EPOCH_STORE: "redis",
      MCP_GATEWAY_REDIS_URL: "rediss://cache.test:6379/2",
      MCP_GATEWAY_REDIS_KEY_PREFIX: "gw:epoch:",
    });
    expect(config.executor?.epochs).toEqual({
      store: "redis",
      redisUrl: "rediss://cache.test:6379/2",
      keyPrefix: "gw:epoch:",
    });
  });

  it("rejects a mismatched store or URL and a store without an executor", () => {
    expect(() => parseGatewayConfig({ ...gatewayEnv, MCP_GATEWAY_EPOCH_STORE: "redis" })).toThrow(
      /MCP_GATEWAY_REDIS_URL/u,
    );
    expect(() =>
      parseGatewayConfig({ ...gatewayEnv, MCP_GATEWAY_REDIS_URL: "redis://cache.test:6379" }),
    ).toThrow(/MCP_GATEWAY_REDIS_URL/u);
    expect(() =>
      parseGatewayConfig({
        ...gatewayEnv,
        MCP_GATEWAY_EPOCH_STORE: "redis",
        MCP_GATEWAY_REDIS_URL: "http://cache.test",
      }),
    ).toThrow(/redis:\/\/ or rediss:\/\//u);
    const { MCP_EXECUTOR_URLS: _urls, MCP_EXECUTOR_TOKEN: _token, ...withoutExecutor } = gatewayEnv;
    expect(() =>
      parseGatewayConfig({
        ...withoutExecutor,
        MCP_GATEWAY_EPOCH_STORE: "redis",
        MCP_GATEWAY_REDIS_URL: "redis://cache.test:6379",
      }),
    ).toThrow(/MCP_EXECUTOR_URLS/u);
  });

  it("polls executor capabilities every minute by default and can disable polling", () => {
    const defaults = parseGatewayConfig({ ...gatewayEnv });
    expect(defaults.executor?.capabilitiesIntervalMs).toBe(60_000);
    const off = parseGatewayConfig({
      ...gatewayEnv,
      MCP_EXECUTOR_CAPABILITIES_INTERVAL_MS: "0",
    });
    expect(off.executor?.capabilitiesIntervalMs).toBe(0);
    const longer = parseGatewayConfig({
      ...gatewayEnv,
      MCP_EXECUTOR_CAPABILITIES_INTERVAL_MS: "300000",
    });
    expect(longer.executor?.capabilitiesIntervalMs).toBe(300_000);
    for (const invalid of ["-1", "1.5", "abc", "86400001"])
      expect(() =>
        parseGatewayConfig({ ...gatewayEnv, MCP_EXECUTOR_CAPABILITIES_INTERVAL_MS: invalid }),
      ).toThrow(/MCP_EXECUTOR_CAPABILITIES_INTERVAL_MS/u);
  });

  it("builds the configured store and refuses a Redis store without a URL", () => {
    expect(createEpochStore().store).toBeInstanceOf(MemoryEpochStore);
    expect(createEpochStore({ store: "memory" }).store).toBeInstanceOf(MemoryEpochStore);
    expect(() => createEpochStore({ store: "redis" })).toThrow(/MCP_GATEWAY_REDIS_URL/u);
  });

  it("resolves sentinel routing from the sentinel list and the master name", () => {
    const config = parseGatewayConfig({
      ...gatewayEnv,
      MCP_GATEWAY_EPOCH_STORE: "redis",
      MCP_GATEWAY_REDIS_MODE: "sentinel",
      MCP_GATEWAY_REDIS_NODES: "sentinel-a.test:26379, sentinel-b.test:26380",
      MCP_GATEWAY_REDIS_SENTINEL_NAME: "mymaster",
      MCP_GATEWAY_REDIS_USERNAME: "app",
      MCP_GATEWAY_REDIS_PASSWORD: "data-secret",
      MCP_GATEWAY_REDIS_SENTINEL_PASSWORD: "sentinel-secret",
      MCP_GATEWAY_REDIS_DB: "3",
      MCP_GATEWAY_REDIS_TLS: "1",
    });
    expect(config.executor?.epochs).toEqual({
      store: "redis",
      redisTopology: {
        mode: "sentinel",
        sentinels: [
          { host: "sentinel-a.test", port: 26379 },
          { host: "sentinel-b.test", port: 26380 },
        ],
        masterName: "mymaster",
        sentinelPassword: "sentinel-secret",
      },
      redisUsername: "app",
      redisPassword: "data-secret",
      redisDb: 3,
      redisTls: true,
      keyPrefix: "mcp:executor-epoch:",
    });
  });

  it("resolves cluster routing from the seed list and keeps database 0", () => {
    const config = parseGatewayConfig({
      ...gatewayEnv,
      MCP_GATEWAY_EPOCH_STORE: "redis",
      MCP_GATEWAY_REDIS_MODE: "cluster",
      MCP_GATEWAY_REDIS_NODES: "[::1]:6379,cache-b.test:6380",
      MCP_GATEWAY_REDIS_PASSWORD: "data-secret",
      MCP_GATEWAY_REDIS_TLS: "true",
    });
    expect(config.executor?.epochs).toEqual({
      store: "redis",
      redisTopology: {
        mode: "cluster",
        nodes: [
          { host: "::1", port: 6379 },
          { host: "cache-b.test", port: 6380 },
        ],
      },
      redisPassword: "data-secret",
      redisTls: true,
      keyPrefix: "mcp:executor-epoch:",
    });
  });

  it("rejects topology options that contradict the mode", () => {
    const sentinel = {
      ...gatewayEnv,
      MCP_GATEWAY_EPOCH_STORE: "redis",
      MCP_GATEWAY_REDIS_MODE: "sentinel",
      MCP_GATEWAY_REDIS_NODES: "sentinel-a.test:26379",
      MCP_GATEWAY_REDIS_SENTINEL_NAME: "mymaster",
    };
    expect(() => parseGatewayConfig(sentinel)).not.toThrow();
    expect(() =>
      parseGatewayConfig({
        ...sentinel,
        MCP_GATEWAY_REDIS_URL: "redis://cache.test:6379",
      }),
    ).toThrow(/forbids MCP_GATEWAY_REDIS_URL/u);
    const { MCP_GATEWAY_REDIS_SENTINEL_NAME: _name, ...withoutName } = sentinel;
    expect(() => parseGatewayConfig(withoutName)).toThrow(/MCP_GATEWAY_REDIS_SENTINEL_NAME/u);
    expect(() =>
      parseGatewayConfig({ ...sentinel, MCP_GATEWAY_REDIS_NODES: "sentinel-a.test" }),
    ).toThrow(/host:port/u);
    expect(() => parseGatewayConfig({ ...sentinel, MCP_GATEWAY_REDIS_MODE: "cluster" })).toThrow(
      /MCP_GATEWAY_REDIS_SENTINEL_NAME and .* require MCP_GATEWAY_REDIS_MODE=sentinel/u,
    );
    expect(() =>
      parseGatewayConfig({
        ...gatewayEnv,
        MCP_GATEWAY_EPOCH_STORE: "redis",
        MCP_GATEWAY_REDIS_MODE: "cluster",
        MCP_GATEWAY_REDIS_NODES: "cache-a.test:6379",
        MCP_GATEWAY_REDIS_DB: "2",
      }),
    ).toThrow(/MCP_GATEWAY_REDIS_DB must be 0/u);
    expect(() =>
      parseGatewayConfig({
        ...gatewayEnv,
        MCP_GATEWAY_EPOCH_STORE: "redis",
        MCP_GATEWAY_REDIS_URL: "redis://cache.test:6379",
        MCP_GATEWAY_REDIS_NODES: "cache-a.test:6379",
      }),
    ).toThrow(/MCP_GATEWAY_REDIS_MODE=single reads MCP_GATEWAY_REDIS_URL only/u);
    expect(() => parseGatewayConfig({ ...gatewayEnv, MCP_GATEWAY_REDIS_MODE: "cluster" })).toThrow(
      /MCP_GATEWAY_REDIS_MODE requires MCP_GATEWAY_EPOCH_STORE=redis/u,
    );
  });

  it("normalizes sentinel and cluster settings into client options without connecting", () => {
    expect(
      redisEpochStoreOptions({
        store: "redis",
        redisTopology: {
          mode: "sentinel",
          sentinels: [{ host: "sentinel-a.test", port: 26379 }],
          masterName: "mymaster",
        },
        redisPassword: "data-secret",
        redisDb: 3,
        keyPrefix: "gw:",
      }),
    ).toEqual({
      topology: {
        mode: "sentinel",
        sentinels: [{ host: "sentinel-a.test", port: 26379 }],
        masterName: "mymaster",
      },
      password: "data-secret",
      db: 3,
      keyPrefix: "gw:",
    });
    expect(
      redisEpochStoreOptions({
        store: "redis",
        redisTopology: { mode: "cluster", nodes: [{ host: "cache-a.test", port: 6379 }] },
      }),
    ).toEqual({
      topology: { mode: "cluster", nodes: [{ host: "cache-a.test", port: 6379 }] },
    });
    expect(() => redisEpochStoreOptions({ store: "redis" })).toThrow(/MCP_GATEWAY_REDIS_URL/u);
  });
});

describe("Redis epoch store", () => {
  it("stores a hashed key, reads a missing epoch as 0 and increments", async () => {
    const seen: string[] = [];
    let value: string | null = null;
    const commands = {
      get: async (name: string) => {
        seen.push(name);
        return value;
      },
      incr: async (name: string) => {
        seen.push(name);
        value = "7";
        return 7;
      },
    };
    const store = new RedisEpochStore(commands, "gw:");
    expect(await store.get(key)).toBe(0);
    expect(seen[0]).toBe(redisEpochKey("gw:", key));
    expect(seen[0]).toMatch(/^gw:[0-9a-f]{64}$/u);
    expect(seen[0]).not.toContain("user-1");
    expect(await store.increment(key)).toBe(7);
    expect(await store.get(key)).toBe(7);
  });

  it("rejects a stored value that is not an epoch", async () => {
    const store = new RedisEpochStore({
      get: async () => "not-a-number",
      incr: async () => -1,
    });
    await expect(store.get(key)).rejects.toThrow(/non-negative integer/u);
    await expect(store.increment(key)).rejects.toThrow(/non-negative integer/u);
  });

  it("pings on first use, caches the client, and closes once", async () => {
    const client: RedisEpochClient & { closed: boolean } = {
      closed: false,
      get: async () => null,
      incr: async () => 1,
      ping: async () => "PONG",
      quit: async () => {
        client.closed = true;
        return "OK";
      },
      disconnect: () => {
        client.closed = true;
      },
    };
    let opens = 0;
    const handle = createRedisEpochStore({
      url: "redis://cache.test:6379",
      openClient: async () => {
        opens += 1;
        return client;
      },
    });
    await handle.ready;
    expect(opens).toBe(1);
    expect(await handle.store.get(key)).toBe(0);
    expect(await handle.store.increment(key)).toBe(1);
    expect(opens).toBe(1);
    await handle.close();
    expect(client.closed).toBe(true);
    await handle.close();
    await expect(handle.store.get(key)).rejects.toThrow(/closed/u);
  });

  it("reports an unreachable store and retries on the next call", async () => {
    const client: RedisEpochClient = {
      get: async () => null,
      incr: async () => 1,
      ping: async () => "PONG",
      quit: async () => "OK",
      disconnect: () => {},
    };
    let attempts = 0;
    const handle = createRedisEpochStore({
      url: "redis://cache.test:6379",
      openClient: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("connect ECONNREFUSED");
        return client;
      },
    });
    await expect(handle.ready).rejects.toThrow(/unavailable/u);
    expect(await handle.store.get(key)).toBe(0);
    expect(attempts).toBe(2);
    await handle.close();
  });
});

describe("Redis client topology", () => {
  const timeouts = { connectTimeoutMs: 5_000, commandTimeoutMs: 2_000 };
  const commands: RedisEpochClient = {
    get: async () => null,
    incr: async () => 1,
    ping: async () => "PONG",
    quit: async () => "OK",
    disconnect: () => {},
  };

  // ioredis exposes cluster construction as `Redis.Cluster`; recording both call shapes is the
  // only way to assert what the three topology branches actually hand to the driver.
  function fakeRedis() {
    const single: unknown[][] = [];
    const clusters: unknown[][] = [];
    class ClusterClient implements RedisEpochClient {
      readonly get = commands.get;
      readonly incr = commands.incr;
      readonly ping = commands.ping;
      readonly quit = commands.quit;
      readonly disconnect = commands.disconnect;
      constructor(nodes: unknown[], options: unknown) {
        clusters.push([nodes, options]);
      }
    }
    class FakeRedis implements RedisEpochClient {
      static readonly Cluster = ClusterClient;
      readonly get = commands.get;
      readonly incr = commands.incr;
      readonly ping = commands.ping;
      readonly quit = commands.quit;
      readonly disconnect = commands.disconnect;
      constructor(...args: unknown[]) {
        single.push(args);
      }
    }
    return { Redis: FakeRedis, single, clusters };
  }

  it("passes the URL through unchanged in single-node mode", () => {
    const { Redis, single } = fakeRedis();
    createRedisClient(Redis, { url: "rediss://:pw@cache.test:6380/2" }, timeouts);
    expect(single).toEqual([
      [
        "rediss://:pw@cache.test:6380/2",
        { connectTimeout: 5_000, commandTimeout: 2_000, maxRetriesPerRequest: 1 },
      ],
    ]);
  });

  it("builds a sentinel client and reuses the data credential for the sentinels", () => {
    const { Redis, single } = fakeRedis();
    createRedisClient(
      Redis,
      {
        topology: {
          mode: "sentinel",
          sentinels: [
            { host: "sentinel-a.test", port: 26379 },
            { host: "sentinel-b.test", port: 26380 },
          ],
          masterName: "mymaster",
        },
        username: "app",
        password: "data-secret",
        db: 3,
        tls: true,
      },
      timeouts,
    );
    expect(single).toEqual([
      [
        {
          connectTimeout: 5_000,
          commandTimeout: 2_000,
          maxRetriesPerRequest: 1,
          sentinels: [
            { host: "sentinel-a.test", port: 26379 },
            { host: "sentinel-b.test", port: 26380 },
          ],
          name: "mymaster",
          username: "app",
          password: "data-secret",
          sentinelPassword: "data-secret",
          sentinelUsername: "app",
          db: 3,
          tls: {},
          sentinelTLS: {},
          enableTLSForSentinelMode: true,
        },
      ],
    ]);
  });

  it("builds a cluster client across the seeds and reads only from masters", () => {
    const { Redis, clusters } = fakeRedis();
    createRedisClient(
      Redis,
      {
        topology: {
          mode: "cluster",
          nodes: [
            { host: "cache-a.test", port: 6379 },
            { host: "cache-b.test", port: 6380 },
          ],
        },
        password: "data-secret",
        tls: true,
      },
      timeouts,
    );
    expect(clusters).toEqual([
      [
        [
          { host: "cache-a.test", port: 6379 },
          { host: "cache-b.test", port: 6380 },
        ],
        {
          scaleReads: "master",
          redisOptions: {
            connectTimeout: 5_000,
            commandTimeout: 2_000,
            maxRetriesPerRequest: 1,
            password: "data-secret",
            tls: {},
          },
        },
      ],
    ]);
  });

  it("refuses contradictory connection settings before any I/O", () => {
    expect(() => createRedisEpochStore({})).toThrow(/MCP_GATEWAY_REDIS_URL/u);
    expect(() =>
      createRedisEpochStore({
        url: "redis://cache.test:6379",
        topology: { mode: "cluster", nodes: [{ host: "cache.test", port: 6379 }] },
      }),
    ).toThrow(/never both/u);
    expect(() => createRedisEpochStore({ topology: { mode: "cluster", nodes: [] } })).toThrow(
      /at least one node/u,
    );
    expect(() =>
      createRedisEpochStore({
        topology: { mode: "cluster", nodes: [{ host: "cache.test", port: 6379 }] },
        db: 1,
      }),
    ).toThrow(/database 0 only/u);
    expect(() =>
      createRedisEpochStore({ topology: { mode: "sentinel", sentinels: [], masterName: "m" } }),
    ).toThrow(/at least one sentinel/u);
  });
});

describe("gateway affinity header", () => {
  it("calls a resident executor exactly as before: no header and no epoch read", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okFrame({ committed: false, status: "committed" }));
    const epochs = {
      get: vi.fn(async () => 0),
      increment: vi.fn(async () => 1),
    };
    try {
      await callExecutor(
        {
          ...connection(createAffinityTransport({ epochs })),
          router: new ExecutorRouter(["http://one.test"]),
        },
        opSpecs["content.execute"],
        { input: { worktreeId: "wt", unitId: "unit", code: "return 1" } },
      );
      const init = fetcher.mock.calls[0]?.[1] as RequestInit;
      expect(new Headers(init.headers).has(AFFINITY_HEADER)).toBe(false);
      expect(epochs.get).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });

  it("sends the derived Session ID with every call to an affinity executor", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okFrame({ committed: false, status: "committed" }));
    try {
      await callExecutor(connection(), opSpecs["content.execute"], {
        input: { worktreeId: "wt", unitId: "unit", code: "return 1" },
      });
      const init = fetcher.mock.calls[0]?.[1] as RequestInit;
      expect(new Headers(init.headers).get(AFFINITY_HEADER)).toBe(deriveSessionId(key, 0));
    } finally {
      fetcher.mockRestore();
    }
  });

  it("renews the epoch and retries once when the platform rejects the Session", async () => {
    const epochs = new MemoryEpochStore();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Session not found", { status: 401 }))
      .mockResolvedValueOnce(okFrame({ committed: false, status: "committed" }));
    try {
      await expect(
        callExecutor(connection(createAffinityTransport({ epochs })), opSpecs["content.execute"], {
          input: { worktreeId: "wt", unitId: "unit", code: "return 1" },
        }),
      ).resolves.toMatchObject({ output: { status: "committed" } });
      const sent = fetcher.mock.calls.map((call) => new Headers(call[1]?.headers));
      expect(sent.map((headers) => headers.get(AFFINITY_HEADER))).toEqual([
        deriveSessionId(key, 0),
        deriveSessionId(key, 1),
      ]);
      expect(await epochs.get(key)).toBe(1);
    } finally {
      fetcher.mockRestore();
    }
  });

  it("does not renew on the executor's own workspace error 401", async () => {
    const epochs = new MemoryEpochStore();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "workspace-executor-unauthorized", message: "no", detail: null },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      await expect(
        callExecutor(connection(createAffinityTransport({ epochs })), opSpecs["content.execute"], {
          input: { worktreeId: "wt", unitId: "unit", code: "return 1" },
        }),
      ).rejects.toMatchObject({ wire: { code: "workspace-executor-unavailable" } });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await epochs.get(key)).toBe(0);
    } finally {
      fetcher.mockRestore();
    }
  });

  it("keeps the existing failover and sends the same Session ID to every replica", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))
      .mockResolvedValueOnce(okFrame({ committed: false, status: "committed" }));
    const transport = createAffinityTransport({ epochs: new MemoryEpochStore() });
    try {
      await callExecutor(
        {
          ...connection(transport),
          router: affineRouter(["http://one.test", "http://two.test"]),
        },
        opSpecs["content.execute"],
        { input: { worktreeId: "wt", unitId: "unit", code: "return 1" } },
      );
      const sent = fetcher.mock.calls.map((call) => new Headers(call[1]?.headers));
      expect(sent).toHaveLength(2);
      for (const headers of sent)
        expect(headers.get(AFFINITY_HEADER)).toBe(deriveSessionId(key, 0));
    } finally {
      fetcher.mockRestore();
    }
  });

  it("reports an unreachable epoch store as not sent instead of a possibly applied write", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    // What ioredis throws once a connected Redis goes away: a plain error, not a store type.
    const epochs = {
      get: async () => {
        throw new Error("Command timed out");
      },
      increment: async () => 1,
    };
    try {
      await expect(
        callExecutor(connection(createAffinityTransport({ epochs })), opSpecs["content.execute"], {
          input: { worktreeId: "wt", unitId: "unit", code: "return 1" },
        }),
      ).rejects.toMatchObject({
        wire: {
          code: "workspace-executor-unavailable",
          detail: { cause: "epoch-store", retryable: true },
        },
      });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
});

describe("executor capability discovery", () => {
  it("keys discovery so FC session isolation does not open a session per refresh", async () => {
    const seen: (string | null)[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      seen.push(new Headers(init?.headers).get(AFFINITY_HEADER));
      return Response.json({ v: 1, operations: ["content.inspect"] });
    });
    const capabilities = new ExecutorCapabilities(
      { urls: ["http://one.test"], executorToken: "t".repeat(40) },
      pino({ level: "silent" }),
      new MemoryEpochStore(),
    );
    try {
      await capabilities.ready;
      await capabilities.refresh();
      expect(seen).toHaveLength(2);
      for (const value of seen) expect(value).toMatch(/^k[0-9a-f]{32}$/u);
      expect(new Set(seen).size).toBe(1);
      expect(capabilities.operations.has("content.inspect")).toBe(true);
    } finally {
      capabilities.close();
      fetcher.mockRestore();
    }
  });
});

describe("executor capability affinity", () => {
  it("routes with affinity only to executors that advertise it", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        Response.json(
          String(input).startsWith("http://fc.test")
            ? { v: 1, operations: ["content.inspect"], affinity: "header" }
            : { v: 1, operations: ["content.inspect"] },
        ),
      );
    const capabilities = new ExecutorCapabilities(
      { urls: ["http://resident.test", "http://fc.test"], executorToken: "t".repeat(40) },
      pino({ level: "silent" }),
      new MemoryEpochStore(),
    );
    try {
      await capabilities.ready;
      expect(capabilities.router.usesAffinity("http://fc.test")).toBe(true);
      expect(capabilities.router.usesAffinity("http://resident.test")).toBe(false);
      expect(capabilities.operations.has("content.inspect")).toBe(true);
    } finally {
      capabilities.close();
      fetcher.mockRestore();
    }
  });
});

describe("executor capability failure logging", () => {
  it("names the HTTP status and the network code that made discovery fail", async () => {
    let output = "";
    const logger = pino(
      { level: "warn" },
      new Writable({
        write(chunk, _encoding, done) {
          output += chunk.toString();
          done();
        },
      }),
    );
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "workspace-executor-unauthorized", message: "no", detail: null },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
      )
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
        }),
      );
    const capabilities = new ExecutorCapabilities(
      { urls: ["http://one.test"], executorToken: "t".repeat(40) },
      logger,
      new MemoryEpochStore(),
    );
    try {
      await capabilities.ready;
      await capabilities.refresh();
    } finally {
      capabilities.close();
      fetcher.mockRestore();
    }
    expect(output).toContain("HTTP 401");
    expect(output).toContain("ECONNREFUSED");
    expect(output).toContain('"executor":"http://one.test"');
  });
});

describe("executor capability cold start", () => {
  it("retries discovery after a failure instead of waiting for the minute timer", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
        }),
      )
      .mockResolvedValue(Response.json({ v: 1, operations: ["content.inspect"] }));
    const capabilities = new ExecutorCapabilities(
      { urls: ["http://one.test"], executorToken: "t".repeat(40) },
      pino({ level: "silent" }),
      new MemoryEpochStore(),
    );
    try {
      await capabilities.ready;
      expect(capabilities.available).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(capabilities.available).toBe(true);
    } finally {
      capabilities.close();
      fetcher.mockRestore();
      vi.useRealTimers();
    }
  });

  it("backs off up to 15 seconds while the executor stays unreachable", async () => {
    vi.useFakeTimers();
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
      }),
    );
    const capabilities = new ExecutorCapabilities(
      { urls: ["http://one.test"], executorToken: "t".repeat(40) },
      pino({ level: "silent" }),
      new MemoryEpochStore(),
    );
    try {
      await capabilities.ready;
      // 1s, 2s, 4s, 8s, then 15s twice.
      for (const step of [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
        const before = fetcher.mock.calls.length;
        await vi.advanceTimersByTimeAsync(step);
        expect(fetcher.mock.calls.length).toBe(before + 1);
      }
    } finally {
      capabilities.close();
      fetcher.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("executor capability polling", () => {
  it("refreshes every minute by default", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ v: 1, operations: ["content.inspect"] }));
    const capabilities = new ExecutorCapabilities(
      { urls: ["http://one.test"], executorToken: "t".repeat(40) },
      pino({ level: "silent" }),
      new MemoryEpochStore(),
    );
    try {
      await capabilities.ready;
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      capabilities.close();
      fetcher.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not poll when the interval is 0, while startup discovery still runs", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ v: 1, operations: ["content.inspect"] }));
    const capabilities = new ExecutorCapabilities(
      { urls: ["http://one.test"], executorToken: "t".repeat(40), capabilitiesIntervalMs: 0 },
      pino({ level: "silent" }),
      new MemoryEpochStore(),
    );
    try {
      await capabilities.ready;
      expect(capabilities.available).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      capabilities.close();
      fetcher.mockRestore();
      vi.useRealTimers();
    }
  });
});
