import { createUniverCollaborationRuntimePool } from "@univer-cli/univer-collaboration-runtime-pool";
import { expect, it } from "vitest";

it("announces runtime destruction before TTL eviction completes", async () => {
  const events: string[] = [];
  let finish!: () => void;
  const evicted = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const pool = createUniverCollaborationRuntimePool({
    cache: { idleTtlMs: 0, maxEntries: 1 },
    entry: new URL("./fixtures/runtime-pool-worker.mjs", import.meta.url),
    onEvent(event) {
      events.push(event.type);
      if (event.type === "evicted") finish();
    },
  });

  const lease = await pool.acquire({ init: {}, key: "key-1" });
  await lease.release();
  await evicted;
  await pool.close();

  expect(events).toContain("destroy-start");
  expect(events.indexOf("destroy-start")).toBeLessThan(events.indexOf("evicted"));
});
