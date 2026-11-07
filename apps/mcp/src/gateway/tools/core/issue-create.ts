import { issueApiUsername } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { issueSchema } from "../schemas.js";
import { issueFeature, repoInput, resolveRepo, withUrl } from "./issue-support.js";

const inputSchema = z.object({
  repo: repoInput,
  title: z.string(),
  body: z.string().optional().describe("Markdown."),
  labels: z
    .array(z.string())
    .optional()
    .describe("Label names that already exist in the repository."),
  assignees: z.array(z.string()).optional().describe("Usernames or @me."),
  nodes: z.array(z.string()).optional().describe("Node IDs of files the Issue references."),
});
export const issueCreateTool: ToolDefinition = {
  name: "issue_create",
  toolset: "core",
  scope: "write",
  title: "Create Issue",
  description:
    "Open an Issue. Not idempotent: if the result is unknown, list the repository's Issues before retrying.",
  inputSchema,
  outputSchema: issueSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, title, body, labels, assignees, nodes } = inputSchema.parse(args);
    const spaceId = await resolveRepo(context, repo);
    const issue = await issueFeature(context).create({
      spaceId,
      title,
      ...(body === undefined ? {} : { body }),
      ...(labels === undefined ? {} : { labels }),
      ...(assignees === undefined ? {} : { assignees: assignees.map(issueApiUsername) }),
      ...(nodes === undefined ? {} : { nodeIds: nodes }),
    });
    return { output: withUrl(context, issue), repo: spaceId };
  },
};
