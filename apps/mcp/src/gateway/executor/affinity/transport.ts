import { setTimeout as delay } from "node:timers/promises";
import type { Logger } from "pino";
import { ExecutorCallError } from "../../../shared/errors.js";
import { AFFINITY_HEADER } from "../../../shared/executor-protocol.js";
import type { EpochStore } from "./epoch-store.js";
import { createSessionAffinity } from "./session.js";

// Calls to an executor that advertised `affinity: "header"`, such as an FC HTTP trigger.
// Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md sections 3.3, 3.9 and 4.

/** Enough of a platform error to tell an FC Session failure from the executor's own envelope. */
const ERROR_SNIPPET_BYTES = 4 * 1024;
const THROTTLE_BASE_MS = 100;
const THROTTLE_MAX_MS = 2_000;
const DEFAULT_MAX_THROTTLE_ATTEMPTS = 2;

export interface AffinityRequest {
  /** Executor origin, one of `MCP_EXECUTOR_URLS`. */
  readonly url: string;
  /** Canonical key from `affinityKey`. */
  readonly key: string;
  /** Path resolved against the origin, such as `/rpc/v1/content.inspect`. */
  readonly path: string;
  readonly init: RequestInit;
}

export interface AffinityTransport {
  /**
   * Sends one request with the key's Session ID and resolves with the final `Response`.
   * Retries only failures known to precede function execution: a platform Session 401
   * (renew the epoch, retry once) and a 429 (bounded backoff). Network errors are thrown
   * unchanged so writes keep their "could it have been applied?" semantics. Failures that
   * provably sent nothing (the epoch store, a backoff cut short) throw
   * `workspace-executor-unavailable`.
   */
  request(request: AffinityRequest): Promise<Response>;
}

export interface AffinityTransportOptions {
  readonly epochs: EpochStore;
  readonly fetcher?: typeof fetch;
  readonly maxThrottleAttempts?: number;
  readonly random?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /**
   * Whether a 401 is the platform's Session failure. Defaults to "anything that is not the
   * executor's own `workspace-*` error envelope", because the executor answers operation
   * failures with HTTP 200 and its only 401 is a bearer mismatch. Replace this once the
   * platform error shape is verified against FC (design 6.1).
   */
  readonly retryOnSessionError?: (response: Response) => boolean | Promise<boolean>;
  readonly logger?: Pick<Logger, "debug" | "info">;
}

export function createAffinityTransport(options: AffinityTransportOptions): AffinityTransport {
  // Resolved per request instead of captured: a test that replaces globalThis.fetch after
  // construction must still be honoured.
  const fetcher: typeof fetch = (input, init) => (options.fetcher ?? globalThis.fetch)(input, init);
  const session = createSessionAffinity(options.epochs);
  const maxThrottleAttempts = options.maxThrottleAttempts ?? DEFAULT_MAX_THROTTLE_ATTEMPTS;
  const random = options.random ?? Math.random;
  const sleep =
    options.sleep ??
    (async (ms: number, signal: AbortSignal | undefined) => {
      await delay(ms, undefined, signal === undefined ? {} : { signal });
    });
  if (!Number.isInteger(maxThrottleAttempts) || maxThrottleAttempts < 0)
    throw new Error("maxThrottleAttempts must be a non-negative integer");

  const throttleDelay = (attempt: number): number => {
    const ceiling = Math.min(THROTTLE_BASE_MS * 2 ** attempt, THROTTLE_MAX_MS);
    // Jitter keeps replicas that were throttled together from retrying in lockstep.
    return Math.max(0, Math.round(ceiling * (0.75 + random() * 0.5)));
  };

  return {
    async request({ url, key, path, init }) {
      const target = new URL(path, url);
      // Every epoch read and renewal happens before a send, so its failure sent nothing, whatever
      // the store throws (a failed connect, a command timeout after Redis went away).
      const epochSession = async <T>(work: Promise<T>): Promise<T> => {
        try {
          return await work;
        } catch {
          throw notSent("epoch-store", "The executor epoch store is unavailable.");
        }
      };
      let sessionId = await epochSession(session.sessionId(key));
      let renewed = false;
      let throttles = 0;
      let attempt = 0;
      for (;;) {
        attempt += 1;
        options.logger?.debug(
          {
            event: "mcp.executor_request",
            executor: target.origin,
            path,
            attempt,
            [AFFINITY_HEADER]: sessionId,
          },
          "Executor request",
        );
        const headers = new Headers(init.headers);
        headers.set(AFFINITY_HEADER, sessionId);
        const response = await fetcher(target, {
          ...init,
          headers,
          redirect: init.redirect ?? "manual",
        });
        if (
          response.status === 401 &&
          !renewed &&
          (await isPlatformSessionError(response, options.retryOnSessionError))
        ) {
          await discard(response);
          sessionId = (await epochSession(session.renew(key))).sessionId;
          renewed = true;
          options.logger?.info(
            {
              event: "mcp.executor_session_renewed",
              executor: target.origin,
              path,
              [AFFINITY_HEADER]: sessionId,
            },
            "Executor affinity Session renewed after a platform 401",
          );
          continue;
        }
        if (response.status === 429 && throttles < maxThrottleAttempts) {
          const wait = throttleDelay(throttles);
          throttles += 1;
          await discard(response);
          try {
            await sleep(wait, init.signal ?? undefined);
          } catch {
            // A 429 is answered before the function runs, so a call deadline that ends the
            // backoff still sent nothing.
            throw notSent("throttled", "The executor stayed throttled until the deadline.");
          }
          continue;
        }
        return response;
      }
    },
  };
}

function notSent(cause: "epoch-store" | "throttled", message: string): ExecutorCallError {
  return new ExecutorCallError({
    code: "workspace-executor-unavailable",
    message: `${message} The call was not run; it is safe to repeat.`,
    detail: { cause, retryable: true },
    outcome: "internal_error",
  });
}

async function isPlatformSessionError(
  response: Response,
  override: AffinityTransportOptions["retryOnSessionError"],
): Promise<boolean> {
  if (override !== undefined) return await override(response);
  return !isExecutorErrorEnvelope(await boundedText(response, ERROR_SNIPPET_BYTES));
}

/** The executor's `reject()` body: `{ error: { code: "workspace-…" } }`. */
function isExecutorErrorEnvelope(text: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("workspace-");
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A response already closed by the platform is still safe to retry.
  }
}

/** Reads at most `limit` bytes so a verbose platform error cannot exhaust the gateway. */
async function boundedText(response: Response, limit: number): Promise<string> {
  const body = response.clone().body;
  if (body === null || limit <= 0) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      const take = Math.min(value.length, limit - size);
      if (take > 0) {
        chunks.push(value.subarray(0, take));
        size += take;
      }
      if (size >= limit) break;
    }
  } catch {
    return "";
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, size).toString("utf8");
}
