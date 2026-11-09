import type { z } from "zod";
import { ExecutorCallError } from "../shared/errors.js";
import { PROTOCOL_VERSION, responseHeaderSchema } from "../shared/executor-protocol.js";
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from "../shared/frame.js";
import {
  rendererOpSpecs,
  type RendererOpName,
  type RendererOpOutput,
} from "../shared/renderer-protocol.js";
import type { OpMeta } from "../shared/usage.js";

export interface RendererResult<K extends RendererOpName> {
  readonly output: RendererOpOutput<K>;
  readonly bytes: Uint8Array;
  readonly meta: OpMeta;
}
export interface RendererClient {
  call<K extends RendererOpName>(
    name: K,
    input: z.input<(typeof rendererOpSpecs)[K]["input"]>,
  ): Promise<RendererResult<K>>;
}

const RESERVE_MS = 1_000;

function failure(
  code: string,
  message: string,
  outcome: "tool_error" | "internal_error" | "timeout",
  detail: { retryable: boolean } | null,
) {
  return new ExecutorCallError({ code, message, detail, outcome });
}
const unavailable = (outcome: "tool_error" | "internal_error" = "tool_error") =>
  failure(
    "workspace-renderer-unavailable",
    "The renderer is unavailable. Retry the operation.",
    outcome,
    { retryable: true },
  );
const timeout = () =>
  failure("workspace-renderer-timeout", "The renderer timed out. Retry the operation.", "timeout", {
    retryable: true,
  });

/**
 * Calls the renderer role over its internal RPC with the shared internal token. The renderer gets
 * no grant, so the request carries only the render unit and options.
 */
export function createRendererClient(options: {
  readonly url: string | undefined;
  readonly internalToken: string;
  readonly requestId: string;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}): RendererClient {
  return {
    async call(name, input) {
      const spec = rendererOpSpecs[name];
      if (options.url === undefined)
        throw failure(
          "workspace-renderer-not-configured",
          "This deployment has no renderer. Rendering is not available.",
          "tool_error",
          { retryable: false },
        );
      const budgetMs = Math.floor(
        Math.min(spec.limits.budgetMs, options.deadlineAt - Date.now() - RESERVE_MS),
      );
      if (budgetMs <= RESERVE_MS) throw timeout();
      const body = encodeFrame({
        v: PROTOCOL_VERSION,
        op: name,
        requestId: options.requestId,
        deadlineMs: budgetMs - RESERVE_MS,
        input,
      });
      if (body.length > spec.limits.requestBytes)
        throw failure(
          "workspace-request-too-large",
          "The Unit is too large to render.",
          "tool_error",
          null,
        );
      let response: Response;
      try {
        response = await fetch(new URL(`/rpc/v1/${name}`, options.url), {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.internalToken}`,
            "content-type": FRAME_CONTENT_TYPE,
            "x-mcp-rpc-version": "1",
          },
          body,
          redirect: "manual",
          signal: AbortSignal.any([options.signal, AbortSignal.timeout(budgetMs)]),
        });
      } catch (error) {
        // A read is safe to retry, so a lost connection and a timeout are both retryable.
        if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
          throw timeout();
        throw unavailable();
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 413)
          throw failure(
            "workspace-request-too-large",
            "The Unit is too large to render.",
            "tool_error",
            null,
          );
        if (response.status === 426)
          throw failure(
            "workspace-renderer-version-mismatch",
            "The executor and renderer protocol versions differ. Update them to matching versions.",
            "internal_error",
            null,
          );
        // 401 means the two roles disagree on the internal token: a deployment fault, not the caller's.
        throw unavailable(response.status === 503 ? "tool_error" : "internal_error");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if (!response.body) throw new Error("Missing response body");
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > spec.limits.responseBytes)
            throw failure(
              "workspace-result-too-large",
              "Narrow the request; the renderer result exceeds its byte limit.",
              "tool_error",
              null,
            );
          chunks.push(chunk);
        }
      } catch (error) {
        if (error instanceof ExecutorCallError) throw error;
        if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
          throw timeout();
        throw unavailable();
      }
      try {
        const frame = decodeFrame(Buffer.concat(chunks));
        const header = responseHeaderSchema.parse(frame.header);
        if (!header.ok) throw new ExecutorCallError(header.error, header.meta);
        return {
          output: spec.output.parse(header.output) as RendererOpOutput<typeof name>,
          bytes: frame.payload,
          meta: header.meta,
        };
      } catch (error) {
        if (error instanceof ExecutorCallError) throw error;
        throw failure(
          "workspace-internal-error",
          "Invalid renderer response.",
          "internal_error",
          null,
        );
      }
    },
  };
}
