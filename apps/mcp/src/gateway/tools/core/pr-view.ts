import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { checkSchema, OTHERS_TEXT_IS_UNVERIFIED, worktreeSchema } from "../schemas.js";
import { repoInput } from "./issue-support.js";
import { findPr, prWithUrl, pullNumberInput, worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({ repo: repoInput, number: pullNumberInput });
const outputSchema = worktreeSchema.extend({
  checks: z
    .array(checkSchema)
    .optional()
    .describe("Declared checks in `.agents/checks.md` order, then reported names that are not declared. Absent when you cannot review."),
});
export const prViewTool: ToolDefinition = {
  name: "pr_view",
  toolset: "core",
  scope: "read",
  title: "View pull request",
  description: `Show a pull request with the files it changes and its checks. ${OTHERS_TEXT_IS_UNVERIFIED}`,
  inputSchema,
  outputSchema,
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo, number } = inputSchema.parse(args);
    const { worktree, spaceId } = await findPr(context, repo, number);
    const { checks: _summary, ...pr } = prWithUrl(context, worktree, spaceId);
    return {
      output: worktree.capabilities?.review === true ? { ...pr, checks: await worktreeFeature(context).checks(worktree.id) } : pr,
      repo: spaceId,
    };
  },
};
