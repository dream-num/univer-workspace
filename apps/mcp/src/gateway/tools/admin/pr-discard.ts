import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput } from "../core/issue-support.js";
import { pullNumberInput, transitionPr } from "../core/pr-support.js";

const inputSchema = z.object({ repo: repoInput, number: pullNumberInput });
export const prDiscardTool: ToolDefinition = {
  name: "pr_discard",
  toolset: "admin",
  scope: "worktree:merge",
  title: "Discard pull request",
  description:
    "Discard a pull request and its files. This cannot be undone. Unless the user explicitly asked you to discard it, leave discarding to the user in the Browser.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, number } = inputSchema.parse(args);
    return await transitionPr(context, repo, number, "discard");
  },
};
