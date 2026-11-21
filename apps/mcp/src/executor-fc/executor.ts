import type { WorkspaceContentRuntime } from "@univerjs/univer-workspace-client-core";
import type { Logger } from "pino";
import { parseExecutorConfig, type ExecutorConfig } from "../shared/config-executor.js";
import { createExecutor } from "../executor/server.js";

// FC session isolation serves one routing key per instance, so the worker pool and the
// conversion queue collapse to one slot each.
// Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md sections 3.7 and 4.

/** One FC instance serves one Session, so a second worker would only add memory and state. */
export const FC_MAX_WORKERS = 1;
/** Conversion children hold native heaps; one at a time per instance bounds the blast radius. */
export const FC_MAX_JOBS = 1;
/** A custom container must listen on all interfaces for the FC runtime to reach it. */
export const FC_DEFAULT_HOST = "0.0.0.0";
export const FC_DEFAULT_PORT = 9000;

export interface FcExecutorLayer {
  readonly host?: string;
  readonly port?: number;
}

export interface FcExecutorOptions {
  runtime?: WorkspaceContentRuntime;
  logger?: Logger;
}

/**
 * Pins the executor to the FC shape without touching the resident executor: the values below
 * are forced, so a leftover `EXECUTOR_MAX_WORKERS=4` cannot spawn a pool behind one Session.
 */
export function fcExecutorConfig(
  config: ExecutorConfig,
  layer: FcExecutorLayer = {},
): ExecutorConfig {
  return Object.freeze({
    ...config,
    HOST: layer.host ?? config.HOST,
    PORT: layer.port ?? config.PORT,
    EXECUTOR_MAX_WORKERS: FC_MAX_WORKERS,
    EXECUTOR_MAX_JOBS: FC_MAX_JOBS,
  });
}

/**
 * Executor configuration for an FC custom container. `HOST`/`PORT` are not read; the container
 * listens on `MCP_FC_HOST` (default `0.0.0.0`) and `MCP_FC_PORT` (default `9000`).
 */
export function parseFcExecutorConfig(
  env: NodeJS.ProcessEnv,
  execArgv: readonly string[] = [],
): ExecutorConfig {
  const config = parseExecutorConfig(env, execArgv);
  return fcExecutorConfig(config, {
    host: env["MCP_FC_HOST"] ?? FC_DEFAULT_HOST,
    port: parseFcPort(env["MCP_FC_PORT"]),
  });
}

/** The resident executor with the FC layer and limits applied. */
export function createExecutorFc(config: ExecutorConfig, options: FcExecutorOptions = {}) {
  return createExecutor(fcExecutorConfig(config), options);
}

function parseFcPort(value: string | undefined): number {
  if (value === undefined) return FC_DEFAULT_PORT;
  if (!/^\d+$/.test(value)) throw new Error("MCP_FC_PORT must be a port number");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("MCP_FC_PORT must be a port number between 1 and 65535");
  return port;
}
