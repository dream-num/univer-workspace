import { WorkspaceBlobFeature, nodeUrl } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { blobResourceSchema, nodeSummarySchema } from "../schemas.js";
import { resolveRepo, repoInput } from "../core/issue-support.js";
import { stagingStore } from "./staging-support.js";
const inputSchema = z.object({
  upload_id: z.string(),
  space: repoInput,
  parent: z.string().optional(),
  name: z.string(),
  media_type: z.string().optional(),
  idempotency_key: z.string().min(1),
});
export const blobUploadTool: ToolDefinition = {
  name: "blob_upload",
  toolset: "files",
  scope: "publish",
  title: "Publish an uploaded file",
  description:
    "Publish a ready upload with purpose blob directly into a repository. Generate an idempotency_key before creating and reuse it with the same upload_id on retry. Uploads remain usable for one hour after reservation.",
  inputSchema,
  outputSchema: z.object({
    upload: z.object({
      idempotencyKey: z.string(),
      uploadId: z.string(),
      operationId: z.string(),
      nodeId: z.string(),
      resourceId: z.string(),
      name: z.string(),
      originalFilename: z.string(),
      byteSize: z.number(),
      mediaType: z.string(),
      availability: z.string(),
      node: nodeSummarySchema,
      resource: blobResourceSchema,
      url: z.url(),
    }),
  }),
  annotations: writeAnnotations,
  async run(context, args) {
    const input = inputSchema.parse(args);
    const store = stagingStore(context);
    await store.requireUpload(context.user.id, input.upload_id, "blob");
    const spaceId = await resolveRepo(context, input.space);
    const upload = await store.withUpload(
      context.user.id,
      input.upload_id,
      "blob",
      async (object, path) => {
        context.usage?.addTransfer("upload_bytes", object.size);
        return new WorkspaceBlobFeature(async () => context.http).upload({
          filePath: path,
          fileName: object.fileName,
          spaceId,
          name: input.name,
          declaredMediaType: input.media_type ?? object.mediaType,
          idempotencyKey: input.idempotency_key,
          ...(input.parent === undefined ? {} : { parentNodeId: input.parent }),
        });
      },
    );
    const node = nodeSummarySchema.omit({ url: true }).parse(upload["node"]);
    const url = nodeUrl(context.identityOrigin, node.nodeId);
    return {
      output: { upload: { ...upload, node: { ...node, url }, url } },
      repo: spaceId,
    };
  },
};
