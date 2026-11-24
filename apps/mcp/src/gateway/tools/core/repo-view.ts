import { repoUrl, WorkspaceSpaceFeature } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { repoSchema } from "../schemas.js";
import { resolveRepoOrUpstream } from "./issue-support.js";

const inputSchema = z.object({ repo: z.string() });
export const repoViewTool: ToolDefinition = {
  name: "repo_view",
  toolset: "core",
  scope: "read",
  title: "View repository",
  description:
    "Show a repository by owner/slug, owner/personal, a unique bare slug from repo_list, Space ID, or Workspace URL. A fork address shows the fork's upstream; fork_view shows the fork.",
  inputSchema,
  outputSchema: repoSchema.extend({ starCount: z.number(), starred: z.boolean() }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo } = inputSchema.parse(args);
    const spaces = new WorkspaceSpaceFeature(async () => context.http);
    const spaceId = await resolveRepoOrUpstream(context, repo);
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
