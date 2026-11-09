import type { WorkspaceSubject } from "@univerjs/univer-workspace-client-core/product";
import type { ExecutorGrant } from "../../shared/executor-protocol.js";
import type { Authentication } from "../auth.js";

export function issueGrant(auth: Authentication, user: WorkspaceSubject): ExecutorGrant {
  return { kind: "session", userId: user.id, session: auth.session, expiresAt: auth.expiresAt };
}
