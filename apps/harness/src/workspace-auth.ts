/**
 * Process-wide Workspace connection seam for the local Harness.
 *
 * A local Harness instance has one remote Workspace identity. Consumers do
 * not select a user from a request and this service does not implement local
 * permissions; it only exposes the connection chosen before process startup.
 *
 * @module @univerjs/univer-workspace-harness/workspace-auth
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { UwhIdentity } from "./contract.ts";

export const WORKSPACE_SESSION_COOKIE = "workspace_session";

export interface WorkspaceHttpClient {
  readonly origin: string;
  readonly sessionToken: string;
  request(path: string, init?: RequestInit): Promise<Response>;
}

export abstract class WorkspaceAuthService extends Service {
  constructor(ctx: Context) {
    super(ctx, "workspaceAuth");
  }

  /** Origin of the connection bound when this process started. */
  abstract effectiveOrigin(): string;

  /** Origin selected in Settings for the next Device Authorization flow. */
  abstract loginOrigin(): string;

  /** Remote identity shared by every request in this local process. */
  abstract currentIdentity(): UwhIdentity | undefined;

  /** Remote HTTP client shared by every request in this local process. */
  abstract currentClient(): WorkspaceHttpClient | undefined;

  /** Persist the connection that becomes active after a full restart. */
  abstract stageConnection(identity: UwhIdentity, token: string, origin: string): Promise<void>;

  /** Persist an unconnected next startup state. */
  abstract stageDisconnect(): Promise<void>;

  /** Whether persisted next-start state differs from this running process. */
  abstract restartRequired(): boolean;

  /** Identity staged for the next start, if any. */
  abstract pendingIdentity(): UwhIdentity | undefined;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    workspaceAuth: WorkspaceAuthService;
  }
}
