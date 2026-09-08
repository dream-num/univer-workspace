/**
 * Process-wide Workspace connection seam for the local Harness.
 *
 * A local Harness instance has one remote Workspace identity. Consumers do
 * not select a user from a request and this service does not implement local
 * permissions; it exposes the active connection while account-owned services reload.
 *
 * @module @univerjs/workspace-agent/workspace-auth
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

  /** Origin of the currently active connection. */
  abstract effectiveOrigin(): string;

  /** Origin selected in Settings for the next authorization flow. */
  abstract loginOrigin(): string;

  /** Remote identity shared by every request in this local process. */
  abstract currentIdentity(): UwhIdentity | undefined;

  /** Remote HTTP client shared by every request in this local process. */
  abstract currentClient(): WorkspaceHttpClient | undefined;

  /** Drain account-owned services and activate the persisted connection. */
  abstract connect(identity: UwhIdentity, token: string, origin: string): Promise<void>;

  /** Disconnect and switch to the unconnected local runtime. */
  abstract disconnect(): Promise<void>;

  /** Whether account-owned services are being switched. */
  abstract switching(): boolean;

  abstract connectionVersion(): string;

  /** Identity being activated, if any. */
  abstract pendingIdentity(): UwhIdentity | undefined;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    workspaceAuth: WorkspaceAuthService;
  }
}
