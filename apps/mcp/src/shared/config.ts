import { z } from "zod";
import type { EpochStoreSettings, RedisEndpoint } from "../executor-fc/index.js";
import { defaultLimits, type UploadLimits } from "../gateway/staging/model.js";

export const origin = z.url().transform((value, ctx) => {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Expected an HTTP(S) origin without credentials, path, query, or fragment",
    });
    return z.NEVER;
  }
  return url.origin;
});
const publicUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    url.pathname === "/mcp" &&
    !url.search &&
    !url.hash
  );
}, "MCP_PUBLIC_URL must be an HTTP(S) URL ending in /mcp without credentials, query, or fragment");
const quota = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
// The ID list predates Workspace grants; remove it once every deployment sets `workspace` or `*`.
const allowedUserIdList = z
  .string()
  .transform((value) => value.split(",").map((id) => id.trim()))
  .pipe(
    z
      .array(
        z
          .string()
          .min(1)
          .refine(
            (id) => !id.includes("*") && id.toLowerCase() !== "workspace",
            "* and workspace must stand alone, spelled exactly; user IDs contain neither",
          ),
      )
      .min(1),
  )
  .transform((ids): ReadonlySet<string> => new Set(ids));
/** Undefined lets everyone use the executor; "workspace" defers to the grant Workspace reports per User. */
export const executorAllowedUserIds = z.union([
  z.literal("*").transform(() => undefined),
  z.literal("workspace"),
  allowedUserIdList,
]);
export type ExecutorAccessPolicy = z.output<typeof executorAllowedUserIds> | undefined;

export function allowsExecutor(
  policy: ExecutorAccessPolicy,
  user: { readonly id: string; readonly executorAccess: boolean },
): boolean {
  if (policy === undefined) return true;
  return policy === "workspace" ? user.executorAccess : policy.has(user.id);
}
const redisUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "redis:" || url.protocol === "rediss:") && url.hostname !== "";
  } catch {
    return false;
  }
}, "A Redis URL must be a redis:// or rediss:// URL with a host");
// The epoch store is gateway-local shared state; the executor never opens this Redis. Deployments
// that predate the MCP_GATEWAY_* names keep working through the aliases declared below.
const epochStoreName = z.enum(["memory", "redis"]);
const redisModeName = z.enum(["single", "sentinel", "cluster"]);
const redisSecret = z.string().min(1);
const redisDbIndex = z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(0));
const redisTlsFlag = z
  .enum(["1", "0", "true", "false"])
  .transform((value) => value === "1" || value === "true");
const redisKeyPrefix = z.string().min(1).max(128);
// A sentinel list and a cluster seed list share one shape: comma-separated host:port pairs.
const redisEndpoint = z.string().transform((value, ctx): RedisEndpoint => {
  const trimmed = value.trim();
  const match = /^\[(.+)\]:(\d+)$/u.exec(trimmed) ?? /^([^:\s]+):(\d+)$/u.exec(trimmed);
  const host = match?.[1];
  const port = Number(match?.[2]);
  if (match === null || host === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    ctx.addIssue({
      code: "custom",
      message: "Expected host:port, for example cache.internal:6379 or [::1]:26379",
    });
    return z.NEVER;
  }
  return { host, port };
});
const redisEndpoints = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
  )
  .pipe(z.array(redisEndpoint).min(1));
