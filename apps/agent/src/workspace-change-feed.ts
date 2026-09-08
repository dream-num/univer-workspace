import type { WorkspaceHttpClient } from "./workspace-auth.ts";

/** One remote subscription per account, shared by every local browser tab. */
export function subscribeWorkspaceChanges(
  client: WorkspaceHttpClient,
  changed: () => void,
): () => void {
  const lifetime = new AbortController();
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  const reconnect = () => {
    if (lifetime.signal.aborted || retry !== undefined) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5));
    retry = setTimeout(() => {
      retry = undefined;
      void connect();
    }, delay);
    retry.unref?.();
  };
  async function connect(): Promise<void> {
    try {
      const response = await client.request("/universer-api/user/session-ticket", {
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw new Error("Workspace event authorization unavailable");
      const body = (await response.json()) as { ticket?: unknown };
      if (typeof body.ticket !== "string" || !body.ticket)
        throw new Error("Invalid Workspace event ticket");
      if (lifetime.signal.aborted) return;
      const url = new URL("/api/worktree-events", client.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("sessionTicket", body.ticket);
      const current = new WebSocket(url);
      socket = current;
      current.addEventListener("message", (event) => {
        if (lifetime.signal.aborted || socket !== current) return;
        try {
          const message = JSON.parse(String(event.data)) as { event?: unknown };
          if (message.event !== "worktreeChangeFeedReady" && message.event !== "worktreesChanged")
            return;
          attempt = 0;
          // Ready invalidates too: changes may have occurred while disconnected.
          changed();
        } catch {
          /* Ignore unknown upstream frames. */
        }
      });
      current.addEventListener("close", reconnect);
      current.addEventListener("error", () => current.close());
    } catch {
      reconnect();
    }
  }
  void connect();
  return () => {
    lifetime.abort();
    if (retry !== undefined) clearTimeout(retry);
    socket?.close();
  };
}
