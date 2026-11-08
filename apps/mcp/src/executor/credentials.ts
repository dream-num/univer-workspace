import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
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
