import {
  MemoryEpochStore,
  createRedisEpochStore,
  type EpochStore,
  type EpochStoreSettings,
} from "../../executor-fc/index.js";

// The gateway owns the epoch store's lifecycle: it is created with the listener, shared by every
// executor call, and closed with the server.
// Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md sections 3.3 and 3.4.

export interface EpochStoreHandle {
  readonly store: EpochStore;
  /** Resolves after a configured Redis store answers `PING`. */
  readonly ready: Promise<void>;
  close(): Promise<void>;
}

export function createEpochStore(
  settings: EpochStoreSettings = { store: "memory" },
): EpochStoreHandle {
  if (settings.store === "memory")
    return { store: new MemoryEpochStore(), ready: Promise.resolve(), close: async () => {} };
  if (settings.redisUrl === undefined)
    throw new Error("A Redis epoch store requires MCP_EXECUTOR_REDIS_URL");
  return createRedisEpochStore({
    url: settings.redisUrl,
    ...(settings.keyPrefix === undefined ? {} : { keyPrefix: settings.keyPrefix }),
  });
}
