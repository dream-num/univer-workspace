import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { forkPullSchema, forkSchema } from "../schemas.js";
import { forkInput, forkPullWithUrl, forkWithUrls } from "./fork-support.js";
import { forkFeature } from "./issue-support.js";

const inputSchema = z.object({ fork: forkInput });
export const forkDeleteTool: ToolDefinition = {
  name: "fork_delete",
  toolset: "core",
  scope: "write",
  title: "Delete a fork",
  description:
    "Delete one of your forks. Only the fork goes: the upstream does not change, and its open pull request, returned as worktree, stays in the upstream as an ordinary pull request.",
  inputSchema,
  outputSchema: z.object({ fork: forkSchema, worktree: forkPullSchema }),
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { fork, worktree } = await forkFeature(context).delete(inputSchema.parse(args).fork);
    return {
      output: { fork: forkWithUrls(context, fork), worktree: forkPullWithUrl(context, fork, worktree) },
      repo: fork.upstream?.id ?? null,
    };
  },
};
