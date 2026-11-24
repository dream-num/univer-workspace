import { isForkAddress, parseNodeReference, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { IDEMPOTENCY_KEY_DESCRIPTION, unitWithUrlSchema } from "../schemas.js";
import { forkFeature, repoInput, resolveRepoOrUpstream } from "./issue-support.js";
import { nodeIdInput, unitFeature, unitsWithUrl, unitTypeInput, worktreeOrForkInput } from "./space-support.js";

const inputSchema = z.object({
  worktree: worktreeOrForkInput,
  space: repoInput.describe(
    "Repository the new file will belong to once merged: owner/slug, owner/personal, a unique bare slug from repo_list, a Space ID or a Workspace URL. A fork address names its upstream.",
  ),
  type: unitTypeInput.describe("Document type."),
  name: z.string().describe("File name."),
  parent: nodeIdInput("the folder to create it in; omit for the repository root").optional(),
  from: z
    .string()
    .optional()
    .describe(
      "Share link or Node ID of a file you can open. The new file is then a copy of it, with its content and images, instead of an empty file. type must be the type of that file. The copy records that file as its source, which only the copy's owner and editors can see. Needs a Worktree ID, not a fork address.",
    ),
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
    "Create a new file (sheet, doc, slide, base or board) in a pull request's Worktree, empty or, with from, a copy of a file you can open; it joins the repository when the pull request is merged. Generate an idempotency_key before creating and reuse it on retry, so a retry returns the same file instead of a duplicate.",
  inputSchema,
  outputSchema: z.object({ unit: unitWithUrlSchema }),
  annotations: writeAnnotations,
  async run(context, args) {
    const { worktree, space, type, name, parent, from, idempotency_key } = inputSchema.parse(args);
    const spaceId = await resolveRepoOrUpstream(context, space);
    const input = {
      name,
      spaceId,
      type,
      ...(parent === undefined ? {} : { parentNodeId: parent }),
      ...(idempotency_key === undefined ? {} : { idempotencyKey: idempotency_key }),
    };
    if (isForkAddress(worktree) && from !== undefined)
      throw workspaceError(
        "workspace-argument-invalid",
        "from needs a Worktree ID, not a fork address. Write once through the fork, then pass the worktree.id from fork_view.",
      );
    const unit = isForkAddress(worktree)
      ? await forkFeature(context).createUnit(worktree, input)
      : await unitFeature(context).create({
          ...input,
          worktreeId: worktree,
          ...(from === undefined ? {} : { fromNodeId: parseNodeReference(from, context.identityOrigin) }),
        });
    const { units } = await unitsWithUrl(context, unit.worktreeId, [unit]);
    return { output: { unit: units[0]! }, repo: spaceId };
  },
};
