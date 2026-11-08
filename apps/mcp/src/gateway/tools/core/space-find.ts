import { assertSpaceFilter } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { nodeSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "./issue-support.js";
import { spaceFeature } from "./pr-support.js";
import { resourceKindInput, unitTypeInput, withNodeUrl } from "./space-support.js";

const inputSchema = z.object({
  space: repoInput,
  query: z.string().describe("Part of the file name; case-insensitive."),
  resource_kind: resourceKindInput.optional(),
  unit_type: unitTypeInput.optional(),
});
export const spaceFindTool: ToolDefinition = {
  name: "space_find",
  toolset: "core",
  scope: "read",
  title: "Find files by name",
  description:
    "Find files and folders (Nodes) whose name contains the query anywhere in a repository. Look here first before creating a new file.",
  inputSchema,
  outputSchema: z.object({ nodes: z.array(nodeSchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { space, query, resource_kind, unit_type } = inputSchema.parse(args);
    assertSpaceFilter({
      ...(resource_kind === undefined ? {} : { resourceKind: resource_kind }),
      ...(unit_type === undefined ? {} : { unitType: unit_type }),
    });
    const spaceId = await resolveRepo(context, space);
    const nodes = await spaceFeature(context).find({
      query,
      spaceId,
      ...(resource_kind === undefined ? {} : { resourceKind: resource_kind }),
      ...(unit_type === undefined ? {} : { unitType: unit_type }),
    });
    return { output: { nodes: nodes.map((node) => withNodeUrl(context, node)) }, repo: spaceId };
  },
};
