import { z } from "zod";
import { origin } from "./config.js";

const positive = z.coerce.number().int().positive().max(2_147_483_647);
const environment = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: positive.max(65535).default(3000),
  WORKSPACE_ORIGIN: origin,
  WORKSPACE_TRANSPORT_URL: origin.optional(),
  MCP_INTERNAL_TOKEN: z.string().min(32),
  MCP_EXECUTOR_CREDENTIALS: z.literal("session").default("session"),
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
  if (env["NODE_ENV"] === "production")
    throw new Error("NODE_ENV=production forbids executor session grants until Stage G");
  const config = environment.parse(env);
  if ((config.UNIVER_LICENSE === undefined) !== (config.UNIVER_LICENSE_KEY === undefined))
    throw new Error("UNIVER_LICENSE and UNIVER_LICENSE_KEY must be set together");
  return Object.freeze({
    ...config,
    WORKSPACE_TRANSPORT_URL: config.WORKSPACE_TRANSPORT_URL ?? config.WORKSPACE_ORIGIN,
  });
}
export type ExecutorConfig = ReturnType<typeof parseExecutorConfig>;
