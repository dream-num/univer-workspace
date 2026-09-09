import { describe, expect, it, vi } from "vitest";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import { readSessionEvents } from "../src/session-history.ts";

describe("durable history handle ownership", () => {
  it.each([false, true])("closes a read handle even when reading fails (%s)", async (fail) => {
    const failure = new Error("Read failed");
    const close = vi.fn(async () => {});
    const open = vi.fn(async () => ({
      read: async () => { if (fail) throw failure; return { events: [] }; },
      close,
    }));
    const persistence = { open } as unknown as SessionPersistence;
    const result = readSessionEvents(persistence, "session-test" as SessionId);
    if (fail) await expect(result).rejects.toBe(failure);
    else await expect(result).resolves.toEqual([]);
    expect(open).toHaveBeenCalledWith("session-test", "read");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
