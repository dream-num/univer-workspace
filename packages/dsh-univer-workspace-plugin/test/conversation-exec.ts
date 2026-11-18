import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";

export function conversation(cwd: string, ...createdWorktreeIds: string[]) {
  const events: unknown[] = [];
  const exec = { agent: { session: { header: { cwd }, ownEvents: () => events } } } as unknown as ToolRunContext;
  let next = 0;
  function record(name: string, args: Record<string, unknown>, content: unknown, isError: boolean) {
    const callId = `call-${next++}`;
    events.push({ type: "tool/call", data: { turn: 1, step: next, callId, name, arguments: JSON.stringify(args) } });
    events.push({
      type: "tool/result",
      data: { turn: 1, step: next, message: { role: "user", content: [{ type: "tool_result", toolCallId: callId, content, isError }] } },
    });
  }
  for (const id of createdWorktreeIds) {
    record("univer_worktree", { action: "create" }, [{ type: "text", text: JSON.stringify({ id, state: "draft" }) }], false);
  }
  return {
    exec,
    events,
    async call(tool: ToolDefinition, args: Record<string, unknown>) {
      try {
        const value = await tool.execute(args, exec);
        const render = (tool.output as { render?: (args: unknown, value: unknown) => unknown } | undefined)?.render;
        record(tool.name, args, render?.(args, value) ?? [{ type: "text", text: JSON.stringify(value) }], false);
        return value;
      } catch (error) {
        record(tool.name, args, [{ type: "text", text: `Error: ${String(error)}` }], true);
        throw error;
      }
    },
  };
}
