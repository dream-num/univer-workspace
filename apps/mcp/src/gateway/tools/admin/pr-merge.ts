import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput } from "../core/issue-support.js";
import { pullNumberInput, transitionPr } from "../core/pr-support.js";

const inputSchema = z.object({ repo: repoInput, number: pullNumberInput });
export const prMergeTool: ToolDefinition = {
  name: "pr_merge",
  toolset: "admin",
  // An agent may merge its own work without being asked; only a claimed one has someone to hand it to.
  agentToolsets: ["core", "admin"],
  scope: "worktree:merge",
  title: "Merge pull request",
  description:
    "Merge a ready pull request into its repository. Returns the merged Worktree read back after the merge, with the Units that entered trunk (name, unitId, nodeId, change, mergeResult). Unless the user explicitly asked you to merge, leave merging to the user in the Browser: hand them the pull request url. For an agent identity, follow the server instructions instead for merging its own work and which link to return.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, number } = inputSchema.parse(args);
    return await transitionPr(context, repo, number, "merge");
  },
};
