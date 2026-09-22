import type { Context } from "@deepseek-ai/cordis";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";

export const inject = ["connection"];

/** Follow the instance-wide account through DSH's public connection lifecycle. */
export function apply(ctx: Context): void {
  const pageVersion = (globalThis as { __UWH_CONNECTION_VERSION__?: string }).__UWH_CONNECTION_VERSION__;
  ctx.effect(() => {
    const connection = ctx.get("connection") as unknown as ConnectionHandle;
    const lifetime = new AbortController();
    let checking: Promise<void> | undefined;
    let checkAgain = false;
    let refreshing = false;
    const reload = () => {
      if (lifetime.signal.aborted || refreshing) return;
      refreshing = true;
      window.location.replace("/");
    };
    const check = () => {
      if (refreshing || lifetime.signal.aborted) return;
      if (checking) { checkAgain = true; return; }
      checking = (async () => {
        const deadline = Date.now() + 45_000;
        while (!lifetime.signal.aborted && Date.now() < deadline) {
          try {
            const response = await fetch("/auth/connection/status", {
              cache: "no-store",
              signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(3000)]),
            });
            if (lifetime.signal.aborted) return;
            if (response.status === 401) { reload(); return; }
            if (response.ok) {
              const state = await response.json() as { ready?: boolean; version?: string };
              if (state.ready) {
                if (typeof state.version === "string" && pageVersion !== undefined && state.version !== pageVersion) reload();
                return;
              }
            } else if (response.status < 500) {
              return;
            }
          } catch {
            if (lifetime.signal.aborted) return;
          }
          // The final DSH connection notification may precede HTTP recovery.
          // Retry transient failures within this window; DSH still owns reconnection.
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      })().finally(() => {
        checking = undefined;
        if (checkAgain) { checkAgain = false; check(); }
      });
    };
    const unsubscribe = connection.state.subscribe(check);
    window.addEventListener("pageshow", check);
    check();
    return () => {
      lifetime.abort();
      unsubscribe();
      window.removeEventListener("pageshow", check);
    };
  });
}
