import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { jobViewSchema } from "../../jobs/model.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

export const jobGetTool: ToolDefinition = {
  name: "job_get",
  toolset: "core",
  scope: "read",
  title: "Get a conversion job",
  description:
    "Poll a job_id returned by import, export or compile_typst. Repeat while running. On succeeded, result is the original tool result, including its download link for export. On failed, error carries code, message and detail.",
  annotations: readOnlyAnnotations,
  inputSchema: z.object({ job_id: z.string().min(1) }),
  outputSchema: jobViewSchema,
  async run(context, args) {
    const { job_id } = this.inputSchema.parse(args);
    if (!context.jobs || typeof job_id !== "string")
      throw workspaceError("workspace-job-not-found", "Job not found or expired.");
    return { output: await context.jobs.get(context.user.id, job_id), repo: null };
  },
};
