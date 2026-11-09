import {
  issueApiUsername,
  listIssues,
  listPullRequests,
  PULL_REQUEST_STATES,
  workspaceError,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { issueSummarySchema, worktreeSchema } from "../schemas.js";
import { issueFeature, withUrl } from "./issue-support.js";
import { prsWithUrl, worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({
  kind: z.enum(["issues", "prs"]),
  state: z
    .enum(["open", "closed", "merged", "discarded", "all"])
    .default("open")
    .describe("Issues: open, closed or all. Pull requests: open, merged, discarded or all."),
  labels: z.array(z.string()).optional().describe("Issues only. Require every one of these labels."),
  assignee: z.string().optional().describe("Issues only. Username, @me, or none."),
  author: z.string().optional().describe("Username or @me."),
  search: z.string().optional().describe("Match title and body (pull requests also author)."),
  limit: z.int().min(1).max(999999).default(30),
});
const invalid = (message: string) => workspaceError("workspace-argument-invalid", message);

export const searchTool: ToolDefinition = {
  name: "search",
  toolset: "core",
  scope: "read",
  title: "Search Issues or pull requests",
  description:
    "Find Issues (kind issues) or pull requests (kind prs) across every repository you can access. The result has issues or prs accordingly.",
  inputSchema,
  outputSchema: z.object({
    issues: z.array(issueSummarySchema).optional(),
    prs: z.array(worktreeSchema).optional(),
  }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { kind, state, labels, assignee, author, search, limit } = inputSchema.parse(args);
    if (kind === "issues") {
      if (state === "merged" || state === "discarded") {
        throw invalid("state must be open, closed or all when kind is issues.");
      }
      const issues = await listIssues(
        issueFeature(context),
        {
          state,
          ...(labels === undefined ? {} : { labels }),
          ...(assignee === undefined ? {} : { assignee: issueApiUsername(assignee) }),
          ...(author === undefined ? {} : { author: issueApiUsername(author) }),
          ...(search === undefined ? {} : { search }),
        },
        limit,
      );
      return { output: { issues: issues.map((issue) => withUrl(context, issue)) }, repo: null };
    }
    if (state === "closed") throw invalid("state must be open, merged, discarded or all when kind is prs.");
    if (labels !== undefined || assignee !== undefined) {
      throw invalid("labels and assignee apply only when kind is issues.");
    }
    const prs = await listPullRequests(
      { userId: async () => context.user.id, worktrees: worktreeFeature(context) },
      {
        state: z.enum(PULL_REQUEST_STATES).parse(state),
        limit,
        ...(author === undefined ? {} : { author }),
        ...(search === undefined ? {} : { search }),
      },
    );
    return { output: { prs: await prsWithUrl(context, prs) }, repo: null };
  },
};
