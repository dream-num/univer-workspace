import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput } from "./issue-support.js";
import { findPr, prWithUrl, pullNumberInput, visibilityInput, worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: pullNumberInput,
  title: z.string().optional(),
  body: z.string().optional().describe("Markdown; replaces the whole body."),
  visibility: visibilityInput.optional(),
});
export const prEditTool: ToolDefinition = {
  name: "pr_edit",
  toolset: "core",
  scope: "write",
  title: "Edit pull request",
  description: "Change a pull request's title, body or visibility. Needs at least one change.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, number, title, body, visibility } = inputSchema.parse(args);
    if (title === undefined && body === undefined && visibility === undefined) {
      throw workspaceError(
        "workspace-argument-invalid",
        "Nothing to change: pass title, body or visibility.",
      );
    }
    const { worktree, spaceId } = await findPr(context, repo, number);
    const updated = await worktreeFeature(context).update(worktree.id, {
      ...(title === undefined ? {} : { name: title }),
      ...(body === undefined ? {} : { summary: body }),
      ...(visibility === undefined ? {} : { visibility }),
    });
    return { output: prWithUrl(context, updated, spaceId), repo: spaceId };
  },
};
