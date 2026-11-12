import { opSpecs } from "../../../shared/executor-protocol.js";
import { writeAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { z } from "zod";

export const htmlViewReplaceTool = executorTool({
  name: "html_view_replace",
  toolset: "core",
  scope: "write",
  title: "Draft an HTML View revision",
  description:
    "Validate inline HTML against live trunk Sheets and save a revision draft for a .univer.html page, preserving its identity and URL when published. Read it with html_view_read first and pass the exact quoted ETag. The user must open draft.previewUrl in Workspace and click Publish before the revision goes live. Give the user that link and end your turn. Check html_view_draft_get before calling it live or revising it again. Use a new idempotency_key for each revision; reuse identical HTML, ETag and key on retry, including result-unknown. On a stale ETag conflict, read the page again and merge your changes. Whole-document replacement only; no upload IDs or server-local paths.",
  annotations: writeAnnotations,
  inputSchema: z.strictObject({
    resource: opSpecs["htmlView.draft"].input.options[1].shape.resourceId,
    html: opSpecs["htmlView.draft"].input.options[1].shape.html,
    etag: opSpecs["htmlView.draft"].input.options[1].shape.etag,
    idempotency_key: opSpecs["htmlView.draft"].input.options[1].shape.idempotencyKey.describe(IDEMPOTENCY_KEY_DESCRIPTION),
  }),
  op: opSpecs["htmlView.draft"],
  request: (args) => ({
    input: { kind: "replace" as const, resourceId: args.resource, html: args.html, etag: args.etag, idempotencyKey: args.idempotency_key },
  }),
  response: (result, args, context) => {
    context.usage?.addTransfer("upload_bytes", Buffer.byteLength(args.html, "utf8"));
    return { output: result.output };
  },
});
