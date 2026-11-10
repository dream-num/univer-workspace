import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { stagingStore } from "./staging-support.js";
const inputSchema = z.object({
  resource: z.string(),
  upload_id: z.string(),
  etag: z.string(),
  idempotency_key: z.string().min(1).describe(IDEMPOTENCY_KEY_DESCRIPTION),
});
export const blobReplaceTool: ToolDefinition = {
  name: "blob_replace",
  toolset: "files",
  scope: "publish",
  title: "Replace an uploaded file",
  description:
    "Replace a Blob immediately, preserving its identity. Supply a ready blob upload_id and the exact quoted ETag from blob_download. Generate an idempotency_key before replacing and reuse the same upload, ETag and key on retry. A stale ETag is refused.",
  inputSchema,
  outputSchema: z.object({
    replacement: z.object({ operationId: z.string(), resourceId: z.string(), etag: z.string() }),
  }),
  annotations: destructiveAnnotations,
  async run(context, args) {
    const input = inputSchema.parse(args);
    const store = stagingStore(context);
    await store.requireUpload(context.user.id, input.upload_id, "blob");
    const feature = new WorkspaceBlobFeature(async () => context.http);
    const view = await feature.get(input.resource);
    const replacement = await store.withUpload(
      context.user.id,
      input.upload_id,
      "blob",
      async (object, path) => {
        const result = await feature.replace({
          resourceId: input.resource,
          filePath: path,
          etag: input.etag,
          idempotencyKey: input.idempotency_key,
        });
        context.usage?.addTransfer("upload_bytes", object.size);
        return result;
      },
    );
    return { output: { replacement }, repo: view.node.spaceId };
  },
};
