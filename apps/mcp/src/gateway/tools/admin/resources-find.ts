import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Text to match against resource name, description, group, tag or keyword."),
  registry: z
    .string()
    .min(1)
    .optional()
    .describe("Restrict results to one registry id from resources_registries."),
  limit: z.int().min(1).max(999999).default(30),
});
const textValue = z.object({ id: z.string(), label: z.string() });

export const resourcesFindTool: ToolDefinition = {
  name: "resources_find",
  toolset: "admin",
  scope: "read",
  title: "Find SVG resources",
  description:
    "Find SVG icons and illustrations in the resource catalog by name, description, group, tag or keyword. Pass a result's handle to resources_export to get its SVG text. Try a shorter substring or a synonym when nothing matches.",
  inputSchema,
  outputSchema: z.object({
    query: z.object({ queries: z.array(z.string()), registries: z.array(z.string()) }),
    resources: z.array(
      z.object({
        handle: z.string(),
        registryId: z.string(),
        id: z.string(),
        name: z.string(),
        group: textValue.nullable(),
        tags: z.array(textValue),
        keywords: z.array(z.string()),
        order: z.number().nullable(),
        intrinsicSize: z.object({ width: z.number(), height: z.number() }),
        colorEditable: z.boolean(),
      }),
    ),
    total: z.number(),
    limit: z.number(),
  }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { query, registry, limit } = inputSchema.parse(args);
    const registries = registry === undefined ? [] : [registry];
    const found = context
      .resources()
      .find({ queries: [query], registries, limit });
    return {
      output: {
        query: { queries: [query], registries },
        resources: [...found.resources],
        total: found.total,
        limit,
      },
      repo: null,
    };
  },
};
