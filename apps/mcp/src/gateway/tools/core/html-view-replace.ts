import { htmlViewPullRequestShape, htmlViewWorktree } from "../files/html-view-support.js";
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
    "Change or restyle a live HTML View by validating inline HTML against live Sheets and saving a revision draft, preserving its identity and URL when published. Read the html-view-creator Skill and html_view_read first; pass the exact quoted ETag. Draft directly without waiting for plan or style approval unless the user requests it. The call returns bindings, bindingCount and truncated when applicable alongside draft; compare the samples with the intended data and fix mismatches. For a Sheet still in a pull request, pass repo and pr; the preview shows its data and the page goes live when the user merges it in Workspace. Otherwise the user opens draft.previewUrl and presses Publish. Give the user that link and end your turn. Check html_view_draft_get before calling it live or revising it again. Use a new idempotency_key for each revision; reuse identical HTML, ETag and key on retry, including result-unknown. On a stale ETag conflict, read the page again and reconcile your changes. Whole-document replacement only; no upload IDs or server-local paths.",
  annotations: writeAnnotations,
  inputSchema: z.strictObject({
    ...htmlViewPullRequestShape,
    resource: opSpecs["htmlView.draft"].input.options[1].shape.resourceId,
    html: opSpecs["htmlView.draft"].input.options[1].shape.html,
    etag: opSpecs["htmlView.draft"].input.options[1].shape.etag,
    idempotency_key: opSpecs["htmlView.draft"].input.options[1].shape.idempotencyKey.describe(IDEMPOTENCY_KEY_DESCRIPTION),
  }),
  op: opSpecs["htmlView.draft"],
  request: async (args, context) => ({
    input: { ...await htmlViewWorktree(args, context), kind: "replace" as const, resourceId: args.resource, html: args.html, etag: args.etag, idempotencyKey: args.idempotency_key },
  }),
  response: (result, args, context) => {
    context.usage?.addTransfer("upload_bytes", Buffer.byteLength(args.html, "utf8"));
    return { output: result.output };
  },
});
