import { createRepo, repoUrl } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { repoSchema } from "../schemas.js";
import { spaceFeature } from "../core/pr-support.js";

const inputSchema = z.object({
  slug: z.string().describe("Repository slug: letters, digits, '.', '_' and '-'."),
  name: z.string().optional().describe("Display name; defaults to the slug."),
  description: z.string().optional().describe("Short plain text, at most 350 characters."),
  public: z.boolean().optional().describe("Let anyone with the link read it."),
});
export const repoCreateTool: ToolDefinition = {
  name: "repo_create",
  toolset: "admin",
  scope: "publish",
  title: "Create repository",
  description:
    "Create a Team Space repository. Takes effect immediately, without review. Only create one when the user asks for a new repository.",
  inputSchema,
  outputSchema: repoSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { slug, name, description, public: isPublic } = inputSchema.parse(args);
    const space = await createRepo(spaceFeature(context), {
      slug,
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(isPublic === true ? { public: true } : {}),
    });
    return { output: { ...space, url: repoUrl(context.identityOrigin, space.id) }, repo: space.id };
  },
};
