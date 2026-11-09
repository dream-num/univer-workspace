import { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { blobResourceSchema, nodeSummarySchema } from "../schemas.js";
import { withNodeUrl } from "../core/space-support.js";

const inputSchema = z.object({
  resource: z
    .string()
    .describe("Resource ID of the uploaded file, from space_browse or space_find."),
});
export const blobGetTool: ToolDefinition = {
  name: "blob_get",
  toolset: "files",
  scope: "read",
  title: "Get uploaded file details",
  description:
    "Show an uploaded file's (Blob's) name, size, media type and availability. It does not return the file's bytes.",
  inputSchema,
  outputSchema: z.object({ node: nodeSummarySchema, resource: blobResourceSchema }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { resource } = inputSchema.parse(args);
    const found = await new WorkspaceBlobFeature(async () => context.http).get(resource);
    return {
      output: { node: withNodeUrl(context, found.node), resource: found.resource },
      repo: found.node.spaceId,
    };
  },
};
