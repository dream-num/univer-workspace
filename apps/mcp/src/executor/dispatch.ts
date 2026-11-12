import { Counter, Registry } from "prom-client";
import {
  WorkspaceContentSource,
  type WorkspaceContentRuntime,
} from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import type { Logger } from "pino";
import { setTimeout as delay } from "node:timers/promises";
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
import { createRendererClient } from "./renderer-client.js";
import { bindRuntime, getRuntimeRerun } from "./runtime.js";
import { ConversionJobQueue } from "./jobs/queue.js";
import { runConversionJob } from "./jobs/run.js";
import { UNIVER_LICENSE, UNIVER_LICENSE_KEY } from "./license.js";
import type { RendererOpName } from "../shared/renderer-protocol.js";

// Same-user reads and writes take turns on a Unit; other routes still need revision reruns.
function createUnitQueue() {
  const tails = new Map<string, Promise<void>>();
  return async (key: string, signal: AbortSignal) => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const turn = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => turn);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    let onAbort = () => {};
    try {
      signal.throwIfAborted();
      await Promise.race([
        previous,
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } catch (error) {
      release();
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    return release;
  };
}

export function createDispatcher(
  config: ExecutorConfig,
  runtime: WorkspaceContentRuntime,
  logger: Logger,
  rendererOperations: () => ReadonlySet<RendererOpName> = () => new Set(),
) {
  const jobs = new ConversionJobQueue(config.EXECUTOR_MAX_JOBS);
  const verifyGrant = createGrantVerifier(config);
  const dispatchers: { [K in OpName]: Handler<K> } = handlers;
  const metrics = new Registry();
  const enterUnitQueue = createUnitQueue();
  const reruns = new Counter({
    name: "mcp_executor_reruns_total",
    help: "Executor handler reruns by reason.",
    labelNames: ["reason"],
    registers: [metrics],
  });
  async function dispatch<K extends OpName>(
    name: K,
    header: RequestHeader,
    payload: Uint8Array,
    receivedAt = Date.now(),
  ) {
    const spec: OpSpec = opSpecs[name];
    const controller = new AbortController();
    const deadlineAt = receivedAt + Math.min(header.deadlineMs, spec.limits.budgetMs);
    const usage: OpMeta = { executor: "none", cost: { ...zeroCost } };
    let writeStarted = ![
      "content.execute",
      "exchange.import",
      "markdown.compile",
      "typst.compile",
      "svg.compile",
      "htmlView.draft",
    ].includes(name);
    let effect = spec.effect;
    let queued = false;
    const currentTimeout = () => timeoutError(effect, "deadline", !queued && writeStarted);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (deadlineAt <= Date.now()) throw currentTimeout();
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
        renderer: createRendererClient({
          url: config.MCP_RENDERER_URL,
          rendererToken: config.MCP_RENDERER_TOKEN,
          requestId: header.requestId,
          deadlineAt,
          signal: controller.signal,
          operations: rendererOperations(),
        }),
        onCreateUnit: () => {
          writeStarted = true;
        },
        source: () => source,
        runtime: bindRuntime(runtime, grant, usage, controller.signal, verifyGrant.invalidate),
        compileTypst: async (bundle) => {
          usage.executor = "cold_start";
          const release = await jobs.acquire(controller.signal);
          try {
            return await runConversionJob(
              { kind: "typst.compile", bundle },
              credentials,
              controller.signal,
              undefined,
              config.EXECUTOR_JOB_HEAP_MB,
            );
          } finally {
            release();
          }
        },
        materializer: {
          materialize: async (input) => {
            usage.executor = "cold_start";
            usage.unitType = "doc";
            const release = await jobs.acquire(controller.signal);
            try {
              return await runConversionJob(
                {
                  kind: "markdown.materialize",
                  ...input,
                  format: name === "typst.compile" ? "Typst" : "Markdown",
                },
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
          Math.max(0, deadlineAt - Date.now()),
        );
      });
      const payloadArgs = (
        spec.payload === "request" ? [payload] : []
      ) as (typeof opSpecs)[K]["payload"] extends "request" ? [Uint8Array] : [];
      const result = await Promise.race([
        (async () => {
          await verifyGrant(grant, header.requestId);
          controller.signal.throwIfAborted();
          const rerun = { auth: 0, revision: 0 };
          let release = () => {};
          if (spec.queueFor?.(input)) {
            const route = spec.route(input as never);
            queued = true;
            release = await enterUnitQueue(
              JSON.stringify([grant.userId, route.scope, route.unitId]),
              controller.signal,
            );
            queued = false;
            if (name === "content.execute") writeStarted = true;
          }
          try {
            for (;;) {
              controller.signal.throwIfAborted();
              try {
                return await dispatchers[name](ctx, input, ...payloadArgs);
              } catch (error) {
                const retry = getRuntimeRerun(error);
                const readRevision = effect === "read" && retry === "revision";
                if (
                  !retry ||
                  !spec.rerun.includes(retry) ||
                  rerun[retry] >= (readRevision ? 3 : 1) ||
                  controller.signal.aborted ||
                  deadlineAt - Date.now() < 5000
                )
                  throw error;
                if (readRevision) {
                  await delay(25 + Math.floor(Math.random() * 76), undefined, {
                    signal: controller.signal,
                  });
                  if (deadlineAt - Date.now() < 5000) throw error;
                }
                rerun[retry]++;
                reruns.inc({ reason: retry });
                logger.info(
                  {
                    event: "mcp.executor_rerun",
                    request_id: header.requestId,
                    op: name,
                    reason: retry,
                  },
                  "Executor operation rerun",
                );
              }
            }
          } finally {
            release();
          }
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
        (effect === "read" ||
          [
            "content.execute",
            "exchange.import",
            "markdown.compile",
            "typst.compile",
            "svg.compile",
            "htmlView.draft",
          ].includes(name)) &&
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "workspace-runtime-not-started"
        )
          ? currentTimeout().wire
          : mapRuntimeError(error, writeStarted ? effect : "read");
      if (translated.outcome === "internal_error")
        logger.error(
          { request_id: header.requestId, op: name, code: translated.code },
          "Executor operation failed",
        );
      return {
        header: { ok: false as const, error: translated, meta: usage },
        payload: undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.assign(dispatch, { metrics });
}
