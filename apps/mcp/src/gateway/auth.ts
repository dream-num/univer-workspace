import { createHash } from "node:crypto";
import type { WorkspaceSubject } from "@univerjs/univer-workspace-client-core/product";
import type { Logger } from "pino";
import { z } from "zod";
import type { GatewayConfig } from "../shared/config.js";
import type { ToolScope } from "./tools/definition.js";

export const allScopes: ReadonlySet<ToolScope> = new Set([
  "read",
  "write",
  "publish",
  "worktree:merge",
]);
const exchangeGrant = "urn:ietf:params:oauth:grant-type:token-exchange";
const accessTokenType = "urn:ietf:params:oauth:token-type:access_token";
const exchangeResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string(),
  subject: z.object({
    kind: z.enum(["pat", "oauth"]),
    id: z.string().min(1),
    client_id: z.string().nullable(),
  }),
  user: z.object({ id: z.string().min(1), displayName: z.string() }),
});
const maxCacheMs = 30_000;
const negativeCacheMs = 5_000;
const maxCacheEntries = 10_000;
const maxNegativeCacheEntries = 1_000;

export interface Authentication {
  /** Value of the downstream `workspace_session` cookie. Never the caller's bearer. */
  readonly session: string;
  readonly obtainedAt: number;
  readonly expiresAt: number;
  readonly user: WorkspaceSubject | null;
  readonly scopes: ReadonlySet<ToolScope> | null;
  readonly authKind: "pat" | "oauth" | "dev";
  readonly clientId: string;
}

interface CacheEntry {
  readonly value: Authentication | null;
  readonly expiresAt: number;
}

export function createAuthenticator(config: GatewayConfig, logger: Logger, fetcher: typeof fetch) {
  const { exchange, devSessionPassthrough } = config.auth;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<Authentication | null>>();
  const negativeCache = new Map<string, CacheEntry>();
  const key = (bearer: string) => createHash("sha256").update(bearer).digest("hex");

  async function exchangeToken(bearer: string, requestId: string): Promise<CacheEntry> {
    if (exchange === null) throw new Error("Token exchange is not configured");
    let response: Response;
    try {
      response = await fetcher(new URL("/api/auth/token", config.WORKSPACE_TRANSPORT_URL), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-request-id": requestId },
        body: new URLSearchParams({
          grant_type: exchangeGrant,
          subject_token: bearer,
          subject_token_type: accessTokenType,
          resource: config.MCP_PUBLIC_URL,
          client_id: exchange.clientId,
          client_secret: exchange.clientSecret,
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      logger.error({ request_id: requestId }, "Token exchange could not reach Workspace");
      throw new Error("Token exchange unreachable");
    }
    const body: unknown = await response.json().catch(() => null);
    const error = z.object({ error: z.string() }).safeParse(body);
    if (response.status === 400 && error.success && error.data.error === "invalid_grant") {
      return { value: null, expiresAt: Date.now() + negativeCacheMs };
    }
    const parsed = exchangeResponse.safeParse(body);
    if (!response.ok || !parsed.success) {
      logger.error(
        {
          request_id: requestId,
          status: response.status,
          error: error.success ? error.data.error : null,
        },
        "Token exchange failed",
      );
      throw new Error("Token exchange failed");
    }
    const { subject, user, scope, access_token, expires_in } = parsed.data;
    const value: Authentication = {
      session: access_token,
      obtainedAt: Date.now(),
      expiresAt: Date.now() + expires_in * 1000,
      user: { id: user.id, name: user.displayName },
      scopes: new Set(
        scope.split(/\s+/).filter((name): name is ToolScope => allScopes.has(name as ToolScope)),
      ),
      authKind: subject.kind,
      clientId: subject.kind === "pat" ? subject.id : (subject.client_id ?? subject.id),
    };
    const ttl = Math.min(maxCacheMs, (expires_in - 5) * 1000);
    return { value, expiresAt: value.obtainedAt + ttl };
  }

  function makeRoom(entries: Map<string, CacheEntry>, limit: number): void {
    if (entries.size < limit) return;
    const now = Date.now();
    for (const [cacheKey, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(cacheKey);
    }
    if (entries.size >= limit) entries.delete(entries.keys().next().value!);
  }

  function cachedExchange(bearer: string, requestId: string): Promise<Authentication | null> {
    const cacheKey = key(bearer);
    const rejected = negativeCache.get(cacheKey);
    if (rejected && rejected.expiresAt > Date.now()) return Promise.resolve(null);
    negativeCache.delete(cacheKey);
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
    cache.delete(cacheKey);
    const existing = inFlight.get(cacheKey);
    if (existing) return existing;
    const pending = exchangeToken(bearer, requestId).then(
      (entry) => {
        if (inFlight.get(cacheKey) === pending) {
          inFlight.delete(cacheKey);
          const entries = entry.value === null ? negativeCache : cache;
          const limit = entry.value === null ? maxNegativeCacheEntries : maxCacheEntries;
          if (entry.expiresAt > Date.now()) {
            makeRoom(entries, limit);
            entries.set(cacheKey, entry);
          }
        }
        return entry.value;
      },
      (error: unknown) => {
        if (inFlight.get(cacheKey) === pending) inFlight.delete(cacheKey);
        throw error;
      },
    );
    // Uncapped: each entry is an outstanding exchange that settles within its fetch timeout, and an untracked
    // exchange would hold the same request and promise while losing the ordering this map provides.
    inFlight.set(cacheKey, pending);
    return pending;
  }

  return {
    /** Null means the caller must authenticate again; a thrown error is a gateway fault (HTTP 500). */
    async authenticate(bearer: string, requestId: string): Promise<Authentication | null> {
      if (/^uvw_(pat|at)_/.test(bearer)) {
        // A Workspace token must never be forwarded as a session, even in development.
        return exchange === null ? null : cachedExchange(bearer, requestId);
      }
      if (!devSessionPassthrough) return null;
      return {
        session: bearer,
        obtainedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        user: null,
        scopes: null,
        authKind: "dev",
        clientId: "dev",
      };
    },
    evict(bearer: string, failed: Authentication): void {
      const cacheKey = key(bearer);
      if (cache.get(cacheKey)?.value === failed) cache.delete(cacheKey);
    },
  };
}
