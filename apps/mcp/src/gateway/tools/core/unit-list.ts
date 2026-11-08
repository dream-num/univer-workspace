import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { unitWithUrlSchema } from "../schemas.js";
import { worktreeUnits } from "@univerjs/univer-workspace-client-core/product";
import { attachUnitUrls, worktreeInput } from "./space-support.js";
import { worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({ worktree: worktreeInput });
export const unitListTool: ToolDefinition = {
  name: "unit_list",
  toolset: "core",
  scope: "read",
  title: "List pull request files",
  description:
    "List the Units (files) in a pull request's Worktree, with their change state. Each url opens that file in the pull request.",
  inputSchema,
  outputSchema: z.object({ units: z.array(unitWithUrlSchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { worktree } = inputSchema.parse(args);
    const fetched = await worktreeFeature(context).get(worktree);
    const { units, spaceId } = await attachUnitUrls(context, fetched, worktreeUnits(fetched));
    return { output: { units }, repo: spaceId };
  },
};
