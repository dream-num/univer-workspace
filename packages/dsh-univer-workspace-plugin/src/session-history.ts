import type { SessionEvent, SessionId } from "@deepseek-ai/dsh-session";
import type { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";

/** Read durable history without claiming write ownership, and always release its handle. */
export async function readSessionEvents(
  persistence: SessionPersistence,
  id: SessionId,
): Promise<readonly SessionEvent[]> {
  const handle = await persistence.open(id, "read");
  try {
    return (await handle.read()).events;
  } finally {
    await handle.close();
  }
}
