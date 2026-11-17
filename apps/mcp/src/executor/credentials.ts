import { createHash } from "node:crypto";
import {
  sessionIdentity,
  WorkspaceHttp,
  workspaceError,
} from "@univerjs/univer-workspace-client-core/product";
import { executorGrantSchema, type ExecutorGrant } from "../shared/executor-protocol.js";
import type { ExecutorConfig } from "../shared/config-executor.js";
import { allowsExecutor } from "../shared/config.js";

export function resolveGrant(value: unknown): ExecutorGrant {
  const parsed = executorGrantSchema.safeParse(value);
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) {
    throw workspaceError(
      "workspace-authentication-required",
      "A valid, unexpired caller grant is required.",
    );
  }
  return parsed.data;
}

export function grantCookie(grant: ExecutorGrant): string {
  return `workspace_session=${grant.session}`;
}

export function createGrantVerifier(
  config: Pick<
    ExecutorConfig,
    "WORKSPACE_ORIGIN" | "WORKSPACE_TRANSPORT_URL" | "MCP_EXECUTOR_ALLOWED_USER_IDS"
  >,
  fetcher: typeof fetch = fetch,
) {
  const policy = config.MCP_EXECUTOR_ALLOWED_USER_IDS;
  const denied = () =>
    workspaceError("workspace-permission-denied", "Executor access is not enabled for this account.");
  // Cached until the grant expires, so a revoke in Workspace mode takes effect within one grant lifetime.
  const sessions = new Map<
    string,
    { expiresAt: number; user: Promise<{ id: string; executorAccess: boolean }> }
  >();
  const verify = async (grant: ExecutorGrant, requestId: string): Promise<void> => {
    if (policy instanceof Set && !policy.has(grant.userId)) throw denied();
    const key = createHash("sha256").update(grant.session).digest("hex");
    for (const [hash, entry] of sessions) {
      if (entry.expiresAt <= Date.now()) sessions.delete(hash);
    }
    let entry = sessions.get(key);
    if (entry === undefined) {
      if (sessions.size >= 10_000) sessions.delete(sessions.keys().next().value!);
      const signal = AbortSignal.timeout(10_000);
      const http = new WorkspaceHttp({
        cookie: grantCookie(grant),
        origin: config.WORKSPACE_ORIGIN,
        transportOrigin: config.WORKSPACE_TRANSPORT_URL,
        role: "client",
        fetcher: (url, options) => {
          const headers = new Headers(options?.headers);
          headers.set("x-request-id", requestId);
          return fetcher(url, { ...options, headers, signal });
        },
      });
      entry = {
        expiresAt: grant.expiresAt,
        user: sessionIdentity(http).then(({ subject, executorAccess }) => ({
          id: subject.id,
          executorAccess,
        })),
      };
      sessions.set(key, entry);
      const created = entry;
      void entry.user.catch(() => {
        if (sessions.get(key) === created) sessions.delete(key);
      });
    }
    const user = await entry.user;
    if (user.id !== grant.userId) {
      throw workspaceError(
        "workspace-authentication-required",
        "The caller grant does not match the Workspace session.",
      );
    }
    if (!allowsExecutor(policy, user)) throw denied();
    resolveGrant(grant);
  };
  return Object.assign(verify, {
    invalidate(grant: ExecutorGrant) {
      sessions.delete(createHash("sha256").update(grant.session).digest("hex"));
    },
  });
}
