import { createHash } from "node:crypto";
import {
  whoami,
  type WorkspaceHttp,
  workspaceError,
} from "@univerjs/univer-workspace-client-core/product";
import { executorGrantSchema, type ExecutorGrant } from "../shared/executor-protocol.js";

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

export function createGrantVerifier() {
  const sessions = new Map<string, { expiresAt: number; user: Promise<string> }>();
  return async (grant: ExecutorGrant, http: WorkspaceHttp): Promise<void> => {
    const key = createHash("sha256").update(grant.session).digest("hex");
    for (const [hash, entry] of sessions) {
      if (entry.expiresAt <= Date.now()) sessions.delete(hash);
    }
    let entry = sessions.get(key);
    if (entry === undefined) {
      if (sessions.size >= 10_000) sessions.delete(sessions.keys().next().value!);
      entry = {
        expiresAt: grant.expiresAt,
        user: whoami(http).then((identity) => identity.subject.id),
      };
      sessions.set(key, entry);
      const created = entry;
      void entry.user.catch(() => {
        if (sessions.get(key) === created) sessions.delete(key);
      });
    }
    if ((await entry.user) !== grant.userId) {
      throw workspaceError(
        "workspace-authentication-required",
        "The caller grant does not match the Workspace session.",
      );
    }
    resolveGrant(grant);
  };
}
