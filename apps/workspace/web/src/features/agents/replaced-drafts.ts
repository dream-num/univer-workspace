import type { UIMessage } from "ai";
import { z } from "zod";

const outputSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.object({ draft: z.object({ id: z.string().min(1) }) }),
});
const createInput = z.object({ space: z.string().min(1), name: z.string().min(1) });
const saveReplaceInput = z.object({ page: z.string().min(1) });
const replaceInput = z.object({ resource: z.string().min(1) });

export function replacedDraftIds(messages: readonly UIMessage[]): Set<string> {
  const latest = new Map<string, string>();
  const replaced = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!("toolCallId" in part) || part.state !== "output-available") continue;
      const tool = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
      let target: string;
      if (tool === "html_view_create" || (tool === "html_view_save" && createInput.safeParse(part.input).success)) {
        const input = createInput.safeParse(part.input);
        if (!input.success) continue;
        target = JSON.stringify(["create", input.data.space, input.data.name.replace(/\.univer\.html$/i, "")]);
      } else if (tool === "html_view_replace" || tool === "html_view_save") {
        const input = (tool === "html_view_save" ? saveReplaceInput.transform(({ page }) => ({ resource: page })) : replaceInput).safeParse(part.input);
        if (!input.success) continue;
        target = JSON.stringify(["replace", input.data.resource]);
      } else continue;
      const output = outputSchema.safeParse(part.output);
      if (!output.success || output.data.isError) continue;
      const id = output.data.structuredContent.draft.id;
      const previous = latest.get(target);
      if (previous && previous !== id) replaced.add(previous);
      replaced.delete(id);
      latest.set(target, id);
    }
  }
  return replaced;
}
