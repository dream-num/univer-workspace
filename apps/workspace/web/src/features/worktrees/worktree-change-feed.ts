import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { worktreesQueryKey } from "./worktrees.queries";

const RECONNECT_DELAY_MS = 1_000;

type WorktreeChangeFeedMessage =
  | { readonly event: "worktreeChangeFeedReady" }
  | { readonly event: "worktreesChanged" };

export function useWorktreeChangeFeed(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, RECONNECT_DELAY_MS);
    };

    const connect = async () => {
      try {
        const response = await fetch(
          "/universer-api/user/session-ticket",
          { credentials: "include" }
        );
        const body = (await response.json()) as { readonly ticket?: unknown };
        if (!response.ok || typeof body.ticket !== "string") {
          scheduleReconnect();
          return;
        }
        if (disposed) return;
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(
          `${protocol}//${window.location.host}/api/worktree-events?sessionTicket=${encodeURIComponent(body.ticket)}`
        );
        socket.addEventListener("message", (event) => {
          const message = parseWorktreeChangeFeedMessage(event.data);
          if (!message) return;
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: worktreesQueryKey }),
            queryClient.invalidateQueries({ queryKey: ["nodes"] }),
            queryClient.invalidateQueries({ queryKey: ["recent-resources"] }),
            queryClient.invalidateQueries({ queryKey: ["owned-by-me"] }),
            queryClient.invalidateQueries({ queryKey: ["shared-with-me"] }),
          ]);
        });
        socket.addEventListener("close", scheduleReconnect);
        socket.addEventListener("error", () => socket?.close());
      } catch {
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "Worktree change feed disposed");
    };
  }, [enabled, queryClient]);
}

export function parseWorktreeChangeFeedMessage(
  value: unknown
): WorktreeChangeFeedMessage | null {
  try {
    const parsed =
      typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const event = (parsed as { readonly event?: unknown }).event;
    return event === "worktreeChangeFeedReady" || event === "worktreesChanged"
      ? { event }
      : null;
  } catch {
    return null;
  }
}
