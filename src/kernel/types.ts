/**
 * One row of the durable Cordis plugin tree stored in SQLite `plugin_tree`.
 *
 * `name` is the plugin-map key used at boot (`@deepseek-ai/…` or a local id).
 */
export type PluginTreeRow = {
  /** Stable primary key (seed id such as `univer-collab` or `workspace-harness`). */
  id: string;
  /** Plugin-map lookup key; npm packages start with `@deepseek-ai/` or `@univerjs/`. */
  name: string;
  /**
   * `0` loads on the next `bootKernel`; `1` skips the row until re-enabled.
   * @default 0
   */
  disabled: number;
  /** JSON object passed as the Cordis plugin config. */
  config: Record<string, unknown>;
  /** Optional group label for UI / admin listing; unused by boot. */
  grouping?: string | null;
};

/**
 * Minimal tagged-template SQL callable (`sql\`SELECT …\``).
 */
export type SqlTagged = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

/**
 * Host object provided on the Cordis context as `host` during kernel boot.
 * Durable-object methods (alarms, fibers, SQL) live here rather than in plugins.
 */
export type KernelHost = {
  /** Worker bindings for this isolate. */
  env: unknown;
  /** Durable-object instance name (`id.name`, usually `"default"` or document ID). */
  name: string;
  /** Tagged-template SQL helper. */
  sql?: SqlTagged;
  /** Live Cordis `Context` after a successful boot this wake. */
  kernel?: unknown;
  /** Last boot failure; present when `ensureKernel` refused traffic. */
  kernelError?: Error;
  /** Schedule work that must survive isolate eviction (Durable Object alarm). */
  schedule?: (...args: unknown[]) => unknown;
  /**
   * Hold the isolate awake while `fn` runs.
   */
  keepAliveWhile?: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * Broadcast payload to all connected WebSockets.
   */
  broadcast?: (payload: unknown) => void;
};
