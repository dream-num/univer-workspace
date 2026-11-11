import { useQuery } from "@tanstack/react-query";
import { sessionQueryOptions } from "../../auth/auth.queries";
import { loadAgentRuntime } from "../index";
import { createSessionStore, createProviders, createMcpTokenSource } from "../stores";



function createClient(userId: string) {
  const fetch = window.fetch.bind(window);
  const sessions = createSessionStore({ userId, indexedDB, locks: navigator.locks });
  const providers = createProviders({ userId, indexedDB, storage: sessionStorage, fetch, workspaceOrigin: location.origin });
  let runtime: ReturnType<typeof loadAgentRuntime> | undefined;
  let runner: Promise<ReturnType<Awaited<ReturnType<typeof loadAgentRuntime>>["createAgentRunner"]>> | undefined;
  const running = new Set<string>();
  const marker = "◉ ";
  const markTitle = () => {
    if (running.size && !document.title.startsWith(marker)) document.title = marker + document.title;
    if (!running.size && document.title.startsWith(marker)) document.title = document.title.slice(marker.length);
  };
  const observer = new MutationObserver(markTitle);
  const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
  sessions.subscribe((session) => {
    if (session.status === "running") running.add(session.id); else running.delete(session.id);
    if (running.size) {
      observer.observe(document.querySelector("title") ?? document.head, { childList: true, characterData: true, subtree: true });
      window.addEventListener("beforeunload", beforeUnload);
    } else {
      observer.disconnect();
      window.removeEventListener("beforeunload", beforeUnload);
    }
    markTitle();
  });
  return {
    userId, sessions, providers,
    prewarm() { return runtime ??= loadAgentRuntime(); },
    runner() {
      return runner ??= (runtime ??= loadAgentRuntime()).then(({ createAgentRunner }) => createAgentRunner({
        userId, fetch, locks: navigator.locks, sessions, providers,
        mcpUrl: `${location.origin}/mcp`, createTokenSource: (mode) => createMcpTokenSource({ mode, fetch }),
      }));
    },
    async stopAll() {
      if (runner) {
        const instance = await runner;
        await Promise.all((await sessions.list()).filter((session) => instance.isRunningHere(session.id)).map((session) => instance.stop(session.id)));
      }
    },
  };
}
const clients = new Map<string, ReturnType<typeof createClient>>();
export function getAgentClient(userId: string) {
  let client = clients.get(userId);
  if (!client) { client = createClient(userId); clients.set(userId, client); }
  return client;
}
export function useAgentClient() {
  const session = useQuery(sessionQueryOptions);
  if (!session.data?.authenticated) throw new Error("Authentication required");
  return getAgentClient(session.data.user.id);
}

export async function configuredProviders(client: ReturnType<typeof createClient>) {
  const providers = await client.providers.list();
  const available = await Promise.all(providers.map(async (provider) => {
    try { await client.providers.resolve(provider.id); return provider; } catch (cause) {
      if (cause instanceof Error && cause.message === "No API key configured for this provider") return null;
      throw cause;
    }
  }));
  return available.filter((provider) => provider !== null);
}
