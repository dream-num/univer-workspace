/**
 * Cordis kernel boot: migrate/seed `plugin_tree`, mount enabled plugins, fail closed.
 */
import { Context } from "@deepseek-ai/cordis";
import { findCatalogPlugin, getSeedTreeRows, normalizeCordisPlugin } from "./catalog.ts";
import { registerPlugin, resolvePlugin, hasPlugin } from "./plugin-map.ts";
import type { SqlExec } from "./sql.ts";
import {
  assertPluginTreeIdentity,
  listEnabledPluginTree,
  migratePluginTree,
  seedPluginTree
} from "./tree.ts";

const FiberState = {
  PENDING: 0,
  LOADING: 1,
  ACTIVE: 2,
  FAILED: 3,
  DISPOSED: 4,
  UNLOADING: 5
} as const;

export class KernelBootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KernelBootError";
  }
}

export type BootInput = {
  sql: SqlExec;
  host: object;
  env: object;
  configFor?: (row: { id: string; name: string; config: unknown }) => unknown;
};

function fiberInactiveKind(state: number): string {
  if (state === FiberState.PENDING || state === FiberState.LOADING) return "waiting";
  if (state === FiberState.FAILED) return "failed";
  if (state === FiberState.DISPOSED) return "disposed";
  if (state === FiberState.UNLOADING) return "unloading";
  return `inactive (state=${state})`;
}

/**
 * Assert every registered plugin fiber is ACTIVE.
 */
export function assertAllFibersActive(ctx: Context): void {
  const pending: string[] = [];
  for (const runtime of ctx.registry.values()) {
    const rAny = runtime as {
      dshPluginId?: string;
      dshPluginName?: string;
      name?: string;
    };
    const pluginLabel =
      rAny.dshPluginId ?? rAny.dshPluginName ?? runtime.name ?? "plugin";
    for (const fiber of (runtime as any).fibers ?? []) {
      const fiberId = (fiber as { dshPluginId?: string })?.dshPluginId;
      const label = fiberId ?? pluginLabel;
      const state = fiber.state;
      if (state !== FiberState.ACTIVE) {
        pending.push(`${label} ${fiberInactiveKind(state)}`);
      }
    }
  }
  if (pending.length) {
    throw new KernelBootError(
      `plugin tree failed to load: ${pending.join("; ")}`
    );
  }
}

export async function registerCatalogPlugins(): Promise<void> {
  const seedRows = getSeedTreeRows();
  for (const row of seedRows) {
    if (hasPlugin(row.name)) continue;
    const entry = findCatalogPlugin(row.name);
    if (!entry) continue;
    const mod = await entry.load();
    registerPlugin(row.name, normalizeCordisPlugin(row.name, mod));
  }
}

/**
 * Boot the Cordis microkernel from SQLite plugin_tree.
 */
export async function bootKernel(input: BootInput): Promise<Context> {
  migratePluginTree(input.sql);
  seedPluginTree(input.sql, getSeedTreeRows());
  await registerCatalogPlugins();

  const ctx = new Context();
  ctx.provide("host", input.host);
  ctx.provide("env", input.env);

  try {
    for (const row of listEnabledPluginTree(input.sql)) {
      assertPluginTreeIdentity(row.id);
      assertPluginTreeIdentity(row.name);
      const plugin = resolvePlugin(row.name);
      const cfg = input.configFor ? input.configFor(row) : row.config;
      await ctx.plugin(plugin as any, cfg);
    }
    assertAllFibersActive(ctx);
    return ctx;
  } catch (err) {
    console.error("bootKernel error:", err);
    if (typeof (ctx as any).dispose === "function") {
      await (ctx as any).dispose();
    }
    throw err instanceof KernelBootError ? err : new KernelBootError(String(err));
  }
}
