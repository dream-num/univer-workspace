import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { issueCommentSchema } from "../schemas.js";
import { issueFeature, numberInput, repoInput, resolveIssue } from "./issue-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: numberInput,
  body: z.string().describe("Markdown."),
});
export const issueCommentTool: ToolDefinition = {
  name: "issue_comment",
  toolset: "core",
  scope: "write",
  title: "Comment on Issue",
  description:
    "Add a comment to an Issue. Not idempotent: if the result is unknown, read the Issue's comments before retrying.",
  inputSchema,
  outputSchema: issueCommentSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, number, body } = inputSchema.parse(args);
    const target = await resolveIssue(context, repo, number);
    return {
      output: await issueFeature(context).comment(target.spaceId, target.number, body),
      repo: target.spaceId,
    };
  },
};
