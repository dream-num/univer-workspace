import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { teamMemberSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "../core/issue-support.js";
import { spaceFeature } from "../core/pr-support.js";

const inputSchema = z.object({ repo: repoInput });
export const repoMemberListTool: ToolDefinition = {
  name: "repo_member_list",
  toolset: "admin",
  agentToolsets: ["core", "admin"],
  scope: "read",
  title: "List repository members",
  description: "List a Team repository's owner and its members with their roles.",
  inputSchema,
  outputSchema: z.object({ owner: teamMemberSchema.shape.user, members: z.array(teamMemberSchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo } = inputSchema.parse(args);
    const spaceId = await resolveRepo(context, repo);
    return { output: await spaceFeature(context).members(spaceId), repo: spaceId };
  },
};
