import { z } from "zod";

const positive = z.coerce.number().int().positive().max(2_147_483_647);
const environment = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: positive.max(65535).default(3000),
  MCP_RENDERER_TOKEN: z.string().min(32),
  METRICS_TOKEN: z.string().optional(),
  RENDERER_MAX_RUNTIMES: positive.default(2),
  RENDERER_QUEUE_TIMEOUT_MS: positive.default(5_000),
  RENDERER_OPERATION_TIMEOUT_MS: positive.default(25_000),
  UNIVER_LICENSE: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
export function parseRendererConfig(env: NodeJS.ProcessEnv) {
  return Object.freeze(environment.parse(env));
}
export type RendererConfig = ReturnType<typeof parseRendererConfig>;
