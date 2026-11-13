import { WorkspaceSkillDraftFeature } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { skillDraftOutput, skillDraftResult } from "./skill-draft-support.js";

const inputSchema = z.object({ draft: z.string().min(1).describe("Draft ID returned by skill_draft_create.") });

export const skillDraftGetTool: ToolDefinition = {
  name: "skill_draft_get",
  toolset: "core",
  scope: "read",
  title: "Read a Skill draft status",
  description: "Read a Skill draft's state and review. The author must publish on the draft page before the Skill exists. Pending, rejected, expired and conflicted drafts are not published Skills.",
  inputSchema,
  outputSchema: skillDraftOutput,
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { draft: id } = inputSchema.parse(args);
    const feature = new WorkspaceSkillDraftFeature(async () => context.http);
    const draft = skillDraftResult(await feature.get(id), context.identityOrigin, id);
    return { output: { draft }, repo: draft.spaceId };
  },
};
