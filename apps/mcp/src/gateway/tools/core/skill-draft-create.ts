import { WorkspaceSkillDraftFeature, WorkspaceSpaceFeature, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { repoInput, resolveRepo } from "./issue-support.js";
import { skillDraftOutput, skillDraftResult, skillReviewFindingSchema } from "./skill-draft-support.js";

const inputSchema = z.strictObject({
  name: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  destination: z.union([z.strictObject({ personal: z.literal(true) }), z.strictObject({ repo: repoInput })]),
  replace: z.boolean().optional(),
  files: z.array(z.strictObject({ path: z.string().min(1).max(1024), text: z.string() })).min(1).max(100),
  keep: z.array(z.string().min(1).max(1024)).optional(),
  review: z.array(skillReviewFindingSchema).max(500),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/).describe(IDEMPOTENCY_KEY_DESCRIPTION),
});

export const skillDraftCreateTool: ToolDefinition = {
  name: "skill_draft_create",
  toolset: "core",
  scope: "write",
  title: "Draft a Skill",
  description: "Save Skill text files as a draft. The author must open draft.previewUrl and publish on the draft page before the Skill exists. Reuse idempotency_key with identical input on retry.",
  inputSchema,
  outputSchema: skillDraftOutput,
  annotations: writeAnnotations,
  async run(context, args) {
    const { destination, idempotency_key, replace, keep, ...input } = inputSchema.parse(args);
    let spaceId: string;
    if ("repo" in destination) spaceId = await resolveRepo(context, destination.repo);
    else {
      const spaces = await new WorkspaceSpaceFeature(async () => context.http).list();
      const personal = spaces.find((space) => space.type === "personal" && space.affiliation === "owner");
      if (!personal) throw workspaceError("workspace-personal-space-missing", "Your Personal Space was not found.");
      spaceId = personal.id;
    }
    const feature = new WorkspaceSkillDraftFeature(async () => context.http);
    const draft = skillDraftResult(await feature.create({ ...input, spaceId,
      ...(replace === undefined ? {} : { replace }), ...(keep === undefined ? {} : { keep }),
    }, idempotency_key), context.identityOrigin);
    return { output: { draft }, repo: draft.spaceId };
  },
};
