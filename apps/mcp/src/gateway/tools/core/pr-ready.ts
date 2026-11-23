import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput } from "./issue-support.js";
import { findPr, prWithUrl, pullNumberInput, worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: pullNumberInput,
  undo: z.boolean().optional().describe("Move a ready pull request back to draft."),
});
export const prReadyTool: ToolDefinition = {
  name: "pr_ready",
  toolset: "core",
  scope: "write",
  title: "Mark pull request ready",
  description:
    "Mark a draft pull request ready for review only when the user explicitly says the work is finished or requests review; otherwise leave verified changes in draft. With undo true, move a ready pull request back to draft before an explicitly requested write. Hand the returned url to the user for review; merging stays with the user unless they ask you to merge. For an agent identity, follow the server instructions instead for readiness, merging and which link to return.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, number, undo } = inputSchema.parse(args);
    const { worktree, spaceId } = await findPr(context, repo, number);
    const updated = await worktreeFeature(context).transition(
      worktree.id,
      undo === true ? "reopen" : "ready",
    );
    return { output: prWithUrl(context, updated, spaceId), repo: spaceId };
  },
};
