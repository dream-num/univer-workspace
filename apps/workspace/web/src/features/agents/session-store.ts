import type { UIMessage } from "ai";
import type { AgentSession, AgentSessionId } from "./agent.types";
import { sessionLockName, sessionRecordSchema, transition } from "./agent.types";
import type { AgentDatabaseOptions } from "./database";
import { openAgentDatabase } from "./database";

export interface SessionStore {
  list(): Promise<AgentSession[]>;
  get(id: AgentSessionId): Promise<AgentSession | null>;
  save(session: AgentSession): Promise<void>;
  publish(session: AgentSession): void;
  subscribe(listener: (session: AgentSession) => void): () => void;
}

export function createSessionStore(options: AgentDatabaseOptions & { locks: LockManager }): SessionStore {
  const database = openAgentDatabase(options);
  const memory = new Map<AgentSessionId, AgentSession>();
  const listeners = new Set<(session: AgentSession) => void>();
  function publish(session: AgentSession) {
    if (session.userId !== options.userId) throw new Error("Agent session belongs to another user");
    const snapshot = structuredClone(session);
    memory.set(session.id, snapshot);
    for (const listener of listeners) listener(structuredClone(snapshot));
    return snapshot;
  }
  async function save(session: AgentSession) {
    const snapshot = structuredClone(session);
    const published = publish(snapshot);
    try {
      await database.request("sessions", "readwrite", (store) => store.put(snapshot));
    } finally {
      if (memory.get(session.id) === published) memory.delete(session.id);
    }
  }
  function decode(value: unknown): AgentSession | null {
    if (value === undefined) return null;
    const record = sessionRecordSchema.parse(value);
    if (record.userId !== options.userId) throw new Error("Agent session belongs to another user");
    // Preserve SDK parts verbatim; the runtime validates the complete SDK contract before sending.
    const cached = memory.get(record.id);
    const session: AgentSession = cached && cached.updatedAt >= record.updatedAt
      ? cached : { ...record, messages: record.messages as UIMessage[] };
    return session;
  }
  async function read(value: unknown): Promise<AgentSession | null> {
    const session = decode(value);
    if (!session) return null;
    if (session.status === "running") {
      const locks = await options.locks.query();
      if (!locks.held?.some((lock) => lock.name === sessionLockName(session.id))) {
        return options.locks.request(sessionLockName(session.id), { ifAvailable: true }, async (lock) => {
          if (!lock) return structuredClone(session);
          const stored = await database.request("sessions", "readonly", (store) => store.get(session.id));
          const latest = decode(stored ?? memory.get(session.id));
          if (!latest || latest.status !== "running") return latest && structuredClone(latest);
          const interrupted = { ...latest, status: transition(latest.status, "interrupt") };
          await save(interrupted);
          return interrupted;
        });
      }
    }
    return structuredClone(session);
  }
  return {
    save, publish,
    async get(id) {
      const stored = await database.request("sessions", "readonly", (store) => store.get(id));
      return read(stored ?? memory.get(id));
    },
    async list() {
      const values = await database.request("sessions", "readonly", (store) => store.getAll());
      if (!Array.isArray(values)) throw new Error("Invalid agent sessions");
      const records = values.map((value) => sessionRecordSchema.parse(value));
      const storedIds = new Set(records.map((record) => record.id));
      const sessions = await Promise.all([...records, ...[...memory.values()].filter((session) => !storedIds.has(session.id))].map(read));
      return sessions.filter((session) => session !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
