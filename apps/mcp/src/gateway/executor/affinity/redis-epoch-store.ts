import { createHash } from "node:crypto";
import type { EpochStore, RedisEndpoint, RedisTopology } from "./epoch-store.js";

// Shared epoch store for multi-replica gateways, backed by Redis.
// Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md sections 3.3 and 3.4.

export const DEFAULT_REDIS_KEY_PREFIX = "mcp:executor-epoch:";
export const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_REDIS_COMMAND_TIMEOUT_MS = 2_000;

/** The two Redis commands the epoch store needs. */
export interface RedisEpochCommands {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
}

export interface RedisEpochClient extends RedisEpochCommands {
  ping(): Promise<string>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

export interface RedisEpochStoreOptions {
  /** `redis://` or `rediss://`. Never logged: it can carry a password. Required without `topology`. */
  readonly url?: string;
  /** Sentinel or cluster routing. Mutually exclusive with `url`. */
  readonly topology?: RedisTopology;
  /** Sentinel/cluster credential. Never logged. */
  readonly username?: string;
  readonly password?: string;
  /** Sentinel only; cluster mode always uses database 0. */
  readonly db?: number;
  /** Sentinel/cluster TLS. Single-node mode derives it from the `rediss://` scheme. */
  readonly tls?: boolean;
  readonly keyPrefix?: string;
  readonly connectTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  /** Test seam: replace the ioredis client factory. */
  readonly openClient?: () => Promise<RedisEpochClient>;
}

export interface RedisEpochStoreHandle {
  readonly store: EpochStore;
  /** Resolves after the first successful connect and `PING`; rejects when Redis is unreachable. */
  readonly ready: Promise<void>;
  close(): Promise<void>;
}

/**
 * A failure of the shared epoch store itself. The gateway maps it to "the call was not sent"
 * instead of "the write may have completed", because the epoch read precedes every send.
 */
export class RedisEpochStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RedisEpochStoreError";
  }
}

/**
 * Hashed so a Redis key never carries a user ID, a Unit ID or a NUL separator. Bounded to the
 * 64 hex characters of sha256 regardless of how long the routing key is.
 */
export function redisEpochKey(prefix: string, key: string): string {
  return `${prefix}${createHash("sha256").update(key).digest("hex")}`;
}

export class RedisEpochStore implements EpochStore {
  readonly #prefix: string;
  readonly #commands: RedisEpochCommands;

  constructor(commands: RedisEpochCommands, prefix: string = DEFAULT_REDIS_KEY_PREFIX) {
    if (prefix === "") throw new Error("A Redis epoch key prefix must not be empty");
    this.#commands = commands;
    this.#prefix = prefix;
  }

  async get(key: string): Promise<number> {
    const value = await this.#commands.get(redisEpochKey(this.#prefix, key));
    if (value === null) return 0;
    return parseEpoch(value);
  }

