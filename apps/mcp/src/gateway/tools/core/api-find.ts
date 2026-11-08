import { API_REFERENCE_UNITS } from "@univer-cli/api-reference";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { apiReference } from "./api-reference.js";

const inputSchema = z.object({
  terms: z
    .array(z.string().min(1))
    .min(1)
    .describe("One or more API-name keywords or identifier fragments, searched independently."),
  unit: z
    .enum(API_REFERENCE_UNITS)
    .optional()
    .describe("Limit results to one unit type while keeping the shared APIs."),
});
const matchSchema = z.object({
  kind: z.string(),
  label: z.string(),
  signature: z.string(),
  summary: z.string(),
  packageName: z.string(),
  score: z.number(),
});

export const apiFindTool: ToolDefinition = {
  name: "api_find",
  toolset: "core",
  scope: "read",
  title: "Find Facade API symbols",
  description:
    "Search the offline Univer Facade API reference for methods, types, fields and enums by API-name keyword or identifier fragment. Each term is searched on its own. Pass a symbol from the result to api_show for its declaration and documentation.",
  inputSchema,
  outputSchema: z.object({
    results: z.array(
      z.object({ term: z.string(), matches: z.array(matchSchema), totalMatches: z.number() }),
    ),
  }),
  annotations: readOnlyAnnotations,
  async run(_context, args) {
    const { terms, unit } = inputSchema.parse(args);
    const results = apiReference().find({ terms, ...(unit === undefined ? {} : { unit }) });
    return { output: { results }, repo: null };
  },
};
