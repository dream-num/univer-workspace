import { z } from "zod";
import type { AgentMode } from "./agent.types";

export interface McpTokenSource {
  token(): Promise<string>;
  invalidate(): void;
  dispose(): Promise<void>;
}
const issuedSchema = z.object({ token: z.string().startsWith("uvw_at_"), expiresAt: z.number().int() });
export function createMcpTokenSource({ mode, fetch: request, now = Date.now }: {
  mode: AgentMode; fetch: typeof fetch; now?: () => number;
}): McpTokenSource {
  let current: { token: string; expiresAt: number } | null = null;
  let pending: Promise<void> | null = null;
  let disposed = false;
  let generation = 0;
  async function issue(): Promise<void> {
    const version = generation;
    const response = await request("/api/auth/agent-token", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopes: mode === "ask" ? ["read"] : ["read", "write"] }),
    });
    if (!response.ok) throw new Error(`Could not obtain agent token (HTTP ${response.status})`);
    const issued = issuedSchema.parse(await response.json());
    if (disposed) throw new Error("Agent token source is disposed");
    if (version === generation) current = issued;
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
    // Agent tokens live in memory only and expire on their own after an hour.
    async dispose() {
      disposed = true;
      current = null;
      await pending?.catch(() => undefined);
    },
  };
}
