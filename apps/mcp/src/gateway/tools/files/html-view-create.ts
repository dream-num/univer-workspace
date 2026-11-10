import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { htmlViewSourceSchema, readHtmlView } from "./html-view-support.js";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { writeAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { repoInput, resolveRepo } from "../core/issue-support.js";

export const htmlViewCreateTool = executorTool({
  name: "html_view_create",
  toolset: "files",
  scope: "publish",
  title: "Publish an HTML View",
  description:
    "Takes effect immediately, without review. Validate HTML against trunk Sheets, then publish the exact validated bytes as a Blob. Generate an idempotency_key before creation and reuse it with identical HTML and destination on retry, including result-unknown. Provide exactly one of html or html_upload_id (a ready html-view upload). HTML is limited to 512 KiB of UTF-8 text; .univer.html is appended to name if missing.",
  annotations: writeAnnotations,
  inputSchema: htmlViewSourceSchema.safeExtend({
    space: repoInput,
    name: opSpecs["htmlView.create"].input.shape.name,
    parent: opSpecs["htmlView.create"].input.shape.parentNodeId,
    idempotency_key: opSpecs["htmlView.create"].input.shape.idempotencyKey.describe(IDEMPOTENCY_KEY_DESCRIPTION),
  }),
  op: opSpecs["htmlView.create"],
  request: async (args, context) => ({
    input: {
      html: await readHtmlView(args, context),
      name: args.name,
      spaceId: await resolveRepo(context, args.space),
      idempotencyKey: args.idempotency_key,
      ...(args.parent === undefined ? {} : { parentNodeId: args.parent }),
    },
  }),
  response: (result, args, context) => {
    if (args.html !== undefined)
      context.usage?.addTransfer("upload_bytes", Buffer.byteLength(args.html, "utf8"));
    return { output: result.output };
  },
});