  async increment(key: string): Promise<number> {
    return parseEpoch(await this.#commands.incr(redisEpochKey(this.#prefix, key)));
  }
}

/**
 * Creates the store without doing any I/O; the first read, increment or `ready` connects and
 * validates with `PING`. A failure is not cached, so a transient outage is retried on the next
 * call instead of leaving the gateway with a store that can never recover.
 */
export function createRedisEpochStore(options: RedisEpochStoreOptions): RedisEpochStoreHandle {
  assertRedisConnection(options);
  const prefix = options.keyPrefix ?? DEFAULT_REDIS_KEY_PREFIX;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_REDIS_CONNECT_TIMEOUT_MS;
  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_REDIS_COMMAND_TIMEOUT_MS;
  let opening: Promise<RedisEpochClient> | undefined;
  let client: RedisEpochClient | undefined;
  let closed = false;

  const open = async (): Promise<RedisEpochClient> => {
    if (closed) throw new RedisEpochStoreError("The Redis epoch store is closed.");
    let loaded: RedisEpochClient;
    try {
      loaded = await (
        options.openClient ?? defaultOpenClient(options, connectTimeoutMs, commandTimeoutMs)
      )();
    } catch (error) {
      throw new RedisEpochStoreError("The Redis epoch store is unavailable.", { cause: error });
    }
    client = loaded;
    try {
      await within(loaded.ping(), connectTimeoutMs, () => loaded.disconnect());
    } catch (error) {
      client = undefined;
      loaded.disconnect();
      throw new RedisEpochStoreError("The Redis epoch store is unavailable.", { cause: error });
    }
    if (closed) {
      client = undefined;
      loaded.disconnect();
      throw new RedisEpochStoreError("The Redis epoch store is closed.");
    }
    return loaded;
  };

  const clientFor = (): Promise<RedisEpochClient> => {
    opening ??= open().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
    return opening;
  };

  const commands: RedisEpochCommands = {
    get: async (key) => await (await clientFor()).get(key),
    incr: async (key) => await (await clientFor()).incr(key),
  };
  const store = new RedisEpochStore(commands, prefix);
  const ready = clientFor().then(() => undefined);

  return {
    store,
    ready,
    async close() {
      if (closed) return;
      closed = true;
      const pending = opening;
      opening = undefined;
      if (pending !== undefined) {
        try {
          await pending;
        } catch {
          // A failed open already disconnected its client.
        }
      }
      const current = client;
      client = undefined;
      if (current === undefined) return;
      try {
        await current.quit();
      } catch {
        current.disconnect();
      }
    },
  };
}

/**
 * Fails a misconfigured store before any I/O instead of connecting to the wrong server or
 * silently ignoring an option. `parseGatewayConfig` rejects these combinations for the gateway;
 * this guard covers direct callers.
 */
function assertRedisConnection(options: RedisEpochStoreOptions): void {
  const topology = options.topology;
  if (topology === undefined) {
    if (options.url === undefined)
      throw new Error("A single-node Redis epoch store requires MCP_GATEWAY_REDIS_URL");
  } else {
    if (options.url !== undefined)
      throw new Error("A Redis epoch store takes a URL or a topology, never both");
    if (topology.mode === "sentinel") {
      if (topology.sentinels.length === 0)
        throw new Error("A sentinel Redis epoch store requires at least one sentinel");
      if (topology.masterName === "")
        throw new Error("A sentinel Redis epoch store requires a master name");
    } else if (topology.nodes.length === 0) {
      throw new Error("A cluster Redis epoch store requires at least one node");
    }
  }
  if (options.db === undefined) return;
  if (!Number.isSafeInteger(options.db) || options.db < 0)
    throw new Error("A Redis database index must be a non-negative integer");
  if (topology?.mode === "cluster" && options.db !== 0)
    throw new Error("A cluster Redis epoch store uses database 0 only");
}

/** The subset of the ioredis surface this module builds, kept minimal so tests can record it. */
export interface RedisConstructorLike {
  new (...args: unknown[]): RedisEpochClient;
  readonly Cluster: new (nodes: unknown[], options: unknown) => RedisEpochClient;
}

/**
 * Builds the one client the three topologies agree on. Single-node mode keeps passing the URL
 * unchanged, so `rediss://` and its `?family=` query keep ioredis' own parsing.
 */
export function createRedisClient(
  Redis: RedisConstructorLike,
  options: RedisEpochStoreOptions,
  timeouts: { readonly connectTimeoutMs: number; readonly commandTimeoutMs: number },
): RedisEpochClient {
  const common = {
    connectTimeout: timeouts.connectTimeoutMs,
    commandTimeout: timeouts.commandTimeoutMs,
    // One retry per command: a lost epoch read must fail the call, not stall the gateway.
    maxRetriesPerRequest: 1,
  };
  const topology = options.topology;
  // The same empty object ioredis derives from `rediss://`: Node's defaults plus its CA store.
  const tls = options.tls === true ? {} : undefined;
  const credentials = {
    ...(options.username === undefined ? {} : { username: options.username }),
    ...(options.password === undefined ? {} : { password: options.password }),
  };
  const database = options.db === undefined || options.db === 0 ? {} : { db: options.db };
  if (topology?.mode === "cluster") {
    return new Redis.Cluster(
      topology.nodes.map(({ host, port }) => ({ host, port })),
      {
        // Every command must reach a master; a replica may not have the epoch just written.
        scaleReads: "master",
        redisOptions: {
          ...common,
          ...credentials,
          ...database,
          ...(tls === undefined ? {} : { tls }),
        },
      },
    );
  }
  if (topology?.mode === "sentinel") {
    const sentinelPassword = topology.sentinelPassword ?? options.password;
    return new Redis({
      ...common,
      sentinels: topology.sentinels.map(({ host, port }) => ({ host, port })),
      name: topology.masterName,
      ...credentials,
      ...(sentinelPassword === undefined ? {} : { sentinelPassword }),
      ...(options.username === undefined ? {} : { sentinelUsername: options.username }),
      ...database,
      // One flag covers both hops: deployments that turn on TLS at all use it everywhere.
      ...(tls === undefined ? {} : { tls, sentinelTLS: tls, enableTLSForSentinelMode: true }),
    });
  }
  if (options.url === undefined)
    throw new Error("A single-node Redis epoch store requires MCP_GATEWAY_REDIS_URL");
  return new Redis(options.url, common);
}

function defaultOpenClient(
  options: RedisEpochStoreOptions,
  connectTimeoutMs: number,
  commandTimeoutMs: number,
): () => Promise<RedisEpochClient> {
  return async () => {
    // The named export is the class; the default export is the CommonJS namespace under NodeNext.
    const { Redis } = await import("ioredis");
    return createRedisClient(Redis as unknown as RedisConstructorLike, options, {
      connectTimeoutMs,
      commandTimeoutMs,
    });
  };
}

function parseEpoch(value: string | number): number {
  const epoch = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(epoch) || epoch < 0)
    throw new RedisEpochStoreError("The Redis epoch for this key is not a non-negative integer");
  return epoch;
}

async function within<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(`Redis did not answer within ${ms} ms`));
        }, ms);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
