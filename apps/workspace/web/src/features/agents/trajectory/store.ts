import { z } from "zod";
import type { AgentSessionId } from "../agent.types";
import type { AgentDatabaseOptions } from "../database";
import { openIndexedDatabase } from "../database";
import { modelCallRecordSchema } from "./record";
import type { ModelCallRecord } from "./record";

export function createTrajectoryStore({ userId, indexedDB, locks }: AgentDatabaseOptions) {
  const database = openIndexedDatabase(indexedDB, locks, `univer-workspace-agent-trajectory-${userId}`, { modelCalls: ["sessionId", "seq"] });
  return {
    async put(record: ModelCallRecord) { await database.request("modelCalls", "readwrite", (store) => store.put(record)); },
    async list(sessionId: AgentSessionId) {
      const rows = z.array(z.unknown()).parse(await database.request("modelCalls", "readonly", (store) =>
        store.getAll(IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]))));
      const records: ModelCallRecord[] = [];
      let skippedRecords = 0;
      for (const row of rows) {
        const parsed = modelCallRecordSchema.safeParse(row);
        if (parsed.success) records.push(parsed.data); else skippedRecords++;
      }
      return { records, skippedRecords };
    },
  };
}
export type TrajectoryStore = ReturnType<typeof createTrajectoryStore>;
