import {
  WorkspaceContentSource,
  type WorkspaceContentRuntime,
} from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import type { Logger } from "pino";
import type { ExecutorConfig } from "../shared/config-executor.js";
import {
  opSpecs,
  type OpInput,
  type OpName,
  type OpSpec,
  type RequestHeader,
} from "../shared/executor-protocol.js";
import { zeroCost, type OpMeta } from "../shared/usage.js";
import type { Handler, OpContext } from "./context.js";
import { createGrantVerifier, grantCookie, resolveGrant } from "./credentials.js";
import { mapRuntimeError, timeoutError } from "./errors.js";
import { handlers } from "./ops/index.js";
import { bindRuntime } from "./runtime.js";
import { ConversionJobQueue } from "./jobs/queue.js";
import { runConversionJob } from "./jobs/run.js";
import { UNIVER_LICENSE, UNIVER_LICENSE_KEY } from "./license.js";

export function createDispatcher(
  config: ExecutorConfig,
  runtime: WorkspaceContentRuntime,
  logger: Logger,
) {
  const jobs = new ConversionJobQueue(config.EXECUTOR_MAX_JOBS);
  const verifyGrant = createGrantVerifier(config);
  const dispatchers: { [K in OpName]: Handler<K> } = handlers;
  return async function dispatch<K extends OpName>(
    name: K,
    header: RequestHeader,
    payload: Uint8Array,
  ) {
    const spec: OpSpec = opSpecs[name];
    const controller = new AbortController();
    const usage: OpMeta = { executor: "none", cost: { ...zeroCost } };
    let writeStarted = name !== "exchange.import" && name !== "markdown.compile";
    let effect = spec.effect;
    const currentTimeout = () => timeoutError(effect, "deadline", writeStarted);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const input = spec.input.parse(header.input) as OpInput<(typeof opSpecs)[K]>;
      effect = spec.effectFor?.(input) ?? spec.effect;
      const grant = resolveGrant(header.grant);
      const fetcher: typeof fetch = (url, options) => {
        const headers = new Headers(options?.headers);
        headers.set("x-request-id", header.requestId);
        return fetch(url, {
          ...options,
          headers,
          signal: AbortSignal.any([
            controller.signal,
            ...(options?.signal ? [options.signal] : []),
          ]),
        });
      };
      const http = new WorkspaceHttp({
        cookie: grantCookie(grant),
        origin: config.WORKSPACE_ORIGIN,
        transportOrigin: config.WORKSPACE_TRANSPORT_URL,
        role: "client",
        fetcher,
      });
      const source = new WorkspaceContentSource(http);
      const credentials = {
        license: config.UNIVER_LICENSE ?? UNIVER_LICENSE,
        licenseKey: config.UNIVER_LICENSE_KEY ?? UNIVER_LICENSE_KEY,
      };
      const ctx: OpContext = {
        requestId: header.requestId,
        signal: controller.signal,
        userId: grant.userId,
        transportOrigin: config.WORKSPACE_TRANSPORT_URL,
        usage,
        http: () => http,
        onCreateUnit: () => {
          writeStarted = true;
        },
        source: () => source,
        runtime: bindRuntime(runtime, grant, usage, controller.signal),
        materializer: {
          materialize: async (input) => {
            usage.executor = "cold_start";
            usage.unitType = "doc";
            const release = await jobs.acquire(controller.signal);
            try {
              return await runConversionJob(
                { kind: "markdown.materialize", ...input },
                credentials,
                controller.signal,
                undefined,
                config.EXECUTOR_JOB_HEAP_MB,
              );
            } finally {
              release();
            }
          },
        },
        exchange: {
          ...credentials,
          importBuffer: async (bytes, options) => {
            usage.executor = "cold_start";
            const types: Readonly<Record<number, string>> = {
              1: "doc",
              2: "sheet",
              3: "slide",
              5: "base",
            };
            usage.unitType = types[options.type] ?? null;
            const release = await jobs.acquire(controller.signal);
            try {
              return await runConversionJob(
                { kind: "import", bytes, options },
                credentials,
                controller.signal,
                undefined,
                config.EXECUTOR_JOB_HEAP_MB,
              );
            } finally {
              release();
            }
          },
          exportToBuffer: async (data, options) => {
            usage.executor = "cold_start";
            const release = await jobs.acquire(controller.signal);
            try {
              const bytes = await runConversionJob(
                { kind: "export", data, options },
                credentials,
                controller.signal,
                undefined,
                config.EXECUTOR_JOB_HEAP_MB,
              );
              return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            } finally {
              release();
            }
          },
        },
      };
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            const error = currentTimeout();
            controller.abort(error);
            setImmediate(() => reject(error));
          },
          Math.min(header.deadlineMs, spec.limits.budgetMs),
        );
      });
      const payloadArgs = (
        spec.payload === "request" ? [payload] : []
      ) as (typeof opSpecs)[K]["payload"] extends "request" ? [Uint8Array] : [];
      const result = await Promise.race([
        (async () => {
          await verifyGrant(grant, header.requestId);
          controller.signal.throwIfAborted();
          return await dispatchers[name](ctx, input, ...payloadArgs);
        })(),
        deadline,
      ]);
      return {
        header: { ok: true as const, output: result.output, meta: usage },
        payload: "bytes" in result && result.bytes instanceof Uint8Array ? result.bytes : undefined,
      };
    } catch (error) {
      const translated =
        controller.signal.aborted &&
        (effect === "read" || name === "exchange.import" || name === "markdown.compile") &&
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "workspace-runtime-not-started"
        )
          ? currentTimeout().wire
          : mapRuntimeError(error, effect);
      if (translated.outcome === "internal_error")
        logger.error(
          { request_id: header.requestId, op: name, code: translated.code },
          "Executor operation failed",
        );
      return { header: { ok: false as const, error: translated, meta: usage }, payload: undefined };
    } finally {
      clearTimeout(timer);
    }
  };
}
