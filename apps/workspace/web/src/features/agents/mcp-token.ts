import { z } from "zod";
import type { AgentMode } from "./agent.types";

export interface McpTokenSource {
  token(): Promise<string>;
  invalidate(): void;
  dispose(): Promise<void>;
}
const issuedSchema = z.object({ token: z.string().min(1), record: z.object({ id: z.string().min(1) }) });
export function createMcpTokenSource({ mode, fetch: request, now = Date.now }: {
  mode: AgentMode; fetch: typeof fetch; now?: () => number;
}): McpTokenSource {
  let current: { token: string; expiresAt: number } | null = null;
  let pending: Promise<void> | null = null;
  let disposed = false;
  let generation = 0;
  const ids = new Set<string>();
  async function issue(): Promise<void> {
    const version = generation;
    const expiresAt = now() + 60 * 60 * 1000;
    const response = await request("/api/auth/tokens", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Workspace Agents", scopes: mode === "ask" ? ["read"] : ["read", "write"], expiresAt }),
    });
    if (!response.ok) throw new Error(`Could not obtain agent token (HTTP ${response.status})`);
    const issued = issuedSchema.parse(await response.json());
    ids.add(issued.record.id);
    if (disposed) throw new Error("Agent token source is disposed");
    if (version === generation) current = { token: issued.token, expiresAt };
  }
  async function token(): Promise<string> {
    if (disposed) throw new Error("Agent token source is disposed");
    if (current && now() < current.expiresAt - 60_000) return current.token;
    if (!pending) pending = issue().finally(() => { pending = null; });
    await pending;
    return token();
  }
  return {
    token,
    invalidate() { generation++; current = null; },
    async dispose() {
      disposed = true;
      current = null;
      await pending?.catch(() => undefined);
      const results = await Promise.allSettled([...ids].map(async (id) => {
        const response = await request(`/api/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
        if (!response.ok && response.status !== 404) throw new Error(`Could not revoke agent token (HTTP ${response.status})`);
        ids.delete(id);
      }));
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    },
  };
}
