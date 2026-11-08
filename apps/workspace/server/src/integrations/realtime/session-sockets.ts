import type { NodeTransportConnection } from "@univerjs-pro/collaboration-transport-node";

export interface SessionSockets {
  track(sessionId: string, expiresAt: number, connection: NodeTransportConnection): () => void;
  closeSessions(sessionIds: readonly string[]): void;
}

export function createSessionSockets(isSessionActive: (sessionId: string) => boolean): SessionSockets {
  const sessions = new Map<string, Set<() => void>>();

  return {
    track(sessionId, expiresAt, connection) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const untrack = () => {
        clearTimeout(timer);
        const connections = sessions.get(sessionId);
        connections?.delete(close);
        if (connections?.size === 0) sessions.delete(sessionId);
      };
      const close = () => {
        untrack();
        connection.close(1008, "Workspace session ended");
      };
      const schedule = () => {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          close();
          return;
        }
        // Node timers clamp delays above a signed 32-bit integer to 1 ms.
        timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
        timer.unref();
      };
      if (expiresAt <= Date.now() || !isSessionActive(sessionId)) {
        close();
        return untrack;
      }
      const connections = sessions.get(sessionId) ?? new Set();
      connections.add(close);
      sessions.set(sessionId, connections);
      schedule();
      return untrack;
    },
    closeSessions(sessionIds) {
      for (const id of sessionIds) {
        for (const close of sessions.get(id) ?? []) close();
      }
    },
  };
}
