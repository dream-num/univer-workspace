import { isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";
import type { components } from "../../../../../generated/http/schema";
import { SYSTEM_REMINDER_START } from "../agent.types";
import { replacedDraftIds } from "../replaced-drafts";

type Draft = components["schemas"]["HtmlViewDraft"];
export type DraftStatus = Pick<Draft, "state" | "name" | "published">;
const draftStateSchema = z.enum(["pending", "published", "rejected", "expired", "conflicted"]);
const metadataSchema = z.object({ agentDraftStates: z.record(z.string(), draftStateSchema) });
const outputSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.object({ draft: z.object({ id: z.string().min(1), state: draftStateSchema }) }),
});

export async function draftReminder(messages: readonly UIMessage[], getDraft: (id: string) => Promise<DraftStatus | null>, origin: string) {
  const known = new Map<string, Draft["state"]>();
  for (const message of messages) {
    if (message.role === "user") {
      const metadata = metadataSchema.safeParse(message.metadata);
      if (metadata.success) for (const [id, state] of Object.entries(metadata.data.agentDraftStates)) known.set(id, state);
    }
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!isToolUIPart(part) || part.state !== "output-available") continue;
      const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
      if (name !== "html_view_create" && name !== "html_view_replace") continue;
      const output = outputSchema.safeParse(part.output);
      if (output.success && !output.data.isError) known.set(output.data.structuredContent.draft.id, output.data.structuredContent.draft.state);
    }
  }
  const replaced = replacedDraftIds(messages);
  const updates = await Promise.all([...known].filter(([id, state]) => state === "pending" && !replaced.has(id)).map(async ([id]) => {
    try {
      const draft = await getDraft(id);
      if (!draft || draft.state === "pending") return null;
      const label = `Draft ${JSON.stringify(id)} ${JSON.stringify(draft.name)}`.replaceAll("<", "\\u003c");
      let line: string;
      switch (draft.state) {
        case "published":
          if (!draft.published) return null;
          line = `${label}: published. The user published it, so the page is live at ${origin}/nodes/${encodeURIComponent(draft.published.nodeId)}?view=immersive. The user accepted this version; change it only if they ask.`;
          break;
        case "rejected": line = `${label}: rejected. Ask the user what to change.`; break;
        case "expired": line = `${label}: expired. It was not published; draft again only if the user asks.`; break;
        case "conflicted": line = `${label}: conflicted. It was not published because the page changed; read the page and draft again only if the user asks.`; break;
      }
      return { id, state: draft.state, line };
    } catch { return null; }
  }));
  const changed = updates.filter((update) => update !== null);
  return {
    states: Object.fromEntries(changed.map(({ id, state }) => [id, state])),
    part: changed.length ? { type: "text" as const, text: [`\n\n${SYSTEM_REMINDER_START}`, ...changed.map(({ line }) => line), "</system-reminder>"].join("\n") } : null,
  };
}
