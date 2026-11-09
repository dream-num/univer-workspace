import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { labelUsageSchema } from "../schemas.js";
import { issueFeature, repoInput, resolveRepo } from "../core/issue-support.js";

const inputSchema = z.object({ repo: repoInput });
export const labelListTool: ToolDefinition = {
  name: "label_list",
  toolset: "admin",
  scope: "read",
  title: "List labels",
  description: "List a repository's Issue labels with how many open Issues use each.",
  inputSchema,
  outputSchema: z.object({ labels: z.array(labelUsageSchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo } = inputSchema.parse(args);
    const spaceId = await resolveRepo(context, repo);
    return { output: { labels: await issueFeature(context).labels(spaceId) }, repo: spaceId };
  },
};
