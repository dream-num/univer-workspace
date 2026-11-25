import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput } from "./issue-support.js";
import { findPr, issueLinkInput, prWithUrl, pullNumberInput, visibilityInput, worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: pullNumberInput,
  title: z.string().optional(),
  body: z.string().optional().describe("Markdown; replaces the whole body."),
  visibility: visibilityInput.optional(),
  issue: issueLinkInput.nullable().optional().describe("Number of the Issue in the same repository that this pull request serves; null removes the link."),
  leave_out_trashed: z
    .boolean()
    .optional()
    .describe(
      "true leaves out every file whose fileState is inTrash or deleted, which pr_merge refuses to merge, so the other files can merge. Those files stay as they are, and this pull request's changes to them are not merged. A ready pull request goes back to draft for this and is marked ready again. Author only.",
    ),
});
export const prEditTool: ToolDefinition = {
  name: "pr_edit",
  toolset: "core",
  scope: "write",
  title: "Edit pull request",
  description:
    "Change a pull request's title, body, visibility or the Issue it serves, or leave out its files that are in Trash. Needs at least one change.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, number, title, body, visibility, issue, leave_out_trashed } = inputSchema.parse(args);
    const edits = title !== undefined || body !== undefined || visibility !== undefined || issue !== undefined;
    if (!edits && leave_out_trashed !== true) {
      throw workspaceError(
        "workspace-argument-invalid",
        "Nothing to change: pass title, body, visibility, issue or leave_out_trashed.",
      );
    }
    const { worktree, spaceId } = await findPr(context, repo, number);
    const feature = worktreeFeature(context);
    let updated = worktree;
    if (edits) {
      updated = await feature.update(worktree.id, {
        ...(title === undefined ? {} : { name: title }),
        ...(body === undefined ? {} : { summary: body }),
        ...(visibility === undefined ? {} : { visibility }),
        ...(issue === undefined ? {} : { issueNumber: issue }),
      });
    }
    if (leave_out_trashed === true) updated = await feature.leaveOutTrashed(worktree.id);
    return { output: prWithUrl(context, updated, spaceId), repo: spaceId };
  },
};
