/**
 * Plugin catalog: seed definitions, loaders, and host-config resolution.
 */
import type { SqlExec } from "./sql.ts";
import type { PluginTreeRow } from "./types.ts";

export interface HostConfigContext {
  sql?: SqlExec;
  env?: Record<string, unknown>;
  host?: unknown;
}

export type PluginCategory =
  | "core"
  | "storage"
  | "tools"
  | "collab"
  | "ui"
  | "workspace";

export interface PluginDefinition<TConfig = Record<string, unknown>> {
  id: string;
  name: string;
  description?: string;
  category?: PluginCategory;
  isSeed?: boolean;
  defaultConfig?: Partial<TConfig>;
  resolveConfig?: (context: HostConfigContext) => TConfig | Promise<TConfig>;
  load: () => Promise<unknown>;
}

export function isCordisPlugin(value: unknown): boolean {
  if (typeof value === "function") return true;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { apply?: unknown }).apply === "function"
  );
}

/**
 * Normalizes a dynamic module import into a Cordis plugin.
 */
export function normalizeCordisPlugin(name: string, mod: unknown): unknown {
  if (isCordisPlugin(mod)) return mod;
  if (typeof mod === "object" && mod !== null) {
    const obj = mod as Record<string, unknown>;
    if (isCordisPlugin(obj.default)) return obj.default;
    if (typeof obj.apply === "function") return obj;
  }
  throw new Error(`Module ${name} does not export a valid Cordis plugin`);
}

/**
 * Built-in Plugin Catalog for Univer Workspace Edge Microkernel.
 */
export const PLUGIN_CATALOG: PluginDefinition[] = [
  {
    id: "action-engine",
    name: "action-engine",
    description: "Cordis Universal Action Engine for dual RPC and LLM tools with reversible inverses",
    category: "core",
    isSeed: true,
    defaultConfig: {},
    load: async () => import("./action.ts")
  },
  {
    id: "univer-collab",
    name: "univer-collab",
    description: "Pure edge Univer collaboration and snapshot manager",
    category: "collab",
    isSeed: true,
    defaultConfig: {},
    load: async () => import("../plugins/univer-collab.ts")
  },
  {
    id: "univer-tools",
    name: "univer-tools",
    description: "Universal Actions for spreadsheet manipulation and agent tools",
    category: "tools",
    isSeed: true,
    defaultConfig: {},
    load: async () => import("../plugins/univer-tools.ts")
  }
];

export function findCatalogPlugin(name: string): PluginDefinition | undefined {
  return PLUGIN_CATALOG.find((entry) => entry.name === name || entry.id === name);
}

export function getSeedTreeRows(): PluginTreeRow[] {
  return PLUGIN_CATALOG.filter((p) => p.isSeed).map((p, idx) => ({
    id: p.id,
    name: p.name,
    disabled: 0,
    config: (p.defaultConfig ?? {}) as Record<string, unknown>,
    grouping: p.category ?? "core"
  }));
}
