import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput } from "../core/issue-support.js";
import { pullNumberInput, transitionPr } from "../core/pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: pullNumberInput,
  revision: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The revision pr_view showed for the pull request you reviewed. Needed only for a pull request someone else created: without it, or after the pull request changed, pr_merge refuses and merges nothing. Then view it again with pr_view before you decide.",
    ),
});
export const prMergeTool: ToolDefinition = {
  name: "pr_merge",
  toolset: "admin",
  // An agent merges its own work, because nobody reviews its Personal Space in the browser.
  agentToolsets: ["core", "admin"],
  scope: "worktree:merge",
  title: "Merge pull request",
  description:
    "Merge a ready pull request into its repository. Returns the merged Worktree read back after the merge, with the Units that entered trunk (name, unitId, nodeId, change, mergeResult). Unless the user explicitly asked you to merge, leave merging to the user in the Browser: hand them the pull request url.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, number, revision } = inputSchema.parse(args);
    return await transitionPr(context, repo, number, "merge", revision);
  },
};
