/**
 * Concrete `workspaceAuth` service implementation and its provider plugin.
 *
 * The service opens the credentials domain on its fiber, keeps the settings
 * origin source as the authoritative origin thunk, and issues per-User HTTP
 * clients that attach the stored `workspace_session` cookie.
 * @module @univerjs/univer-workspace-harness/workspace-auth-provider
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import type { Domain } from "@deepseek-ai/dsh-storage-domain";
import z from "@deepseek-ai/schemastery";
import { credentialsDomainSpec } from "./credentials.ts";
import { WORKSPACE_SESSION_COOKIE, WorkspaceAuthService, type WorkspaceHttpClient } from "./workspace-auth.ts";

/** The settings namespace name for the harness origin override. */
export const UWH_SETTINGS_NAMESPACE = settingsNamespace("univer-workspace-harness");

/** Composition entry that the harness core owns. */
export interface WorkspaceAuthConfig {
  /** Default Workspace origin (overridable through settings). */
  workspaceOrigin: string;
}

/** The settings section shape: only the origin is a user-adjustable field. */
export interface WorkspaceAuthSettings {
  workspaceOrigin: string;
}

/** The settings schema for {@link WorkspaceAuthSettings}. */
const settingsSchema = z.object({
  workspaceOrigin: z.string().required(),
});

class WorkspaceAuthServiceImpl extends WorkspaceAuthService {
  private originSource: (() => WorkspaceAuthSettings) | undefined;
  private table: ReturnType<Domain<typeof credentialsDomainSpec>["table"]> | undefined;

  constructor(
    ctx: Context,
    private readonly config: WorkspaceAuthConfig,
  ) {
    super(ctx);
  }

  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(credentialsDomainSpec);
    this.ctx.effect(() => () => { void domain.close(); }, "uwh: credentials domain close");
    this.table = domain.table("credentials");
  }

  setOriginSource(source: () => WorkspaceAuthSettings): void {
    this.originSource = source;
  }

  effectiveOrigin(): string {
    const section = this.originSource?.();
    return section?.workspaceOrigin ?? this.config.workspaceOrigin;
  }

  hasCredential(userId: string): boolean {
    return this.readCredential(userId) !== undefined;
  }

  clientFor(userId: string): WorkspaceHttpClient | undefined {
    const credential = this.readCredential(userId);
    if (credential === undefined) return undefined;
    const origin = this.effectiveOrigin();
    const token = credential.token;
    return {
      origin,
      sessionToken: token,
      request: (path, init) => {
        const headers = new Headers(init?.headers);
        headers.set("cookie", `${WORKSPACE_SESSION_COOKIE}=${token}`);
        const method = init?.method ?? "GET";
        const mutating = method !== "GET" && method !== "HEAD";
        if (mutating && !headers.has("origin")) headers.set("origin", origin);
        return fetch(new URL(path, origin).toString(), { ...init, headers });
      },
    };
  }

  async storeCredential(userId: string, token: string, expiresAtMs: number): Promise<void> {
    await this.requireTable().put(userId, { token, expiresAt: expiresAtMs });
  }

  async clearCredential(userId: string): Promise<void> {
    await this.requireTable().delete(userId);
  }

  private readCredential(userId: string): { readonly token: string } | undefined {
    const record = this.requireTable().get(userId);
    if (record === undefined) return undefined;
    if (record.expiresAt <= Date.now()) {
      void this.clearCredential(userId);
      return undefined;
    }
    return { token: record.token };
  }

  private requireTable(): ReturnType<Domain<typeof credentialsDomainSpec>["table"]> {
    if (this.table === undefined) {
      throw new Error("workspaceAuth credentials domain is not initialized");
    }
    return this.table;
  }
}

export const name = "univer-workspace-harness-auth";

export const inject = ["storageDomain"];

/** Mount the workspaceAuth service and the origin settings namespace. */
export function apply(ctx: Context, config: WorkspaceAuthConfig): void {
  const service = new WorkspaceAuthServiceImpl(ctx, config);
  const settingsEntry: WorkspaceAuthSettings = { workspaceOrigin: config.workspaceOrigin };
  installSettingsSection(ctx, UWH_SETTINGS_NAMESPACE, settingsSchema, settingsEntry, {
    setSource: (current) => service.setOriginSource(current),
    onChange: () => {},
  });
}
