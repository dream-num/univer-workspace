// Gateway-side FC affinity surface. `executor.ts` and `main.ts` are deliberately absent: they
// load the headless executor, and gateway code must be able to import this entry without
// pulling headless or native packages into its process (test/import-boundaries.test.ts).
// Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md.
export {
  AFFINITY_HEADER,
  affinityKey,
  assertAffinityHeaderName,
  assertAffinityHeaderValue,
  deriveSessionId,
  isValidAffinityHeaderName,
  isValidAffinityHeaderValue,
  type RuntimeKey,
} from "./affinity.js";
export {
  DEFAULT_MAX_KEYS,
  MemoryEpochStore,
  type EpochStore,
  type EpochStoreSettings,
  type RedisClusterTopology,
  type RedisEndpoint,
  type RedisSentinelTopology,
  type RedisTopology,
} from "./epoch-store.js";
export {
  DEFAULT_REDIS_CONNECT_TIMEOUT_MS,
  DEFAULT_REDIS_KEY_PREFIX,
  RedisEpochStore,
  RedisEpochStoreError,
  createRedisClient,
  createRedisEpochStore,
  redisEpochKey,
  type RedisConstructorLike,
  type RedisEpochClient,
  type RedisEpochCommands,
  type RedisEpochStoreHandle,
  type RedisEpochStoreOptions,
} from "./redis-epoch-store.js";
export {
  createSessionAffinity,
  type SessionAffinity,
  type SessionAffinityOptions,
  type SessionRenewal,
} from "./session.js";
export {
  createAffinityTransport,
  type AffinityRequest,
  type AffinityTransport,
  type AffinityTransportOptions,
} from "./transport.js";
