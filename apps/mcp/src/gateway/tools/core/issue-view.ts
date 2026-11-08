import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { issueSchema, issueTimelineItemSchema } from "../schemas.js";
import { issueFeature, numberInput, repoInput, resolveIssue, withUrl } from "./issue-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: numberInput,
  comments: z.boolean().optional().describe("Include every comment and event as `timeline`."),
});
export const issueViewTool: ToolDefinition = {
  name: "issue_view",
  toolset: "core",
  scope: "read",
  title: "View Issue",
  description:
    "Show an Issue with its body, labels, assignees and referenced files. Set comments to include the timeline.",
  inputSchema,
  outputSchema: issueSchema.extend({ timeline: z.array(issueTimelineItemSchema).optional() }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo, number, comments } = inputSchema.parse(args);
    const target = await resolveIssue(context, repo, number);
    const feature = issueFeature(context);
    const issue = await feature.get(target.spaceId, target.number);
    const output = withUrl(context, issue);
    return {
      output:
        comments === true
          ? { ...output, timeline: await feature.timeline(target.spaceId, target.number) }
          : output,
      repo: target.spaceId,
    };
  },
};
