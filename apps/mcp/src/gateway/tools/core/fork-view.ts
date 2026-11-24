import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { forkSchema } from "../schemas.js";
import { forkInput, forkWithUrls } from "./fork-support.js";
import { forkFeature } from "./issue-support.js";

const inputSchema = z.object({ fork: forkInput });
export const forkViewTool: ToolDefinition = {
  name: "fork_view",
  toolset: "core",
  scope: "read",
  title: "View a fork",
  description:
    "Show one of your forks: its upstream with your role there, its state, and its open pull request. Use worktree.number with repo set to upstream.fullName in pr_view, pr_ready and pr_merge, and worktree.id where a tool needs a Worktree ID.",
  inputSchema,
  outputSchema: forkSchema,
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { fork } = inputSchema.parse(args);
    const found = await forkFeature(context).get(fork);
    return { output: forkWithUrls(context, found), repo: found.upstream?.id ?? null };
  },
};
