import { z } from "zod";

const skillDraftOutput = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.object({ draft: z.object({ id: z.string().min(1) }) }),
});

export function skillDraftResultId(tool: string, output: unknown) {
  if (tool !== "skill_draft_create" && tool !== "skill_draft_get") return null;
  const parsed = skillDraftOutput.safeParse(output);
  return parsed.success && !parsed.data.isError ? parsed.data.structuredContent.draft.id : null;
}