const environment = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(65535)).default(3000),
  WORKSPACE_ORIGIN: origin,
  WORKSPACE_TRANSPORT_URL: origin.optional(),
  MCP_PUBLIC_URL: publicUrl,
  MCP_MAX_CONNECTIONS: quota.default(1024),
  MCP_SYNC_BUDGET_MS: quota.pipe(z.number().max(30_000)).default(30_000),
  MCP_STAGING_DIRECTORY: z.string().min(1),
  MCP_STAGING_USER_MAX_BYTES: quota.default(2 * 1024 * 1024 * 1024),
  MCP_STAGING_USER_MAX_PENDING_UPLOADS: quota.default(20),
  METRICS_TOKEN: z.string().optional(),
  MCP_RESOURCE_CACHE_DIRECTORY: z.string().min(1).optional(),
  MCP_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  MCP_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  MCP_EXECUTOR_URLS: z
    .string()
    .transform((value) => value.split(",").map((url) => url.trim()))
    .pipe(z.array(origin).min(1))
    .optional(),
  MCP_EXECUTOR_TOKEN: z.string().min(32).optional(),
  MCP_EXECUTOR_ALLOWED_USER_IDS: executorAllowedUserIds.optional(),
  // FC HeaderField affinity: the header is always sent; only the epoch store is configurable.
  // The MCP_GATEWAY_* names own gateway-local shared state. The MCP_EXECUTOR_* pairs below are
  // deprecated aliases: one name per setting, and setting both fails startup. Drop them once no
  // deployment sets them.
  MCP_GATEWAY_EPOCH_STORE: epochStoreName.optional(),
  MCP_GATEWAY_REDIS_MODE: redisModeName.optional(),
  MCP_GATEWAY_REDIS_URL: redisUrl.optional(),
  MCP_GATEWAY_REDIS_NODES: redisEndpoints.optional(),
  MCP_GATEWAY_REDIS_SENTINEL_NAME: z.string().min(1).optional(),
  MCP_GATEWAY_REDIS_USERNAME: redisSecret.optional(),
  MCP_GATEWAY_REDIS_PASSWORD: redisSecret.optional(),
  MCP_GATEWAY_REDIS_SENTINEL_PASSWORD: redisSecret.optional(),
  MCP_GATEWAY_REDIS_DB: redisDbIndex.optional(),
  MCP_GATEWAY_REDIS_TLS: redisTlsFlag.optional(),
  MCP_GATEWAY_REDIS_KEY_PREFIX: redisKeyPrefix.optional(),
  MCP_EXECUTOR_EPOCH_STORE: epochStoreName.optional(),
  MCP_EXECUTOR_REDIS_MODE: redisModeName.optional(),
  MCP_EXECUTOR_REDIS_URL: redisUrl.optional(),
  MCP_EXECUTOR_REDIS_NODES: redisEndpoints.optional(),
  MCP_EXECUTOR_REDIS_SENTINEL_NAME: z.string().min(1).optional(),
  MCP_EXECUTOR_REDIS_USERNAME: redisSecret.optional(),
  MCP_EXECUTOR_REDIS_PASSWORD: redisSecret.optional(),
  MCP_EXECUTOR_REDIS_SENTINEL_PASSWORD: redisSecret.optional(),
  MCP_EXECUTOR_REDIS_DB: redisDbIndex.optional(),
  MCP_EXECUTOR_REDIS_TLS: redisTlsFlag.optional(),
  MCP_EXECUTOR_REDIS_KEY_PREFIX: redisKeyPrefix.optional(),
  // 0 disables the periodic capability refresh; startup, cold-start retries and /readyz keep it.
  MCP_EXECUTOR_CAPABILITIES_INTERVAL_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(86_400_000)
    .default(60_000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type GatewayConfig = Readonly<
  Omit<
    z.output<typeof environment>,
    | "MCP_OAUTH_CLIENT_SECRET"
    | "MCP_EXECUTOR_TOKEN"
    | "MCP_EXECUTOR_URLS"
    | "MCP_GATEWAY_EPOCH_STORE"
    | "MCP_GATEWAY_REDIS_MODE"
    | "MCP_GATEWAY_REDIS_URL"
    | "MCP_GATEWAY_REDIS_NODES"
    | "MCP_GATEWAY_REDIS_SENTINEL_NAME"
    | "MCP_GATEWAY_REDIS_USERNAME"
    | "MCP_GATEWAY_REDIS_PASSWORD"
    | "MCP_GATEWAY_REDIS_SENTINEL_PASSWORD"
    | "MCP_GATEWAY_REDIS_DB"
    | "MCP_GATEWAY_REDIS_TLS"
    | "MCP_GATEWAY_REDIS_KEY_PREFIX"
    | "MCP_EXECUTOR_EPOCH_STORE"
    | "MCP_EXECUTOR_REDIS_MODE"
    | "MCP_EXECUTOR_REDIS_URL"
    | "MCP_EXECUTOR_REDIS_NODES"
    | "MCP_EXECUTOR_REDIS_SENTINEL_NAME"
    | "MCP_EXECUTOR_REDIS_USERNAME"
    | "MCP_EXECUTOR_REDIS_PASSWORD"
    | "MCP_EXECUTOR_REDIS_SENTINEL_PASSWORD"
    | "MCP_EXECUTOR_REDIS_DB"
    | "MCP_EXECUTOR_REDIS_TLS"
    | "MCP_EXECUTOR_REDIS_KEY_PREFIX"
    | "MCP_EXECUTOR_CAPABILITIES_INTERVAL_MS"
  > & {
    readonly uploadLimits: UploadLimits;
    readonly executor: {
      readonly urls: readonly string[];
      readonly executorToken: string;
      /** Absent only in tests that build a partial executor config; the gateway uses memory. */
      readonly epochs?: EpochStoreSettings;
      /** Periodic capability refresh; 0 disables it. Absent in partial test configs. */
      readonly capabilitiesIntervalMs?: number;
    } | null;
    readonly WORKSPACE_TRANSPORT_URL: string;
    readonly auth: {
      readonly exchange: { readonly clientId: string; readonly clientSecret: string } | null;
      readonly devSessionPassthrough: boolean;
    };
  }
>;

interface RedisSelection {
  readonly mode: "single" | "sentinel" | "cluster";
  readonly url?: string;
  readonly nodes?: readonly RedisEndpoint[];
  readonly sentinelName?: string;
  readonly username?: string;
  readonly password?: string;
  readonly sentinelPassword?: string;
  readonly db?: number;
  readonly tls?: boolean;
  readonly keyPrefix: string;
}

/**
 * Resolves a renamed variable. The old name keeps working for existing deployments; setting both
 * is an error, because silently preferring one would hide the stale variable.
 */
function renamed<T>(
  primaryName: string,
  primary: T | undefined,
  legacyName: string,
  legacy: T | undefined,
): T | undefined {
  if (primary !== undefined && legacy !== undefined)
    throw new Error(`${legacyName} is deprecated; set ${primaryName} and unset ${legacyName}`);
  return primary ?? legacy;
}

/**
 * Resolves the Redis epoch store from the environment. Contradictory options are refused instead
 * of ignored: a topology variable the gateway never reads would otherwise surface only as a
 * failed tool call against whatever server the remaining variable points at.
 */
function epochStoreSettings(
  store: "memory" | "redis",
  selection: RedisSelection,
  executorConfigured: boolean,
): EpochStoreSettings {
  const topologyVars = [
    selection.nodes === undefined ? undefined : "MCP_GATEWAY_REDIS_NODES",
    selection.sentinelName === undefined ? undefined : "MCP_GATEWAY_REDIS_SENTINEL_NAME",
    selection.username === undefined ? undefined : "MCP_GATEWAY_REDIS_USERNAME",
    selection.password === undefined ? undefined : "MCP_GATEWAY_REDIS_PASSWORD",
    selection.sentinelPassword === undefined ? undefined : "MCP_GATEWAY_REDIS_SENTINEL_PASSWORD",
    selection.db === undefined ? undefined : "MCP_GATEWAY_REDIS_DB",
    selection.tls === undefined ? undefined : "MCP_GATEWAY_REDIS_TLS",
  ].filter((name): name is string => name !== undefined);
  if (store !== "redis") {
    const configured =
      selection.url !== undefined
        ? "MCP_GATEWAY_REDIS_URL"
        : selection.mode !== "single"
          ? "MCP_GATEWAY_REDIS_MODE"
          : topologyVars[0];
    if (configured === undefined) return { store: "memory", keyPrefix: selection.keyPrefix };
    throw new Error(`${configured} requires MCP_GATEWAY_EPOCH_STORE=redis`);
  }
  if (!executorConfigured) throw new Error("The executor epoch store requires MCP_EXECUTOR_URLS");
  const credentials = {
    ...(selection.username === undefined ? {} : { redisUsername: selection.username }),
    ...(selection.password === undefined ? {} : { redisPassword: selection.password }),
    ...(selection.db === undefined ? {} : { redisDb: selection.db }),
    ...(selection.tls === undefined ? {} : { redisTls: selection.tls }),
    keyPrefix: selection.keyPrefix,
  };
  if (selection.mode === "single") {
    if (selection.url === undefined)
      throw new Error(
        "MCP_GATEWAY_EPOCH_STORE=redis requires MCP_GATEWAY_REDIS_URL, or MCP_GATEWAY_REDIS_NODES with sentinel or cluster mode",
      );
    if (topologyVars.length > 0)
      throw new Error(
        `MCP_GATEWAY_REDIS_MODE=single reads MCP_GATEWAY_REDIS_URL only; ${topologyVars[0]} requires sentinel or cluster`,
      );
    return { store: "redis", redisUrl: selection.url, ...credentials };
  }
  if (selection.url !== undefined)
    throw new Error(
      `MCP_GATEWAY_REDIS_MODE=${selection.mode} forbids MCP_GATEWAY_REDIS_URL; list the servers in MCP_GATEWAY_REDIS_NODES`,
    );
  if (selection.nodes === undefined)
    throw new Error(`MCP_GATEWAY_REDIS_MODE=${selection.mode} requires MCP_GATEWAY_REDIS_NODES`);
  if (selection.mode === "sentinel") {
    if (selection.sentinelName === undefined)
      throw new Error("MCP_GATEWAY_REDIS_MODE=sentinel requires MCP_GATEWAY_REDIS_SENTINEL_NAME");
    return {
      store: "redis",
      redisTopology: {
        mode: "sentinel",
        sentinels: selection.nodes,
        masterName: selection.sentinelName,
        ...(selection.sentinelPassword === undefined
          ? {}
          : { sentinelPassword: selection.sentinelPassword }),
      },
      ...credentials,
    };
  }
  if (selection.sentinelName !== undefined || selection.sentinelPassword !== undefined)
    throw new Error(
      "MCP_GATEWAY_REDIS_SENTINEL_NAME and MCP_GATEWAY_REDIS_SENTINEL_PASSWORD require MCP_GATEWAY_REDIS_MODE=sentinel",
    );
  if (selection.db !== undefined && selection.db !== 0)
    throw new Error(
      "MCP_GATEWAY_REDIS_DB must be 0 with MCP_GATEWAY_REDIS_MODE=cluster; cluster nodes serve database 0 only",
    );
  return {
    store: "redis",
    redisTopology: { mode: "cluster", nodes: selection.nodes },
    ...credentials,
  };
}

export function parseGatewayConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  if (env["NODE_ENV"] === "production" && env["MCP_DEV_SESSION_PASSTHROUGH"]) {
    throw new Error("NODE_ENV=production forbids non-empty MCP_DEV_SESSION_PASSTHROUGH");
  }
  const passthrough = env["MCP_DEV_SESSION_PASSTHROUGH"] ?? "";
  if (passthrough !== "" && passthrough !== "1") {
    throw new Error("MCP_DEV_SESSION_PASSTHROUGH must be 1 when set");
  }
  const config = environment.parse(env);
  const {
    MCP_OAUTH_CLIENT_SECRET: clientSecret,
    MCP_EXECUTOR_URLS: urls,
    MCP_EXECUTOR_TOKEN: executorToken,
    // Epoch store: MCP_GATEWAY_* are the names; MCP_EXECUTOR_* stay as deprecated aliases.
    MCP_GATEWAY_EPOCH_STORE: epochStoreNameValue,
    MCP_GATEWAY_REDIS_MODE: redisModeValue,
    MCP_GATEWAY_REDIS_URL: redisUrlValue,
    MCP_GATEWAY_REDIS_NODES: redisNodesValue,
    MCP_GATEWAY_REDIS_SENTINEL_NAME: redisSentinelNameValue,
    MCP_GATEWAY_REDIS_USERNAME: redisUsernameValue,
    MCP_GATEWAY_REDIS_PASSWORD: redisPasswordValue,
    MCP_GATEWAY_REDIS_SENTINEL_PASSWORD: redisSentinelPasswordValue,
    MCP_GATEWAY_REDIS_DB: redisDbValue,
    MCP_GATEWAY_REDIS_TLS: redisTlsValue,
    MCP_GATEWAY_REDIS_KEY_PREFIX: redisKeyPrefixValue,
    MCP_EXECUTOR_EPOCH_STORE: legacyEpochStoreName,
    MCP_EXECUTOR_REDIS_MODE: legacyRedisModeName,
    MCP_EXECUTOR_REDIS_URL: legacyRedisUrl,
    MCP_EXECUTOR_REDIS_NODES: legacyRedisNodes,
    MCP_EXECUTOR_REDIS_SENTINEL_NAME: legacyRedisSentinelName,
    MCP_EXECUTOR_REDIS_USERNAME: legacyRedisUsername,
    MCP_EXECUTOR_REDIS_PASSWORD: legacyRedisPassword,
    MCP_EXECUTOR_REDIS_SENTINEL_PASSWORD: legacyRedisSentinelPassword,
    MCP_EXECUTOR_REDIS_DB: legacyRedisDb,
    MCP_EXECUTOR_REDIS_TLS: legacyRedisTls,
    MCP_EXECUTOR_REDIS_KEY_PREFIX: legacyRedisKeyPrefix,
    MCP_EXECUTOR_CAPABILITIES_INTERVAL_MS: capabilitiesIntervalMs,
    ...configWithoutSecret
  } = config;
  if ((urls === undefined) !== (executorToken === undefined))
    throw new Error("MCP_EXECUTOR_URLS and MCP_EXECUTOR_TOKEN must be set together");
  const epochStoreType =
    renamed(
      "MCP_GATEWAY_EPOCH_STORE",
      epochStoreNameValue,
      "MCP_EXECUTOR_EPOCH_STORE",
      legacyEpochStoreName,
    ) ?? "memory";
  const redisMode =
    renamed(
      "MCP_GATEWAY_REDIS_MODE",
      redisModeValue,
      "MCP_EXECUTOR_REDIS_MODE",
      legacyRedisModeName,
    ) ?? "single";
  const redisUrlSetting = renamed(
    "MCP_GATEWAY_REDIS_URL",
    redisUrlValue,
    "MCP_EXECUTOR_REDIS_URL",
    legacyRedisUrl,
  );
  const redisNodes = renamed(
    "MCP_GATEWAY_REDIS_NODES",
    redisNodesValue,
    "MCP_EXECUTOR_REDIS_NODES",
    legacyRedisNodes,
  );
  const redisSentinelName = renamed(
    "MCP_GATEWAY_REDIS_SENTINEL_NAME",
    redisSentinelNameValue,
    "MCP_EXECUTOR_REDIS_SENTINEL_NAME",
    legacyRedisSentinelName,
  );
  const redisUsername = renamed(
    "MCP_GATEWAY_REDIS_USERNAME",
    redisUsernameValue,
    "MCP_EXECUTOR_REDIS_USERNAME",
    legacyRedisUsername,
  );
  const redisPassword = renamed(
    "MCP_GATEWAY_REDIS_PASSWORD",
    redisPasswordValue,
    "MCP_EXECUTOR_REDIS_PASSWORD",
    legacyRedisPassword,
  );
  const redisSentinelPassword = renamed(
    "MCP_GATEWAY_REDIS_SENTINEL_PASSWORD",
    redisSentinelPasswordValue,
    "MCP_EXECUTOR_REDIS_SENTINEL_PASSWORD",
    legacyRedisSentinelPassword,
  );
  const redisDb = renamed(
    "MCP_GATEWAY_REDIS_DB",
    redisDbValue,
    "MCP_EXECUTOR_REDIS_DB",
    legacyRedisDb,
  );
  const redisTls = renamed(
    "MCP_GATEWAY_REDIS_TLS",
    redisTlsValue,
    "MCP_EXECUTOR_REDIS_TLS",
    legacyRedisTls,
  );
  const redisKeyPrefix =
    renamed(
      "MCP_GATEWAY_REDIS_KEY_PREFIX",
      redisKeyPrefixValue,
      "MCP_EXECUTOR_REDIS_KEY_PREFIX",
      legacyRedisKeyPrefix,
    ) ?? "mcp:executor-epoch:";
  const epochs = epochStoreSettings(
    epochStoreType,
    {
      mode: redisMode,
      ...(redisUrlSetting === undefined ? {} : { url: redisUrlSetting }),
      ...(redisNodes === undefined ? {} : { nodes: redisNodes }),
      ...(redisSentinelName === undefined ? {} : { sentinelName: redisSentinelName }),
      ...(redisUsername === undefined ? {} : { username: redisUsername }),
      ...(redisPassword === undefined ? {} : { password: redisPassword }),
      ...(redisSentinelPassword === undefined ? {} : { sentinelPassword: redisSentinelPassword }),
      ...(redisDb === undefined ? {} : { db: redisDb }),
      ...(redisTls === undefined ? {} : { tls: redisTls }),
      keyPrefix: redisKeyPrefix,
    },
    urls !== undefined,
  );
  if (
    env["NODE_ENV"] === "production" &&
    urls !== undefined &&
    env["MCP_EXECUTOR_ALLOWED_USER_IDS"] === undefined
  )
    throw new Error("NODE_ENV=production requires MCP_EXECUTOR_ALLOWED_USER_IDS with an executor");
  const clientId = config.MCP_OAUTH_CLIENT_ID;
  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new Error("MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET must be set together");
  }
  if (clientId === undefined && passthrough === "") {
    throw new Error(
      "Configure MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET, or set MCP_DEV_SESSION_PASSTHROUGH=1 for local development",
    );
  }
  const uploadLimits = { ...defaultLimits };
  for (const purpose of Object.keys(defaultLimits) as (keyof UploadLimits)[]) {
    const value = env[`MCP_UPLOAD_${purpose.toUpperCase().replaceAll("-", "_")}_MAX_BYTES`];
    if (value !== undefined)
      uploadLimits[purpose] = z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
        .parse(value);
  }
  return Object.freeze({
    uploadLimits: Object.freeze(uploadLimits),
    ...configWithoutSecret,
    executor:
      urls === undefined || executorToken === undefined
        ? null
        : {
            urls: [...new Set(urls)],
            executorToken,
            epochs: Object.freeze(epochs),
            capabilitiesIntervalMs,
          },
    WORKSPACE_TRANSPORT_URL: config.WORKSPACE_TRANSPORT_URL ?? config.WORKSPACE_ORIGIN,
    auth: Object.freeze({
      exchange:
        clientId === undefined || clientSecret === undefined
          ? null
          : Object.freeze({ clientId, clientSecret }),
      devSessionPassthrough: passthrough === "1",
    }),
  });
}
