import {
  MemoryEpochStore,
  type EpochStore,
  type EpochStoreSettings,
} from "./affinity/epoch-store.js";
import {
  createRedisEpochStore,
  type RedisEpochStoreOptions,
} from "./affinity/redis-epoch-store.js";

// The gateway owns the epoch store's lifecycle: it is created with the listener, shared by every
// executor call, and closed with the server.
// Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md sections 3.3 and 3.4.

export interface EpochStoreHandle {
  readonly store: EpochStore;
  /** Resolves after a configured Redis store answers `PING`. */
  readonly ready: Promise<void>;
  close(): Promise<void>;
}

/**
 * Translates deployment settings into the Redis client options. Pure: opening the connection
 * belongs to the store, so configuration mistakes surface before any I/O.
 */
export function redisEpochStoreOptions(settings: EpochStoreSettings): RedisEpochStoreOptions {
  const topology = settings.redisTopology;
  if (topology === undefined && settings.redisUrl === undefined)
    throw new Error(
      "A Redis epoch store requires MCP_GATEWAY_REDIS_URL or MCP_GATEWAY_REDIS_NODES",
    );
  return {
    ...(settings.redisUrl === undefined ? {} : { url: settings.redisUrl }),
    ...(topology === undefined ? {} : { topology }),
    ...(settings.redisUsername === undefined ? {} : { username: settings.redisUsername }),
    ...(settings.redisPassword === undefined ? {} : { password: settings.redisPassword }),
    ...(settings.redisDb === undefined ? {} : { db: settings.redisDb }),
    ...(settings.redisTls === undefined ? {} : { tls: settings.redisTls }),
    ...(settings.keyPrefix === undefined ? {} : { keyPrefix: settings.keyPrefix }),
  };
}

export function createEpochStore(
  settings: EpochStoreSettings = { store: "memory" },
): EpochStoreHandle {
  if (settings.store === "memory")
    return { store: new MemoryEpochStore(), ready: Promise.resolve(), close: async () => {} };
  return createRedisEpochStore(redisEpochStoreOptions(settings));
}
