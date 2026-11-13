import { z } from "zod";
import type { ProviderId } from "./agent.types";
import { providerIdSchema } from "./agent.types";
import type { AgentDatabaseOptions } from "./database";
import { openAgentDatabase } from "./database";

const keySchema = z.object({ providerId: providerIdSchema, key: z.string().min(1) });
export function createProviderKeyStore(options: AgentDatabaseOptions & { storage: Storage }) {
  const database = openAgentDatabase(options);
  const prefix = `univer-workspace-agent-key:${encodeURIComponent(options.userId)}:`;
  return {
    async get(providerId: ProviderId): Promise<string | null> {
      const temporary = options.storage.getItem(prefix + providerId);
      if (temporary !== null) return temporary;
      const record = await database.request("keys", "readonly", (store) => store.get(providerId));
      return record === undefined ? null : keySchema.parse(record).key;
    },
    async set(providerId: ProviderId, key: string, remember = true) {
      keySchema.parse({ providerId, key });
      if (remember) {
        await database.request("keys", "readwrite", (store) => store.put({ providerId, key }));
        options.storage.removeItem(prefix + providerId);
      } else {
        await database.request("keys", "readwrite", (store) => store.delete(providerId));
        options.storage.setItem(prefix + providerId, key);
      }
    },
    async clear(providerId: ProviderId) {
      options.storage.removeItem(prefix + providerId);
      await database.request("keys", "readwrite", (store) => store.delete(providerId));
    },
    async clearAll() {
      for (let index = options.storage.length - 1; index >= 0; index--) {
        const key = options.storage.key(index);
        if (key?.startsWith(prefix)) options.storage.removeItem(key);
      }
      await database.request("keys", "readwrite", (store) => store.clear());
    },
  };
}
