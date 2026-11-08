import {
  repoUrl,
  resolveRepoReference,
  WorkspaceSpaceFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { repoSchema } from "../schemas.js";

const inputSchema = z.object({ repo: z.string() });
export const repoViewTool: ToolDefinition = {
  name: "repo_view",
  toolset: "core",
  scope: "read",
  title: "View repository",
  description: "Show a repository by owner/slug, owner/personal, Space ID, or Workspace URL.",
  inputSchema,
  outputSchema: repoSchema.extend({ starCount: z.number(), starred: z.boolean() }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo } = inputSchema.parse(args);
    const spaces = new WorkspaceSpaceFeature(async () => context.http);
    const { spaceId } = await resolveRepoReference(spaces, repo, context.identityOrigin);
    return {
      output: {
        ...(await spaces.get(spaceId)),
        ...(await spaces.getStar(spaceId)),
        url: repoUrl(context.identityOrigin, spaceId),
      },
      repo: spaceId,
    };
  },
};
