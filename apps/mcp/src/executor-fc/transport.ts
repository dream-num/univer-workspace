import { setTimeout as delay } from "node:timers/promises";
import type { Logger } from "pino";
import {
  AFFINITY_HEADER,
  assertAffinityHeaderName,
  assertAffinityHeaderValue,
} from "./affinity.js";
import type { EpochStore } from "./epoch-store.js";
import { createSessionAffinity, type SessionAffinity } from "./session.js";

// Affinity-aware calls to an FC HTTP trigger.
// Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md sections 3.3, 3.9 and 4.

/** Enough of a platform error to tell an FC Session failure from the executor's own envelope. */
const ERROR_SNIPPET_BYTES = 4 * 1024;
const DEFAULT_THROTTLE_BASE_MS = 100;
const DEFAULT_THROTTLE_MAX_MS = 2_000;
const DEFAULT_MAX_THROTTLE_ATTEMPTS = 2;

export interface AffinityRequest {
  /**
   * Canonical key from `affinityKey`, or undefined for a request that must not carry affinity
   * (capability discovery). A keyed request always sends the header.
   */
  readonly key?: string;
  /** Overrides the transport endpoint for this request, such as one of several executor URLs. */
  readonly endpoint?: string;
  /** Path resolved against the endpoint, such as `/rpc/v1/content.inspect`. */
  readonly path: string;
  readonly init: RequestInit;
  /** Stops 429 backoff from spending budget the caller still needs for the response. */
  readonly deadlineAt?: number;
}

export interface AffinityTransport {
  readonly headerName: string;
  /** The Session ID the next keyed request would use. */
  sessionId(key: string): Promise<string>;
  /**
   * Sends one request with the key's Session ID and resolves with the final `Response`.
   * Retries only failures known to precede function execution: a platform Session 401
   * (renew the epoch, retry once) and a 429 (bounded backoff). Everything else, including
   * network errors, is returned or thrown to the caller so writes keep their existing
   * "could it have been applied?" semantics.
   */
  request(request: AffinityRequest): Promise<Response>;
}

export interface AffinityTransportOptions {
  /**
   * Default HTTP trigger origin, such as `https://<service>.<region>.fcapp.run`. Optional when
   * every request carries its own `endpoint`.
   */
  readonly endpoint?: string;
  readonly epochs: EpochStore;
  readonly headerName?: string;
  readonly fetcher?: typeof fetch;
  readonly session?: SessionAffinity;
  readonly maxThrottleAttempts?: number;
  readonly throttleBaseMs?: number;
  readonly throttleMaxMs?: number;
  readonly random?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /**
   * Whether a 401 is the platform's Session failure. Defaults to "anything that is not the
   * executor's own `workspace-*` error envelope", because the executor answers operation
   * failures with HTTP 200 and its only 401 is a bearer mismatch. Replace this once the
   * platform error shape is verified against FC (design 6.1).
   */
  readonly retryOnSessionError?: (response: Response) => boolean | Promise<boolean>;
  /** Logs the affinity header actually sent on every attempt. */
  readonly logger?: Pick<Logger, "info">;
}

export function createAffinityTransport(options: AffinityTransportOptions): AffinityTransport {
  const headerName = options.headerName ?? AFFINITY_HEADER;
  assertAffinityHeaderName(headerName);
  const endpoint = options.endpoint === undefined ? undefined : new URL(options.endpoint);
  // Resolved per request instead of captured: a test or an embedding application that replaces
  // globalThis.fetch after construction must still be honoured.
  const fetcher: typeof fetch = (input, init) => (options.fetcher ?? globalThis.fetch)(input, init);
  const session = options.session ?? createSessionAffinity({ epochs: options.epochs });
  const maxThrottleAttempts = options.maxThrottleAttempts ?? DEFAULT_MAX_THROTTLE_ATTEMPTS;
  const throttleBaseMs = options.throttleBaseMs ?? DEFAULT_THROTTLE_BASE_MS;
  const throttleMaxMs = options.throttleMaxMs ?? DEFAULT_THROTTLE_MAX_MS;
  const random = options.random ?? Math.random;
  const sleep =
    options.sleep ??
    (async (ms: number, signal: AbortSignal | undefined) => {
      await delay(ms, undefined, signal === undefined ? {} : { signal });
    });
  if (!Number.isInteger(maxThrottleAttempts) || maxThrottleAttempts < 0)
    throw new Error("maxThrottleAttempts must be a non-negative integer");

  const baseFor = (request: AffinityRequest): URL | undefined =>
    request.endpoint === undefined ? endpoint : new URL(request.endpoint);

  const send = (
    sessionId: string | undefined,
    request: AffinityRequest,
    base: URL,
  ): Promise<Response> => {
    const headers = new Headers(request.init.headers);
    if (sessionId !== undefined) {
      assertAffinityHeaderValue(sessionId);
      headers.set(headerName, sessionId);
    }
    return fetcher(new URL(request.path, base), {
      ...request.init,
      headers,
      redirect: request.init.redirect ?? "manual",
    });
  };

  const throttleDelay = (attempt: number): number => {
    const ceiling = Math.min(throttleBaseMs * 2 ** attempt, throttleMaxMs);
    // Jitter keeps replicas that were throttled together from retrying in lockstep.
    return Math.max(0, Math.round(ceiling * (0.75 + random() * 0.5)));
  };

  return {
    headerName,
    sessionId: (key) => session.sessionId(key),
    async request(input) {
      const { key, init } = input;
      const signal = init.signal ?? undefined;
      let sessionId = key === undefined ? undefined : await session.sessionId(key);
      let renewed = false;
      let throttles = 0;
      let attempt = 0;
      for (;;) {
        const base = baseFor(input);
        if (base === undefined)
          throw new Error(
            "An affinity request needs an endpoint: set it on the transport or the request",
          );
        attempt += 1;
        options.logger?.info(
          {
            event: "mcp.executor_request",
            executor: base.origin,
            path: input.path,
            attempt,
            [headerName]: sessionId ?? null,
          },
          "Executor request",
        );
        const response = await send(sessionId, input, base);
        if (
          response.status === 401 &&
          key !== undefined &&
          !renewed &&
          (await isPlatformSessionError(response, options.retryOnSessionError))
        ) {
          await discard(response);
          sessionId = (await session.renew(key)).sessionId;
          renewed = true;
          options.logger?.info(
            {
              event: "mcp.executor_session_renewed",
              executor: base.origin,
              path: input.path,
              [headerName]: sessionId,
            },
            "Executor affinity Session renewed after a platform 401",
          );
          continue;
        }
        if (response.status === 429 && throttles < maxThrottleAttempts) {
          const wait = throttleDelay(throttles);
          throttles += 1;
          if (input.deadlineAt !== undefined && Date.now() + wait >= input.deadlineAt)
            return response;
          await discard(response);
          await sleep(wait, signal);
          continue;
        }
        return response;
      }
    },
  };
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
