import { nodeMoveParent, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { nodeSummarySchema, trashBatchSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "../core/issue-support.js";
import { spaceFeature } from "../core/pr-support.js";
import { nodeIdInput, withNodeUrl } from "../core/space-support.js";

const inputSchema = z.object({
  action: z.enum(["create", "rename", "move", "trash"]),
  repo: repoInput.optional().describe("create only: the repository to create the folder in."),
  node: nodeIdInput("the folder or file; rename, move and trash only").optional(),
  name: z.string().optional().describe("create: the new folder's name. rename: the new name."),
  parent: nodeIdInput("the destination folder; create and move only").optional(),
  root: z
    .boolean()
    .optional()
    .describe("move only: move to the repository root instead of a parent."),
});
function required<Value>(value: Value | undefined, field: string, action: string): Value {
  if (value === undefined) {
    throw workspaceError(
      "workspace-argument-invalid",
      `${field} is required for action ${action}.`,
    );
  }
  return value;
}

export const spaceNodeTool: ToolDefinition = {
  name: "space_node",
  toolset: "admin",
  scope: "publish",
  title: "Organize repository files",
  description:
    "Takes effect immediately, without review. Create a folder, rename or move a file or folder (parent or root), or move a whole subtree to Trash (action trash). Files and folders inside a pull request are changed with the unit tools instead. .univer.html pages go through html_view_create / html_view_replace drafts.",
  inputSchema,
  outputSchema: z.object({
    node: nodeSummarySchema.optional(),
    trashBatch: trashBatchSchema.optional(),
  }),
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { action, repo, node, name, parent, root } = inputSchema.parse(args);
    const only = (field: string, value: unknown, actions: readonly string[]) => {
      if (value !== undefined && !actions.includes(action)) {
        throw workspaceError(
          "workspace-argument-invalid",
          `${field} applies only to action ${actions.join(" or ")}.`,
        );
      }
    };
    only("repo", repo, ["create"]);
    only("node", node, ["rename", "move", "trash"]);
    only("root", root, ["move"]);
    only("name", name, ["create", "rename"]);
    only("parent", parent, ["create", "move"]);
    const spaces = spaceFeature(context);
    switch (action) {
      case "create": {
        const spaceId = await resolveRepo(context, required(repo, "repo", action));
        const created = await spaces.createNode({
          name: required(name, "name", action),
          spaceId,
          ...(parent === undefined ? {} : { parentNodeId: parent }),
        });
        return { output: { node: withNodeUrl(context, created) }, repo: spaceId };
      }
      case "rename": {
        const renamed = await spaces.renameNode({
          name: required(name, "name", action),
          nodeId: required(node, "node", action),
        });
        return { output: { node: withNodeUrl(context, renamed) }, repo: renamed.spaceId };
      }
      case "move": {
        const nodeId = required(node, "node", action);
        const parentNodeId = nodeMoveParent({
          ...(parent === undefined ? {} : { parent }),
          ...(root === undefined ? {} : { root }),
        });
        const moved = await spaces.moveNode({ nodeId, parentNodeId });
        return { output: { node: withNodeUrl(context, moved) }, repo: moved.spaceId };
      }
      case "trash": {
        const trashBatch = await spaces.trashNode(required(node, "node", action));
        return { output: { trashBatch }, repo: trashBatch.spaceId };
      }
    }
  },
};
