import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

export const whoamiTool: ToolDefinition = {
  name: "whoami",
  toolset: "core",
  title: "Current user",
  description: "Show the Workspace origin and authenticated user.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    origin: z.string(),
    subject: z.object({ id: z.string(), name: z.string() }),
  }),
  annotations: readOnlyAnnotations,
  async run(context) {
    return { output: { origin: context.identityOrigin, subject: context.user }, repo: null };
  },
};
