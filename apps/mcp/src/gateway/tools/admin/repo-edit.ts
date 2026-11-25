import { editRepo, repoEditPatch, repoUrl } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { landingSchema, proposalsSchema, repoSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "../core/issue-support.js";
import { spaceFeature } from "../core/pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  name: z.string().optional().describe("New display name."),
  description: z.string().optional().describe("Plain text; an empty string clears it."),
  visibility: z.enum(["public", "private"]).optional(),
  proposals: proposalsSchema.optional(),
  acceptAfterHours: z
    .number()
    .int()
    .min(1)
    .max(720)
    .nullable()
    .optional()
    .describe(
      "Accept a submitted Issue nobody sent back after this many hours (72 is typical); null turns it off. Turning it on or lowering it accepts every submitted Issue already past the new deadline within a minute.",
    ),
  landing: landingSchema.optional(),
  slug: z.string().optional().describe("New slug. The old owner/slug stops resolving."),
});
export const repoEditTool: ToolDefinition = {
  name: "repo_edit",
  toolset: "admin",
  // As for repo_create: an agent runs the repositories it owns, its proposals setting included.
  agentToolsets: ["core", "admin"],
  scope: "publish",
  title: "Edit repository",
  description:
    "Takes effect immediately, without review. Change a repository's display name, description, visibility, proposals setting, acceptance deadline, landing setting or slug. A new slug breaks every old owner/slug reference and link. Needs at least one change.",
  inputSchema,
  outputSchema: repoSchema,
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, name, description, visibility, proposals, acceptAfterHours, landing, slug } = inputSchema.parse(args);
    const patch = repoEditPatch({
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(visibility === undefined ? {} : { visibility }),
      ...(proposals === undefined ? {} : { proposals }),
      ...(acceptAfterHours === undefined ? {} : { acceptAfterHours }),
      ...(landing === undefined ? {} : { landing }),
      ...(slug === undefined ? {} : { slug }),
    });
    const spaceId = await resolveRepo(context, repo);
    const space = await editRepo(spaceFeature(context), context.identityOrigin, spaceId, patch);
    return { output: { ...space, url: repoUrl(context.identityOrigin, space.id) }, repo: spaceId };
  },
};
