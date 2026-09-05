/**
 * Concrete process-wide Workspace connection provider for the local Harness.
 *
 * @module @univerjs/univer-workspace-harness/workspace-auth-provider
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import {
  canonicalWorkspaceOrigin,
  readConnectionStateSync,
  writeConfiguredOrigin,
  writeConnectionState,
  type WorkspaceConnection,
} from "./connection-state.ts";
import type { UwhIdentity } from "./contract.ts";
import {
  WORKSPACE_SESSION_COOKIE,
  WorkspaceAuthService,
  type WorkspaceHttpClient,
} from "./workspace-auth.ts";

export const UWH_SETTINGS_NAMESPACE = "univer-workspace-harness";

export interface WorkspaceAuthConfig {
  readonly workspaceOrigin: string;
  readonly connectionStatePath: string;
}

export interface WorkspaceAuthSettings {
  workspaceOrigin: string;
}

const settingsSchema = z.object({
  workspaceOrigin: z.string().required(),
});

export class WorkspaceAuthProvider extends WorkspaceAuthService {
  static readonly inject = ["settings"];

  private originSource: (() => WorkspaceAuthSettings) | undefined;
  private readonly active: WorkspaceConnection | undefined;
  private configuredOrigin: string;
  private settingsMounted = false;
  private settingsReset: Promise<void> = Promise.resolve();
  private settingsResetError: unknown;
  private originWrite: Promise<void> = Promise.resolve();
  private originWriteError: unknown;
  private staged = false;
  private next: WorkspaceConnection | undefined;

  constructor(
    ctx: Context,
    private readonly config: WorkspaceAuthConfig,
  ) {
    super(ctx);
    const state = readConnectionStateSync(config.connectionStatePath);
    this.active = state.active;
    this.configuredOrigin =
      state.configuredOrigin ??
      this.active?.origin ??
      canonicalWorkspaceOrigin(config.workspaceOrigin);
    const settingsEntry: WorkspaceAuthSettings = {
      workspaceOrigin: this.configuredOrigin,
    };
    ctx.settings.installSection(ctx, UWH_SETTINGS_NAMESPACE, settingsSchema, settingsEntry, {
      setSource: (current) => this.setOriginSource(current),
      onChange: () => this.handleOriginChange(),
    });
    this.settingsMounted = true;
    if (state.configuredOrigin === undefined && state.active === undefined) {
      this.handleOriginChange();
    } else {
      if (state.configuredOrigin === undefined) {
        this.persistConfiguredOrigin(this.configuredOrigin);
      }
      this.settingsReset = ctx.settings.replace(UWH_SETTINGS_NAMESPACE, {}).then(
        () => {
          this.settingsResetError = undefined;
        },
        (error: unknown) => {
          this.settingsResetError = error;
        },
      );
    }
  }

  async [Service.init](): Promise<void> {}

  setOriginSource(source: () => WorkspaceAuthSettings): void {
    this.originSource = source;
  }

  private handleOriginChange(): void {
    if (!this.settingsMounted) return;
    const configured = this.originSource?.().workspaceOrigin;
    if (configured === undefined) return;
    const origin = canonicalWorkspaceOrigin(configured);
    if (origin === this.configuredOrigin) return;
    this.configuredOrigin = origin;
    this.persistConfiguredOrigin(origin);
  }

  private persistConfiguredOrigin(origin: string): void {
    this.originWrite = writeConfiguredOrigin(this.config.connectionStatePath, origin).then(
      () => {
        this.originWriteError = undefined;
      },
      (error: unknown) => {
        this.originWriteError = error;
      },
    );
  }

  private async waitForOriginWrite(): Promise<void> {
    await this.settingsReset;
    if (this.settingsResetError !== undefined) throw this.settingsResetError;
    await this.originWrite;
    if (this.originWriteError !== undefined) throw this.originWriteError;
  }

  effectiveOrigin(): string {
    return this.active?.origin ?? canonicalWorkspaceOrigin(this.config.workspaceOrigin);
  }

  loginOrigin(): string {
    return this.configuredOrigin;
  }

  currentIdentity(): UwhIdentity | undefined {
    return this.active?.identity;
  }

  currentClient(): WorkspaceHttpClient | undefined {
    const active = this.active;
    if (active === undefined) return undefined;
    const { origin, sessionToken } = active;
    return {
      origin,
      sessionToken,
      request: (path, init) => {
        const headers = new Headers(init?.headers);
        headers.set("cookie", `${WORKSPACE_SESSION_COOKIE}=${sessionToken}`);
        const method = init?.method ?? "GET";
        if (method !== "GET" && method !== "HEAD" && !headers.has("origin")) {
          headers.set("origin", origin);
        }
        return fetch(new URL(path, origin), { ...init, headers });
      },
    };
  }

  async stageConnection(identity: UwhIdentity, token: string, origin: string): Promise<void> {
    await this.waitForOriginWrite();
    const next: WorkspaceConnection = {
      origin: canonicalWorkspaceOrigin(origin),
      identity,
      sessionToken: token,
    };
    await writeConnectionState(this.config.connectionStatePath, next);
    this.next = next;
    this.staged = true;
  }

  async stageDisconnect(): Promise<void> {
    await this.waitForOriginWrite();
    await writeConnectionState(this.config.connectionStatePath, undefined);
    this.next = undefined;
    this.staged = true;
  }

  restartRequired(): boolean {
    return this.staged;
  }

  pendingIdentity(): UwhIdentity | undefined {
    return this.staged ? this.next?.identity : undefined;
  }
}
