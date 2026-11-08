import { LABEL_COLORS, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { issueLabelSchema } from "../schemas.js";
import { issueFeature, repoInput, resolveRepo } from "../core/issue-support.js";

const inputSchema = z.object({
  repo: repoInput,
  action: z.enum(["create", "edit", "delete"]),
  name: z.string().describe("The label's current name (for create, the new label's name)."),
  new_name: z.string().optional().describe("edit only: the label's new name."),
  color: z.enum(LABEL_COLORS).optional().describe("Required for create; optional for edit."),
  description: z.string().optional().describe("create and edit only."),
});
const invalid = (message: string) => workspaceError("workspace-argument-invalid", message);

export const labelWriteTool: ToolDefinition = {
  name: "label_write",
  toolset: "admin",
  scope: "write",
  title: "Create, edit or delete a label",
  description:
    "Takes effect immediately, without review. Create (needs color), edit (rename, recolor or describe) or delete a repository's Issue label. Delete removes the label from every Issue.",
  inputSchema,
  outputSchema: z.object({ ...issueLabelSchema.partial().shape, deleted: z.string().optional() }),
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, action, name, new_name, color, description } = inputSchema.parse(args);
    if (action !== "edit" && new_name !== undefined)
      throw invalid("new_name applies only to action edit.");
    if (action === "create" && color === undefined)
      throw invalid("color is required for action create.");
    if (action === "delete" && (color !== undefined || description !== undefined)) {
      throw invalid("color and description do not apply to action delete.");
    }
    const spaceId = await resolveRepo(context, repo);
    const feature = issueFeature(context);
    const detail = description === undefined ? {} : { description };
    if (action === "create") {
      return {
        output: await feature.createLabel(spaceId, { name, color: color!, ...detail }),
        repo: spaceId,
      };
    }
    if (action === "edit") {
      return {
        output: await feature.updateLabel(spaceId, name, {
          ...(new_name === undefined ? {} : { name: new_name }),
          ...(color === undefined ? {} : { color }),
          ...detail,
        }),
        repo: spaceId,
      };
    }
    return { output: await feature.deleteLabel(spaceId, name), repo: spaceId };
  },
};
