import { listIssues, issueApiUsername } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { issueSummarySchema } from "../schemas.js";
import { issueFeature, repoInput, resolveRepo, withUrl } from "./issue-support.js";

const inputSchema = z.object({
  repo: repoInput,
  state: z.enum(["open", "closed", "all"]).default("open"),
  labels: z.array(z.string()).optional().describe("Require every one of these labels."),
  assignee: z.string().optional().describe("Username, @me, or none."),
  author: z.string().optional().describe("Username or @me."),
  search: z.string().optional().describe("Match title and body."),
  limit: z.int().min(1).max(999999).default(30),
});
export const issueListTool: ToolDefinition = {
  name: "issue_list",
  toolset: "core",
  scope: "read",
  title: "List Issues",
  description: "List Issues in a repository.",
  inputSchema,
  outputSchema: z.object({ issues: z.array(issueSummarySchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo, state, labels, assignee, author, search, limit } = inputSchema.parse(args);
    const spaceId = await resolveRepo(context, repo);
    const issues = await listIssues(
      issueFeature(context),
      {
        spaceId,
        state,
        ...(labels === undefined ? {} : { labels }),
        ...(assignee === undefined ? {} : { assignee: issueApiUsername(assignee) }),
        ...(author === undefined ? {} : { author: issueApiUsername(author) }),
        ...(search === undefined ? {} : { search }),
      },
      limit,
    );
    return { output: { issues: issues.map((issue) => withUrl(context, issue)) }, repo: spaceId };
  },
};
