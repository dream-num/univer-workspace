import { workspaceError, type WorkspaceRevertTarget } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { revertSchema } from "../schemas.js";
import { repoInput, resolveIssue } from "../core/issue-support.js";
import { findPr, worktreeFeature } from "../core/pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: z.coerce.string().optional().describe("A merged pull request: its number (12 or #12), Workspace URL or Worktree ID."),
  issue: z.coerce.string().optional().describe("An Issue number or URL: every merged pull request linked to it."),
  apply: z.boolean().optional().describe("Omit to get the plan and change nothing. true reverts."),
});
export const prRevertTool: ToolDefinition = {
  name: "pr_revert",
  toolset: "admin",
  scope: "worktree:merge",
  title: "Revert merged pull requests",
  description:
    "Take a merged pull request, or every merged pull request linked to an Issue (pass number or issue), out of trunk. Without apply it returns the plan: each file goes back to its content before the first merge, a file the merges added moves to Trash, and one they removed comes back. A file someone else edited on trunk after the merge is blocked and stays as it is; only a person in the Browser may overwrite it. Replaced pages and files cannot be reverted. With apply it reverts and returns what it did to each file. An Issue revert records the verdict reverted and reopens the Issue. Unless the user asked you to revert, leave it to them.",
  inputSchema,
  outputSchema: revertSchema,
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, number, issue, apply } = inputSchema.parse(args);
    if ((number === undefined) === (issue === undefined)) {
      throw workspaceError("workspace-argument-invalid", "Pass either number (a pull request) or issue, not both.");
    }
    let target: WorkspaceRevertTarget;
    let spaceId: string | null;
    if (issue === undefined) {
      const found = await findPr(context, repo, number!);
      target = { worktreeId: found.worktree.id };
      spaceId = found.spaceId;
    } else {
      const found = await resolveIssue(context, repo, issue);
      target = { spaceId: found.spaceId, issueNumber: found.number };
      spaceId = found.spaceId;
    }
    const worktrees = worktreeFeature(context);
    if (!apply) {
      const plan = await worktrees.revertPlan(target);
      return { output: { applied: false, pullRequests: plan.pullRequests, canRevert: plan.capabilities.revert, refusal: plan.refusal, items: plan.items }, repo: spaceId };
    }
    const result = await worktrees.revert(target);
    return { output: { applied: true, operation: result.operation, items: result.items ?? [] }, repo: spaceId };
  },
};
