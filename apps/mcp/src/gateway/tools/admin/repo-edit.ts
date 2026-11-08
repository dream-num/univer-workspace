import { repoEditPatch, repoUrl } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { repoSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "../core/issue-support.js";
import { spaceFeature } from "../core/pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  name: z.string().optional().describe("New display name."),
  description: z.string().optional().describe("Plain text; an empty string clears it."),
  visibility: z.enum(["public", "private"]).optional(),
  slug: z.string().optional().describe("New slug. The old owner/slug stops resolving."),
});
export const repoEditTool: ToolDefinition = {
  name: "repo_edit",
  toolset: "admin",
  scope: "publish",
  title: "Edit repository",
  description:
    "Takes effect immediately, without review. Change a repository's display name, description, visibility or slug. A new slug breaks every old owner/slug reference and link. Needs at least one change.",
  inputSchema,
  outputSchema: repoSchema,
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, name, description, visibility, slug } = inputSchema.parse(args);
    const patch = repoEditPatch({
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(visibility === undefined ? {} : { visibility }),
      ...(slug === undefined ? {} : { slug }),
    });
    const spaceId = await resolveRepo(context, repo);
    const space = await spaceFeature(context).update(spaceId, patch);
    return { output: { ...space, url: repoUrl(context.identityOrigin, space.id) }, repo: spaceId };
  },
};
