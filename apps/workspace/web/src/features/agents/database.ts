export interface AgentDatabaseOptions {
  userId: string;
  indexedDB: IDBFactory;
}

export function openAgentDatabase({ userId, indexedDB: factory }: AgentDatabaseOptions) {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(`univer-workspace-agents-${userId}`, 1);
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of [["sessions", "id"], ["providers", "id"], ["keys", "providerId"]] as const) {
        request.result.createObjectStore(name, { keyPath });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Agent database upgrade blocked by another tab"));
  });
  return {
    async request(store: "sessions" | "providers" | "keys", mode: IDBTransactionMode,
      action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
      const db = await database;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = action(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error ?? request.error);
        transaction.onerror = () => reject(transaction.error ?? request.error);
      });
    },
    async close() { (await database).close(); },
  };
}
