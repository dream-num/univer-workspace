import { ExecutorCallError, resultUnknown } from "../../shared/errors.js";
import {
  PROTOCOL_VERSION,
  responseHeaderSchema,
  type ExecutorGrant,
  type ExecutorRequest,
  type ExecutorResult,
  type OpSpec,
  type PayloadDirection,
} from "../../shared/executor-protocol.js";
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from "../../shared/frame.js";
import type { z } from "zod";
import type { AffinityTransport } from "./affinity/transport.js";
import { classifyFetchFailure, ExecutorRouter } from "./router.js";

export interface ExecutorConnection {
  readonly router: ExecutorRouter;
  readonly executorToken: string;
  readonly grant: ExecutorGrant;
  readonly requestId: string;
  readonly deadlineAt: number;
  /** Sends attempts to executors that advertised `affinity: "header"`, such as one on FC. */
  readonly transport: AffinityTransport;
}

function unavailable(): ExecutorCallError {
  return new ExecutorCallError({
    code: "workspace-executor-unavailable",
    message: "The Workspace executor is unavailable.",
    detail: null,
    outcome: "internal_error",
  });
}

export async function callExecutor<
  I extends z.ZodType,
  O extends z.ZodObject,
  P extends PayloadDirection,
>(
  connection: ExecutorConnection | null,
  spec: OpSpec<I, O, P>,
  request: ExecutorRequest<OpSpec<I, O, P>>,
): Promise<ExecutorResult<OpSpec<I, O, P>>> {
  const { input } = request;
  const effect = spec.effectFor?.(input) ?? spec.effect;
  if (!connection) throw unavailable();
  const route = spec.route(input);
  const key = [connection.grant.userId, route.scope, route.unitId ?? connection.requestId].join(
    "\0",
  );
  // A platform Session must stay stable for Unit-less calls too: a per-request value would open a
  // new Session, and so a new instance, on every call.
  const sessionKey = [connection.grant.userId, route.scope, route.unitId ?? ""].join("\0");
  let lastError = unavailable();
  for (const url of connection.router.candidates(key)) {
    const timeoutMs = Math.floor(
      Math.min(spec.limits.budgetMs, connection.deadlineAt - Date.now() - 500),
    );
    if (timeoutMs <= 1500) throw requestError("workspace-executor-timeout");
    const body = encodeFrame(
      {
        v: PROTOCOL_VERSION,
        op: spec.name,
        requestId: connection.requestId,
        deadlineMs: timeoutMs - 1500,
        grant: connection.grant,
        input,
      },
      "bytes" in request && request.bytes instanceof Uint8Array ? request.bytes : undefined,
    );
    if (body.length > spec.limits.requestBytes) throw requestError("workspace-request-too-large");
    let response: Response;
    try {
      const path = `/rpc/v1/${spec.name}`;
      const init: RequestInit = {
        method: "POST",
        headers: {
          authorization: `Bearer ${connection.executorToken}`,
          "content-type": FRAME_CONTENT_TYPE,
          "x-mcp-rpc-version": "1",
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      };
      response = connection.router.usesAffinity(url)
        ? await connection.transport.request({ url, key: sessionKey, path, init })
        : await fetch(new URL(path, url), init);
    } catch (error) {
      // The affinity transport already classified a failure that provably sent nothing.
      if (error instanceof ExecutorCallError) throw error;
      if (classifyFetchFailure(error) === "not-delivered") {
        connection.router.notDelivered(url);
        continue;
      }
      throw ambiguous(effect, error);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 413) throw requestError("workspace-request-too-large");
      if (response.status === 426) throw requestError("workspace-executor-version-mismatch");
      lastError = unavailable();
      if (response.status === 503) {
        connection.router.notDelivered(url);
        continue;
      }
      // A platform 5xx is the function timeout or a lost instance, not a definite rejection: the
      // write may have committed before the response was lost. Reporting it as unavailable would
      // invite a repeat that applies the write twice. 413, 426 and 503 are answered before
      // dispatch, so they keep their definite meaning.
      if (effect === "write" && response.status >= 500)
        throw new ExecutorCallError(
          resultUnknown(`executor-http-${response.status}`, response.status === 504),
        );
      throw lastError;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (!response.body) throw new Error("Missing response body");
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > spec.limits.responseBytes)
          throw new ExecutorCallError(
            effect === "write"
              ? resultUnknown("workspace-result-too-large")
              : {
                  code: "workspace-result-too-large",
                  message: "Narrow the request; the executor result exceeds its byte limit.",
                  detail: null,
                  outcome: "tool_error",
                },
          );
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof ExecutorCallError) throw error;
      throw ambiguous(effect, error);
    }
    try {
      const frame = decodeFrame(Buffer.concat(chunks));
      if (spec.payload !== "response" && frame.payload.length !== 0)
        throw new Error("Unexpected response payload");
      const header = responseHeaderSchema.parse(frame.header);
      if (!header.ok) throw new ExecutorCallError(header.error, header.meta);
      return {
        output: spec.output.parse(header.output),
        meta: header.meta,
        ...(spec.payload === "response" ? { bytes: frame.payload } : {}),
      } as ExecutorResult<OpSpec<I, O, P>>;
    } catch (error) {
      if (error instanceof ExecutorCallError) throw error;
      throw new ExecutorCallError({
        code: "workspace-internal-error",
        message: "Invalid executor response.",
        detail: null,
        outcome: "internal_error",
      });
    }
  }
  throw lastError;
}

function ambiguous(effect: "read" | "write", error: unknown): ExecutorCallError {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const code =
    cause instanceof Error && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : cause instanceof Error
        ? cause.name
        : "workspace-internal-error";
  const timeout = [
    "TimeoutError",
    "AbortError",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
  ].includes(code);
  return new ExecutorCallError(
    effect === "write"
      ? resultUnknown(code, timeout)
      : {
          code: "workspace-executor-timeout",
          message: "The executor connection failed or timed out. Retry the read.",
          detail: { retryable: true, cause: code },
          outcome: "timeout",
        },
  );
}

function requestError(
  code:
    | "workspace-request-too-large"
    | "workspace-executor-version-mismatch"
    | "workspace-executor-timeout",
): ExecutorCallError {
  const messages = {
    "workspace-request-too-large":
      "The executor request is too large. Reduce the code or payload size.",
    "workspace-executor-version-mismatch":
      "The gateway and executor protocol versions differ. Update them to matching versions.",
    "workspace-executor-timeout":
      "The request budget expired before sending to the executor. Retry the operation.",
  };
  return new ExecutorCallError({
    code,
    message: messages[code],
    detail: code === "workspace-executor-timeout" ? { retryable: true, started: false } : null,
    outcome: "tool_error",
  });
}
