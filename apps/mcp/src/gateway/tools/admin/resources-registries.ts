import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const inputSchema = z.object({});
export const resourcesRegistriesTool: ToolDefinition = {
  name: "resources_registries",
  toolset: "admin",
  scope: "read",
  title: "List SVG resource registries",
  description:
    "List the registries of the SVG resource catalog (icons and illustrations to place into documents and slides) with how many resources, groups and tags each has. Pass a registry id to resources_find.",
  inputSchema,
  outputSchema: z.object({
    registries: z.array(
      z.object({
        id: z.string(),
        resourceCount: z.number(),
        groupCount: z.number(),
        tagCount: z.number(),
        colorEditableCount: z.number(),
      }),
    ),
  }),
  annotations: readOnlyAnnotations,
  async run(context) {
    return { output: { registries: [...context.resources().listRegistries()] }, repo: null };
  },
};
