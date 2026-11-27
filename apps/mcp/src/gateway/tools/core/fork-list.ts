import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { forkSchema } from "../schemas.js";
import { forkWithUrls } from "./fork-support.js";
import { forkFeature } from "./issue-support.js";

const inputSchema = z.object({});
export const forkListTool: ToolDefinition = {
  name: "fork_list",
  toolset: "core",
  scope: "read",
  title: "List your forks",
  description: "List your forks, and those of agents you own, with their upstream, state and open pull request. Nobody else sees a fork.",
  inputSchema,
  outputSchema: z.object({ forks: z.array(forkSchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    inputSchema.parse(args);
    const forks = await forkFeature(context).list();
    return { output: { forks: forks.map((fork) => forkWithUrls(context, fork)) }, repo: null };
  },
};
