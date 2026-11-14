export interface AgentDatabaseOptions {
  userId: string;
  indexedDB: IDBFactory;
  locks: LockManager;
}

export function openAgentDatabase({ userId, indexedDB: factory, locks }: AgentDatabaseOptions) {
  return openIndexedDatabase(factory, locks, `univer-workspace-agents-${userId}`, {
    sessions: "id", providers: "id", keys: "providerId",
  });
}

export function openIndexedDatabase<const Stores extends Record<string, string | string[]>>(
  factory: IDBFactory, locks: LockManager, name: string, stores: Stores,
) {
  // Prevent pending opens from being stranded in a frozen document.
  const database = locks.request(name, () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(stores)) {
        request.result.createObjectStore(name, { keyPath });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Agent database upgrade blocked by another tab"));
  }));
  return {
    async request(store: Extract<keyof Stores, string>, mode: IDBTransactionMode,
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
