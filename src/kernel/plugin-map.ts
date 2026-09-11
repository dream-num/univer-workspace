/**
 * Value stored under a plugin-map key: a Cordis plugin function or `{ apply }`.
 */
export type CordisPluginModule = unknown;

/**
 * In-memory name → module table for this isolate.
 */
export const pluginMap: Record<string, CordisPluginModule> = Object.create(null);

/**
 * Record a plugin so {@link resolvePlugin} can find it at boot.
 *
 * @param name Plugin-map key (`plugin_tree.name`).
 * @param plugin Cordis plugin export (function or `{ name, apply }`).
 */
export function registerPlugin(name: string, plugin: CordisPluginModule): void {
  pluginMap[name] = plugin;
}

/**
 * Whether `name` is a registered plugin-map key.
 */
export function hasPlugin(name: string): boolean {
  return (
    typeof name === "string" &&
    Object.prototype.hasOwnProperty.call(pluginMap, name)
  );
}

/**
 * Look up a previously registered plugin without throwing if missing.
 */
export function getPlugin(name: string): CordisPluginModule | undefined {
  if (!hasPlugin(name)) {
    return undefined;
  }
  return pluginMap[name];
}

/**
 * Remove a plugin from the in-memory map.
 */
export function deletePlugin(name: string): boolean {
  if (!hasPlugin(name)) return false;
  delete pluginMap[name];
  return true;
}

/**
 * Look up a previously registered plugin.
 */
export function resolvePlugin(name: string): CordisPluginModule {
  const plugin = getPlugin(name);
  if (plugin === undefined && !hasPlugin(name)) {
    throw new Error(`plugin tree failed to load: unknown plugin ${name}`);
  }
  return plugin;
}
