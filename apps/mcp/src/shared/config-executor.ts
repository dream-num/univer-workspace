import { z } from "zod";
import { executorAllowedUserIds, origin } from "./config.js";

const positive = z.coerce.number().int().positive().max(2_147_483_647);
const environment = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: positive.max(65535).default(3000),
  WORKSPACE_ORIGIN: origin,
  WORKSPACE_TRANSPORT_URL: origin.optional(),
  MCP_EXECUTOR_TOKEN: z.string().min(32),
  MCP_RENDERER_URL: origin.optional(),
  MCP_RENDERER_TOKEN: z.string().min(32).optional(),
  MCP_EXECUTOR_CREDENTIALS: z.literal("session").default("session"),
  MCP_EXECUTOR_ALLOWED_USER_IDS: executorAllowedUserIds.optional(),
  EXECUTOR_MAX_JOBS: positive.default(2),
  EXECUTOR_JOB_HEAP_MB: positive.default(256),
  EXECUTOR_MAX_WORKERS: positive.default(4),
  EXECUTOR_IDLE_TTL_MS: positive.default(60_000),
  EXECUTOR_QUEUE_TIMEOUT_MS: positive.default(5_000),
  EXECUTOR_OPERATION_TIMEOUT_MS: positive.default(25_000),
  UNIVER_LICENSE: z.string().trim().min(1).optional(),
  UNIVER_LICENSE_KEY: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
export function parseExecutorConfig(env: NodeJS.ProcessEnv) {
  if (env["NODE_ENV"] === "production" && env["MCP_EXECUTOR_ALLOWED_USER_IDS"] === undefined)
    throw new Error(
      "NODE_ENV=production requires MCP_EXECUTOR_ALLOWED_USER_IDS for session grants",
    );
  const config = environment.parse(env);
  if ((config.UNIVER_LICENSE === undefined) !== (config.UNIVER_LICENSE_KEY === undefined))
    throw new Error("UNIVER_LICENSE and UNIVER_LICENSE_KEY must be set together");
  if ((config.MCP_RENDERER_URL === undefined) !== (config.MCP_RENDERER_TOKEN === undefined))
    throw new Error("MCP_RENDERER_URL and MCP_RENDERER_TOKEN must be set together");
  if (config.MCP_EXECUTOR_TOKEN === config.MCP_RENDERER_TOKEN)
    throw new Error("MCP_EXECUTOR_TOKEN and MCP_RENDERER_TOKEN must differ");
  return Object.freeze({
    ...config,
    WORKSPACE_TRANSPORT_URL: config.WORKSPACE_TRANSPORT_URL ?? config.WORKSPACE_ORIGIN,
  });
}
export type ExecutorConfig = ReturnType<typeof parseExecutorConfig>;
