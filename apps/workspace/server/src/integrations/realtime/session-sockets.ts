import type { SessionTicketRecord } from "@univerjs-pro/collaboration-endpoint";
import type { NodeTransportConnection } from "@univerjs-pro/collaboration-transport-node";
import { ANONYMOUS_USER_ID } from "../../modules/identity/anonymous-user.js";

export interface SessionSockets {
  track(ticket: SessionTicketRecord, connection: NodeTransportConnection): Promise<boolean>;
  isActive(connection: NodeTransportConnection): boolean;
  untrack(connection: NodeTransportConnection): void;
  closeSessions(sessionIds: readonly string[]): void;
  closeUser(userId: string): void;
}

interface Registration {
  ready: boolean;
  expiresAt: number;
  release?: () => void;
}

export function createSessionSockets(isSessionActive: (sessionId: string, userId: string) => Promise<boolean>): SessionSockets {
  const sessions = new Map<string, Set<() => void>>();
  const users = new Map<string, Set<() => void>>();
  // A closed connection can still have an SDK open callback or a database lookup in flight.
  const registrations = new WeakMap<NodeTransportConnection, Registration | null>();

  function untrack(connection: NodeTransportConnection): void {
    registrations.get(connection)?.release?.();
    registrations.set(connection, null);
  }

  return {
    async track(ticket, connection) {
      if (registrations.has(connection)) return false;
      const state: Registration = { ready: false, expiresAt: Infinity };
      registrations.set(connection, state);
      const close = () => {
        if (registrations.get(connection) !== state) return;
        untrack(connection);
        connection.close(1008, "Workspace session ended");
      };
      if (ticket.userID === ANONYMOUS_USER_ID) {
        state.ready = true;
        return true;
      }

      const { sessionId, sessionExpiresAt } = ticket.customData;
      if (typeof sessionId !== "string" || typeof sessionExpiresAt !== "number" ||
        !Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= Date.now()) {
        close();
        return false;
      }

      let timer: ReturnType<typeof setTimeout>;
      state.expiresAt = sessionExpiresAt;
      const leaveSession = enroll(sessions, sessionId, close);
      const leaveUser = enroll(users, ticket.userID, close);
      state.release = () => {
        clearTimeout(timer);
        leaveSession();
        leaveUser();
      };
      const schedule = () => {
        const remaining = sessionExpiresAt - Date.now();
        if (remaining <= 0) {
          close();
          return;
        }
        // Node timers clamp delays above a signed 32-bit integer to 1 ms.
        timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
        timer.unref();
      };
      schedule();

      // Register before the lookup so an intervening logout wins even over a stale successful read.
      try {
        if (!await isSessionActive(sessionId, ticket.userID) || state.expiresAt <= Date.now()) {
          close();
          return false;
        }
      } catch {
        close();
        return false;
      }
      if (registrations.get(connection) !== state) return false;
      state.ready = true;
      return true;
    },
    isActive(connection) {
      const state = registrations.get(connection);
      return state?.ready === true && state.expiresAt > Date.now();
    },
    untrack,
    closeSessions(sessionIds) {
      for (const id of sessionIds) {
        for (const close of sessions.get(id) ?? []) close();
      }
    },
    closeUser(userId) {
      for (const close of users.get(userId) ?? []) close();
    },
  };
}

function enroll(index: Map<string, Set<() => void>>, key: string, close: () => void): () => void {
  const closers = index.get(key) ?? new Set();
  closers.add(close);
  index.set(key, closers);
  return () => {
    closers.delete(close);
    if (closers.size === 0) index.delete(key);
  };
}
