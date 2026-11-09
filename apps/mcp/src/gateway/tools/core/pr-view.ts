import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput } from "./issue-support.js";
import { findPr, prWithUrl, pullNumberInput } from "./pr-support.js";

const inputSchema = z.object({ repo: repoInput, number: pullNumberInput });
export const prViewTool: ToolDefinition = {
  name: "pr_view",
  toolset: "core",
  scope: "read",
  title: "View pull request",
  description: "Show a pull request with the files it changes.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo, number } = inputSchema.parse(args);
    const { worktree, spaceId } = await findPr(context, repo, number);
    return { output: prWithUrl(context, worktree, spaceId), repo: spaceId };
  },
};
