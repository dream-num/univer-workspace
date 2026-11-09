import {
  listPullRequests,
  PULL_REQUEST_STATES,
  pullRequestSpace,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "./issue-support.js";
import { prsWithUrl, spaceFeature, worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  state: z.enum(PULL_REQUEST_STATES).default("open").describe("open means draft, ready or merging."),
  author: z.string().optional().describe("Username or @me."),
  search: z.string().optional().describe("Match title, body and author."),
  limit: z.int().min(1).max(999999).default(30),
});
export const prListTool: ToolDefinition = {
  name: "pr_list",
  toolset: "core",
  scope: "read",
  title: "List pull requests",
  description:
    "List pull requests (Worktrees) in a repository. A Personal Space lists only your own.",
  inputSchema,
  outputSchema: z.object({ prs: z.array(worktreeSchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo, state, author, search, limit } = inputSchema.parse(args);
    const spaceId = await resolveRepo(context, repo);
    const space = await pullRequestSpace(spaceFeature(context), async () => context.user.id, spaceId);
    const prs = await listPullRequests(
      { userId: async () => context.user.id, worktrees: worktreeFeature(context) },
      {
        space,
        state,
        limit,
        ...(author === undefined ? {} : { author }),
        ...(search === undefined ? {} : { search }),
      },
    );
    return { output: { prs: await prsWithUrl(context, prs) }, repo: spaceId };
  },
};
