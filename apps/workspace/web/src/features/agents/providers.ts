import { z } from "zod";
import type { ProviderConfig, ProviderId, RunnableProvider } from "./agent.types";
import { providerConfigSchema, providerIdSchema } from "./agent.types";
import type { AgentDatabaseOptions } from "./database";
import { openAgentDatabase } from "./database";
import { createProviderKeyStore } from "./provider-keys";

export const deepSeekDefault: ProviderConfig = {
  id: providerIdSchema.parse("deepseek"), kind: "deepseek", label: "DeepSeek",
  baseURL: "https://api.deepseek.com", models: ["deepseek-flash", "deepseek-v4-pro"], defaultModel: "deepseek-flash",
};
export function redactProviderError(error: unknown, key: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return key ? message.replaceAll(key, "[redacted]") : message;
}
export function validateProviderURL(baseURL: string, workspaceOrigin: string): void {
  const url = new URL(baseURL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      url.origin === new URL(workspaceOrigin).origin) {
    throw new Error("Model provider must use an external HTTP(S) URL without credentials, query or fragment");
  }
}
export function createProviders(options: AgentDatabaseOptions & { storage: Storage; fetch: typeof fetch; workspaceOrigin: string }) {
  const database = openAgentDatabase(options);
  const keys = createProviderKeyStore(options);
  async function resolve(id: ProviderId): Promise<RunnableProvider> {
    const value = await database.request("providers", "readonly", (store) => store.get(id));
    const config = value === undefined && id === deepSeekDefault.id ? deepSeekDefault : providerConfigSchema.parse(value);
    validateProviderURL(config.baseURL, options.workspaceOrigin);
    const apiKey = await keys.get(id);
    if (!apiKey) throw new Error("No API key configured for this provider");
    return { ...config, apiKey };
  }
  return {
    async list(): Promise<ProviderConfig[]> {
      const records = z.array(providerConfigSchema).parse(await database.request("providers", "readonly", (store) => store.getAll()));
      return records.some((provider) => provider.id === deepSeekDefault.id) ? records : [deepSeekDefault, ...records];
    },
    async save(config: ProviderConfig) {
      const parsed = providerConfigSchema.parse(config);
      validateProviderURL(parsed.baseURL, options.workspaceOrigin);
      await database.request("providers", "readwrite", (store) => store.put(parsed));
    },
    async remove(id: ProviderId) {
      await keys.clear(id);
      await database.request("providers", "readwrite", (store) => store.delete(id));
    },
    setKey: keys.set, clearKey: keys.clear, clearAllKeys: keys.clearAll, resolve,
    async testConnection(id: ProviderId): Promise<{ ok: boolean; status: number | null; message: string }> {
      let apiKey = "";
      try {
        const provider = await resolve(id);
        apiKey = provider.apiKey;
        const response = await options.fetch(`${provider.baseURL.replace(/\/$/, "")}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` }, credentials: "omit", redirect: "error",
        });
        return { ok: response.ok, status: response.status, message: response.ok ? "Connected" : redactProviderError(await response.text(), apiKey) };
      } catch (error) {
        return { ok: false, status: null, message: redactProviderError(error, apiKey) };
      }
    },
  };
}
export type Providers = ReturnType<typeof createProviders>;
