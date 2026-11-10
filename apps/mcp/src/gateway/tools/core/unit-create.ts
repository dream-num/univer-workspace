import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { IDEMPOTENCY_KEY_DESCRIPTION, unitWithUrlSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "./issue-support.js";
import { nodeIdInput, unitFeature, unitsWithUrl, unitTypeInput, worktreeInput } from "./space-support.js";

const inputSchema = z.object({
  worktree: worktreeInput,
  space: repoInput.describe(
    "Repository the new file will belong to once merged: owner/slug, owner/personal, a Space ID or a Workspace URL.",
  ),
  type: unitTypeInput.describe("Document type."),
  name: z.string().describe("File name."),
  parent: nodeIdInput("the folder to create it in; omit for the repository root").optional(),
  idempotency_key: z
    .string()
    .optional()
    .describe(IDEMPOTENCY_KEY_DESCRIPTION),
});
export const unitCreateTool: ToolDefinition = {
  name: "unit_create",
  toolset: "core",
  scope: "write",
  title: "Create file in pull request",
  description:
    "Create a new empty file (sheet, doc, slide, base or board) in a pull request's Worktree; it joins the repository when the pull request is merged. Generate an idempotency_key before creating and reuse it on retry, so a retry returns the same file instead of a duplicate.",
  inputSchema,
  outputSchema: z.object({ unit: unitWithUrlSchema }),
  annotations: writeAnnotations,
  async run(context, args) {
    const { worktree, space, type, name, parent, idempotency_key } = inputSchema.parse(args);
    const spaceId = await resolveRepo(context, space);
    const unit = await unitFeature(context).create({
      name,
      spaceId,
      type,
      worktreeId: worktree,
      ...(parent === undefined ? {} : { parentNodeId: parent }),
      ...(idempotency_key === undefined ? {} : { idempotencyKey: idempotency_key }),
    });
    const { units } = await unitsWithUrl(context, worktree, [unit]);
    return { output: { unit: units[0]! }, repo: spaceId };
  },
};
