import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

export const whoamiTool: ToolDefinition = {
  name: "whoami",
  toolset: "core",
  scope: "read",
  title: "Current user",
  description: "Show the Workspace origin and authenticated user.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    origin: z.string(),
    subject: z.object({ id: z.string(), name: z.string() }),
  }),
  annotations: readOnlyAnnotations,
  async run(context) {
    const { id, name } = context.user;
    return { output: { origin: context.identityOrigin, subject: { id, name } }, repo: null };
  },
};
