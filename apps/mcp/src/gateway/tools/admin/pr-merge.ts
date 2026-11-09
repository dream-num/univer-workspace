import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput } from "../core/issue-support.js";
import { pullNumberInput, transitionPr } from "../core/pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: pullNumberInput,
  review_token: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .optional()
    .describe(
      "Required to merge: the Server Worktree reviewToken for the exact preview explicitly reviewed by the user. Never invent a token or automatically review on the user's behalf.",
    ),
});
export const prMergeTool: ToolDefinition = {
  name: "pr_merge",
  toolset: "admin",
  scope: "worktree:merge",
  title: "Merge pull request",
  description:
    "Merge a ready pull request into its repository using the Server review_token for the exact preview explicitly reviewed by the user. Without a token merging is refused; hand the Browser review link to the user. Unless the user explicitly asked you to merge, leave merging to the user in the Browser: hand them the pull request url.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, number, review_token } = inputSchema.parse(args);
    return await transitionPr(context, repo, number, "merge", review_token);
  },
};
