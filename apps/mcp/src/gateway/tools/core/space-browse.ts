import { assertSpaceFilter } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { nodeSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "./issue-support.js";
import { spaceFeature } from "./pr-support.js";
import { nodeIdInput, resourceKindInput, unitTypeInput, withNodeUrl } from "./space-support.js";

const inputSchema = z.object({
  repo: repoInput,
  parent: nodeIdInput("the folder to list; omit for the repository root").optional(),
  recursive: z.boolean().optional().describe("Include every descendant."),
  resource_kind: resourceKindInput.optional(),
  unit_type: unitTypeInput.optional(),
});
export const spaceBrowseTool: ToolDefinition = {
  name: "space_browse",
  toolset: "core",
  scope: "read",
  title: "Browse repository files",
  description:
    "List the files and folders (Nodes) of a repository, one directory or recursively, optionally only documents of one type. Each Node has a nodeId and a resource with the resourceId that unit_add, blob_get and issues take.",
  inputSchema,
  outputSchema: z.object({ nodes: z.array(nodeSchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo, parent, recursive, resource_kind, unit_type } = inputSchema.parse(args);
    assertSpaceFilter({
      ...(resource_kind === undefined ? {} : { resourceKind: resource_kind }),
      ...(unit_type === undefined ? {} : { unitType: unit_type }),
    });
    const spaceId = await resolveRepo(context, repo);
    const nodes = await spaceFeature(context).browse({
      spaceId,
      ...(resource_kind === undefined ? {} : { resourceKind: resource_kind }),
      ...(unit_type === undefined ? {} : { unitType: unit_type }),
      ...(parent === undefined ? {} : { parentNodeId: parent }),
      ...(recursive === true ? { recursive: true } : {}),
    });
    return { output: { nodes: nodes.map((node) => withNodeUrl(context, node)) }, repo: spaceId };
  },
};
