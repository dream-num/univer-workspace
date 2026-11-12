import { isToolUIPart } from "ai";
import type { ToolSet, UIMessage } from "ai";
import { z } from "zod";

export function repairInterruptedTools(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => message.role !== "assistant" ? message : {
    ...message,
    parts: message.parts.map((part) => {
      if (!isToolUIPart(part) || part.state === "output-available" || part.state === "output-error" || part.state === "output-denied") return part;
      const { approval: _approval, ...rest } = part;
      return { ...rest, input: part.input, state: "output-error" as const, errorText: "The run was interrupted before this tool returned a result. The tool may or may not have taken effect; check the current state before retrying it." };
    }),
  });
}

const createdPullRequestSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.object({ id: z.string().min(1) }),
});
export const worktreeExtractors = new Map<string, (output: unknown) => string | null>([
  ["pr_create", (output) => {
    const parsed = createdPullRequestSchema.safeParse(output);
    return parsed.success && !parsed.data.isError ? parsed.data.structuredContent.id : null;
  }],
]);

export function redactMessages(messages: UIMessage[], key: string): UIMessage[] {
  if (!key) return structuredClone(messages);
  // String replacement preserves SDK part shapes, including arbitrary tool results and metadata.
  const escaped = JSON.stringify(key).slice(1, -1);
  return JSON.parse(JSON.stringify(messages).replaceAll(escaped, "[redacted]")) as UIMessage[];
}

// The gateway keeps tool data in structuredContent and only a summary in content, while @ai-sdk/mcp shows the model content alone.
export function withStructuredContent(tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
    const original = tool.toModelOutput;
    if (!original) return [name, tool];
    return [name, {
      ...tool,
      async toModelOutput(options: Parameters<typeof original>[0]) {
        const base = await original(options);
        const output: unknown = options.output;
        if (base.type !== "content" || typeof output !== "object" || output === null || !("structuredContent" in output) ||
          output.structuredContent == null) return base;
        return { ...base, value: [...base.value, { type: "text" as const, text: JSON.stringify(output.structuredContent) }] };
      },
    }];
  }));
}
