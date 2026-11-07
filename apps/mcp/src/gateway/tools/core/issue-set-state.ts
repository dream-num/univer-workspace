import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { issueSchema } from "../schemas.js";
import { issueFeature, numberInput, repoInput, resolveIssue, withUrl } from "./issue-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: numberInput,
  state: z.enum(["open", "closed"]),
  reason: z
    .enum(["completed", "not_planned"])
    .optional()
    .describe("Only with state closed; defaults to completed."),
  comment: z
    .string()
    .optional()
    .describe("Markdown posted before closing; only with state closed."),
});
export const issueSetStateTool: ToolDefinition = {
  name: "issue_set_state",
  toolset: "core",
  scope: "write",
  title: "Close or reopen Issue",
  description:
    "Close an Issue (optionally with a reason and a final comment) or reopen it. Reason and comment apply only when closing.",
  inputSchema,
  outputSchema: issueSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, number, state, reason, comment } = inputSchema.parse(args);
    if (state === "open" && (reason !== undefined || comment !== undefined)) {
      throw workspaceError(
        "workspace-argument-invalid",
        "reason and comment apply only when state is closed.",
      );
    }
    const target = await resolveIssue(context, repo, number);
    const feature = issueFeature(context);
    const issue =
      state === "open"
        ? await feature.reopen(target.spaceId, target.number)
        : await feature.close(target.spaceId, target.number, {
            reason: reason ?? "completed",
            ...(comment === undefined ? {} : { comment }),
          });
    return { output: withUrl(context, issue), repo: target.spaceId };
  },
};
