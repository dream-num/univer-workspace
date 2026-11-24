import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { unitWithUrlSchema } from "../schemas.js";
import { isForkAddress, worktreeUnits } from "@univerjs/univer-workspace-client-core/product";
import { forkFeature, upstreamOf } from "./issue-support.js";
import { attachUnitUrls, worktreeOrForkInput } from "./space-support.js";
import { worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({ worktree: worktreeOrForkInput });
export const unitListTool: ToolDefinition = {
  name: "unit_list",
  toolset: "core",
  scope: "read",
  title: "List pull request files",
  description:
    "List the Units (files) in a pull request's Worktree, with their change state. Each url opens that file in the pull request. A fork lists its open pull request's files, none while it is clean.",
  inputSchema,
  outputSchema: z.object({ units: z.array(unitWithUrlSchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    let { worktree } = inputSchema.parse(args);
    if (isForkAddress(worktree)) {
      const fork = await forkFeature(context).get(worktree);
      if (fork.worktree === null) return { output: { units: [] }, repo: upstreamOf(fork).id };
      worktree = fork.worktree.id;
    }
    const fetched = await worktreeFeature(context).get(worktree);
    const { units, spaceId } = await attachUnitUrls(context, fetched, worktreeUnits(fetched));
    return { output: { units }, repo: spaceId };
  },
};
