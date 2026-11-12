import { opSpecs } from "../../../shared/executor-protocol.js";
import { destructiveAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { z } from "zod";

export const htmlViewReplaceTool = executorTool({
  name: "html_view_replace",
  toolset: "core",
  scope: "publish",
  title: "Replace an HTML View page",
  description:
    "Validate inline HTML against live trunk Sheets, then replace a .univer.html Blob immediately outside pull requests, preserving its identity and URL. Read it with html_view_read first and pass the exact quoted ETag. The client may require user approval. Use a new idempotency_key for each revision; reuse identical HTML, ETag and key on retry, including result-unknown. On a stale ETag conflict, read the page again and merge your changes. Whole-document replacement only; no upload IDs or server-local paths.",
  annotations: destructiveAnnotations,
  inputSchema: z.strictObject({
    resource: opSpecs["htmlView.replace"].input.shape.resourceId,
    html: opSpecs["htmlView.replace"].input.shape.html,
    etag: opSpecs["htmlView.replace"].input.shape.etag,
    idempotency_key: opSpecs["htmlView.replace"].input.shape.idempotencyKey.describe(IDEMPOTENCY_KEY_DESCRIPTION),
  }),
  op: opSpecs["htmlView.replace"],
  request: (args) => ({
    input: { resourceId: args.resource, html: args.html, etag: args.etag, idempotencyKey: args.idempotency_key },
  }),
  response: (result, args, context) => {
    context.usage?.addTransfer("upload_bytes", Buffer.byteLength(args.html, "utf8"));
    return { output: result.output };
  },
});
