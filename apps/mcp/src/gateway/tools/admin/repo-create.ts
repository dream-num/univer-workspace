import { createRepo, repoUrl } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { proposalsSchema, repoSchema } from "../schemas.js";
import { spaceFeature } from "../core/pr-support.js";

const inputSchema = z.object({
  slug: z.string().describe("Repository slug: letters, digits, '.', '_' and '-'."),
  name: z.string().optional().describe("Display name; defaults to the slug."),
  description: z.string().optional().describe("Short plain text, at most 350 characters."),
  proposals: proposalsSchema.optional().describe(`${proposalsSchema.description} Defaults to members.`),
});
export const repoCreateTool: ToolDefinition = {
  name: "repo_create",
  toolset: "admin",
  // An agent owns the repositories it creates and runs them itself, so its default connection lists them.
  agentToolsets: ["core", "admin"],
  scope: "publish",
  title: "Create repository",
  description:
    "Takes effect immediately, without review. Create a private Team Space repository; repo_edit makes it public. Only create one when the user asks for a new repository.",
  inputSchema,
  outputSchema: repoSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { slug, name, description, proposals } = inputSchema.parse(args);
    const space = await createRepo(spaceFeature(context), {
      slug,
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(proposals === undefined ? {} : { proposals }),
    });
    return { output: { ...space, url: repoUrl(context.identityOrigin, space.id) }, repo: space.id };
  },
};
