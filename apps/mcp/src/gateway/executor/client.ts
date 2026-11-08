import { ExecutorCallError } from "../../shared/errors.js";
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
import { classifyFetchFailure, ExecutorRouter } from "./router.js";

export interface ExecutorConnection {
  readonly router: ExecutorRouter;
  readonly internalToken: string;
  readonly grant: ExecutorGrant;
  readonly requestId: string;
  readonly deadlineAt: number;
}

function unavailable(code = "workspace-executor-unavailable"): ExecutorCallError {
  return new ExecutorCallError({
    code,
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
  if (!connection) throw unavailable();
  const route = spec.route(input);
  const key = [connection.grant.userId, route.scope, route.unitId ?? connection.requestId].join(
    "\0",
  );
  let lastError = unavailable();
  for (const url of connection.router.candidates(key)) {
    const timeoutMs = Math.floor(
      Math.min(spec.limits.budgetMs, connection.deadlineAt - Date.now() - 500),
    );
    if (timeoutMs <= 1500) throw lastError;
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
    if (body.length > spec.limits.requestBytes) throw unavailable("workspace-request-too-large");
    let response: Response;
    try {
      response = await fetch(new URL(`/rpc/v1/${spec.name}`, url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${connection.internalToken}`,
          "content-type": FRAME_CONTENT_TYPE,
          "x-mcp-rpc-version": "1",
        },
        body: new Uint8Array(body),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (classifyFetchFailure(error) === "not-delivered") {
        connection.router.notDelivered(url);
        continue;
      }
      throw ambiguous(spec.effect);
    }
    if (!response.ok) {
      await response.body?.cancel();
      const code =
        response.status === 426
          ? "workspace-executor-version-mismatch"
          : response.status === 413
            ? "workspace-request-too-large"
            : "workspace-executor-unavailable";
      lastError = unavailable(code);
      if ([503, 426, 413].includes(response.status)) {
        connection.router.notDelivered(url);
        continue;
      }
      throw lastError;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (!response.body) throw new Error("Missing response body");
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > spec.limits.responseBytes)
          throw new ExecutorCallError({
            code: "workspace-result-too-large",
            message: "Narrow the request; the executor result exceeds its byte limit.",
            detail: null,
            outcome: "tool_error",
          });
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof ExecutorCallError) throw error;
      throw ambiguous(spec.effect);
    }
    try {
      const frame = decodeFrame(Buffer.concat(chunks));
      if (spec.payload !== "response" && frame.payload.length !== 0)
        throw new Error("Unexpected response payload");
      const header = responseHeaderSchema.parse(frame.header);
      if (!header.ok) throw new ExecutorCallError(header.error);
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

function ambiguous(effect: "read" | "write"): ExecutorCallError {
  return new ExecutorCallError({
    code: effect === "write" ? "workspace-result-unknown" : "workspace-executor-timeout",
    message:
      effect === "write"
        ? "The write may have completed. Check the current state before repeating it."
        : "The executor connection failed or timed out. Retry the read.",
    detail: { retryable: effect === "read" },
    outcome: "timeout",
  });
}
