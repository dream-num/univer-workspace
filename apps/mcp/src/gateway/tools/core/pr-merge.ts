import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput } from "./issue-support.js";
import { pullNumberInput, transitionPr } from "./pr-support.js";

const inputSchema = z.object({ repo: repoInput, number: pullNumberInput });
export const prMergeTool: ToolDefinition = {
  name: "pr_merge",
  toolset: "core",
  scope: "worktree:merge",
  title: "Merge pull request",
  description:
    "Merge a ready pull request into its repository. Returns the merged Worktree read back after the merge, with the Units that entered trunk (name, unitId, nodeId, change, mergeResult). The notice from whoami, or without one the server instructions, says when to merge and which link to return.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, number } = inputSchema.parse(args);
    return await transitionPr(context, repo, number, "merge");
  },
};
