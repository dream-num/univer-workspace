import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { checkSchema } from "../schemas.js";
import { repoInput } from "./issue-support.js";
import { findPr, pullNumberInput, worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: pullNumberInput,
  name: z.string().describe("A check name: a `## name` heading in trunk's `.agents/checks.md`."),
  state: z.enum(["passed", "failed"]),
  summary: z.string().optional().describe("What you checked and found, at most 1000 characters."),
});
export const prCheckTool: ToolDefinition = {
  name: "pr_check",
  toolset: "core",
  scope: "write",
  title: "Report pull request check",
  description:
    "Report whether one check passed on a ready pull request you may review. The server binds the result to the content the pull request has now; a later trunk edit to one of its files, or a reopen that changes it, leaves the result out of date. Reporting again replaces your result on that content. A result counts only when you may merge the pull request.",
  inputSchema,
  outputSchema: checkSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, number, name, state, summary } = inputSchema.parse(args);
    const { worktree, spaceId } = await findPr(context, repo, number);
    const check = await worktreeFeature(context).reportCheck(worktree.id, name, {
      state,
      ...(summary === undefined ? {} : { summary }),
    });
    return { output: check, repo: spaceId };
  },
};
