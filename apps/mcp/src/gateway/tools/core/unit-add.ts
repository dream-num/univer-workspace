import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { unitWithUrlSchema } from "../schemas.js";
import { unitFeature, unitsWithUrl, worktreeInput } from "./space-support.js";

const inputSchema = z.object({
  worktree: worktreeInput,
  resource: z
    .string()
    .describe("Resource ID of an existing file in the repository, from space_browse or space_find."),
});
export const unitAddTool: ToolDefinition = {
  name: "unit_add",
  toolset: "core",
  scope: "write",
  title: "Add existing file to pull request",
  description:
    "Add an existing repository file to a pull request's Worktree so it can be edited there; the repository file stays unchanged until the pull request is merged.",
  inputSchema,
  outputSchema: z.object({ unit: unitWithUrlSchema }),
  annotations: writeAnnotations,
  async run(context, args) {
    const { worktree, resource } = inputSchema.parse(args);
    const unit = await unitFeature(context).add(worktree, resource);
    const { units, spaceId } = await unitsWithUrl(context, worktree, [unit]);
    return { output: { unit: units[0]! }, repo: spaceId };
  },
};
