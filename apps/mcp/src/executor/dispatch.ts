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
import { grantCookie, resolveGrant } from "./credentials.js";
import { mapRuntimeError, timeoutError } from "./errors.js";
import { handlers } from "./ops/index.js";
import { bindRuntime } from "./runtime.js";

export function createDispatcher(
  config: ExecutorConfig,
  runtime: WorkspaceContentRuntime,
  logger: Logger,
) {
  const dispatchers: { [K in OpName]: Handler<K> } = handlers;
  return async function dispatch<K extends OpName>(
    name: K,
    header: RequestHeader,
    payload: Uint8Array,
  ) {
    const spec: OpSpec = opSpecs[name];
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const input = spec.input.parse(header.input) as OpInput<(typeof opSpecs)[K]>;
      const grant = resolveGrant(header.grant);
      const usage: OpMeta = { executor: "none", cost: { ...zeroCost } };
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
      const ctx: OpContext = {
        requestId: header.requestId,
        signal: controller.signal,
        userId: grant.userId,
        transportOrigin: config.WORKSPACE_TRANSPORT_URL,
        usage,
        http: () => http,
        source: () => source,
        runtime: bindRuntime(runtime, grant, usage, controller.signal),
      };
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            const error = timeoutError(spec.effect);
            controller.abort(error);
            reject(error);
          },
          Math.min(header.deadlineMs, spec.limits.budgetMs),
        );
      });
      const payloadArgs = (
        spec.payload === "request" ? [payload] : []
      ) as (typeof opSpecs)[K]["payload"] extends "request" ? [Uint8Array] : [];
      const result = await Promise.race([dispatchers[name](ctx, input, ...payloadArgs), deadline]);
      return {
        header: { ok: true as const, output: result.output, meta: usage },
        payload: "bytes" in result && result.bytes instanceof Uint8Array ? result.bytes : undefined,
      };
    } catch (error) {
      const translated = mapRuntimeError(error, spec.effect);
      if (translated.outcome === "internal_error")
        logger.error(
          { request_id: header.requestId, op: name, code: translated.code },
          "Executor operation failed",
        );
      return { header: { ok: false as const, error: translated }, payload: undefined };
    } finally {
      clearTimeout(timer);
    }
  };
}
