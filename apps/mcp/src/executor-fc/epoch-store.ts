/**
 * The gateway's only shared state under FC HeaderField affinity: a per-key epoch that is
 * atomically incremented when the platform reports an expired Session.
 * Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md sections 3.3 and 3.4.
 */
export interface EpochStore {
  /** Current epoch for the key; 0 before the first expiry. */
  get(key: string): Promise<number>;
  /** Atomically increments the key's epoch and returns the new value. */
  increment(key: string): Promise<number>;
}

/** One Redis server address. An IPv6 host appears without brackets, as `node:net` reports it. */
export interface RedisEndpoint {
  readonly host: string;
  readonly port: number;
}

/** Sentinel topology: the client asks the sentinels which node is the current master. */
export interface RedisSentinelTopology {
  readonly mode: "sentinel";
  readonly sentinels: readonly RedisEndpoint[];
  readonly masterName: string;
  /** Credential for the sentinels; defaults to the data-node password. Never logged. */
  readonly sentinelPassword?: string;
}

/** Cluster topology: the client follows `MOVED`/`ASK` redirections across the seed nodes. */
export interface RedisClusterTopology {
  readonly mode: "cluster";
  readonly nodes: readonly RedisEndpoint[];
}

/** How the epoch store reaches Redis. Absent means a single node reached through `redisUrl`. */
export type RedisTopology = RedisSentinelTopology | RedisClusterTopology;

/**
 * Deployment choice for the epoch store. `memory` is correct for one gateway replica or local
 * development; `redis` is required once several replicas route the same keys.
 */
export interface EpochStoreSettings {
  readonly store: "memory" | "redis";
  /**
   * `redis://` or `rediss://` for one node. Required when `redisTopology` is absent, and absent
   * when it is present. Never logged: it can carry a password.
   */
  readonly redisUrl?: string;
  /** Sentinel or cluster routing; single-node mode reaches the one node through `redisUrl`. */
  readonly redisTopology?: RedisTopology;
  /** Sentinel/cluster credential; single-node mode takes it from `redisUrl`. Never logged. */
  readonly redisUsername?: string;
  readonly redisPassword?: string;
  /** Sentinel only: logical database index. Cluster mode always uses database 0. */
  readonly redisDb?: number;
  /** Sentinel/cluster TLS; single-node mode derives it from the `rediss://` scheme. */
  readonly redisTls?: boolean;
  /** Redis key prefix; ignored by the memory store. */
  readonly keyPrefix?: string;
}

/** Bounds a single gateway process. In practice this is the number of live routing keys. */
export const DEFAULT_MAX_KEYS = 100_000;

/**
 * Per-process epoch store, correct for one gateway replica or local development. Production
 * with more than one replica must inject a shared atomic implementation through `EpochStore`;
 * see the package README.
 *
 * Epochs have no expiry (design 3.4): a reset would make the gateway reuse an old Session ID.
 * Bounding the map keeps long-lived processes finite. An evicted key starts again at 0, which
 * costs at most one platform 401 and one renewal, never a wrong write.
 */
export class MemoryEpochStore implements EpochStore {
  readonly #epochs = new Map<string, number>();
  readonly #maxKeys: number;

  constructor(options: { maxKeys?: number } = {}) {
    this.#maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    if (!Number.isSafeInteger(this.#maxKeys) || this.#maxKeys < 1)
      throw new Error("maxKeys must be a positive integer");
  }

  get size(): number {
    return this.#epochs.size;
  }

  async get(key: string): Promise<number> {
    const epoch = this.#epochs.get(key);
    if (epoch !== undefined) this.#touch(key, epoch);
    return epoch ?? 0;
  }

  async increment(key: string): Promise<number> {
    // No await between read and write: one turn of the event loop keeps INCR atomic per key.
    const next = (this.#epochs.get(key) ?? 0) + 1;
    this.#epochs.delete(key);
    this.#epochs.set(key, next);
    this.#evict();
    return next;
  }

  #touch(key: string, epoch: number): void {
    this.#epochs.delete(key);
    this.#epochs.set(key, epoch);
  }

  #evict(): void {
    while (this.#epochs.size > this.#maxKeys) {
      const oldest = this.#epochs.keys().next();
      if (oldest.done === true) return;
      this.#epochs.delete(oldest.value);
    }
  }
}
