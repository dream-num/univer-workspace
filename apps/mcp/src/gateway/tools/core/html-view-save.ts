import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { htmlViewSourceSchema, readHtmlView, htmlViewPullRequestShape, htmlViewWorktree } from "../files/html-view-support.js";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { writeAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { repoInput, resolveRepo } from "./issue-support.js";

const create = opSpecs["htmlView.draft"].input.options[0].shape;
const replace = opSpecs["htmlView.draft"].input.options[1].shape;
const modes = "To create a page, pass space and name. To revise one, pass the page and etag from html_view_read.";

export const htmlViewSaveTool = executorTool({
  name: "html_view_save",
  toolset: "core",
  scope: "write",
  title: "Save an HTML View draft",
  description:
    "Save a shareable live page (HTML View, .univer.html) on Workspace Sheet data as a draft. Use it for a page, dashboard, report or form that shares or presents Workspace data; prefer it over a local .html unless the user asks for a file. For authoring, read the html-view-creator Skill. To create a page, pass space and name, plus optional parent; .univer.html is appended if missing. To revise or restyle, pass page (the resource from html_view_read) and its exact quoted etag; publishing preserves the page identity and URL. Provide exactly one of page or space; etag is only for revisions. Pass inline html by default. Use html_upload_id (a ready html-view upload) only when the HTML is too large for one call. Exactly one of html or html_upload_id is required; HTML is limited to 512 KiB of UTF-8 text. Every save needs idempotency_key; reuse it only for identical retries, including result-unknown. A stale ETag is refused. Optional repo and pr select source pull request data. The call validates bindings and returns {draft, bindings, bindingCount, truncated?}. draft includes previewUrl and access details. A PR-linked draft goes live when the user merges in Workspace; otherwise the user opens the preview and presses Publish. html_view_draft_get reports its current state and returns shareUrl only once published.",
  annotations: writeAnnotations,
  inputSchema: htmlViewSourceSchema.safeExtend({
    ...htmlViewPullRequestShape,
    space: repoInput.optional().describe("New page destination. Required with name; omit for revisions."),
    name: create.name.optional().describe("New page name. Required with space; omit for revisions."),
    parent: create.parentNodeId.describe("Optional parent Node for a new page."),
    page: replace.resourceId.optional().describe("For revisions: the resource returned by html_view_read. Omit space, name and parent."),
    etag: replace.etag.optional().describe("For revisions only: the exact quoted etag from html_view_read."),
    idempotency_key: create.idempotencyKey.describe(IDEMPOTENCY_KEY_DESCRIPTION),
  }).strict(),
  op: opSpecs["htmlView.draft"],
  request: async (args, context) => {
    if ((args.page === undefined) === (args.space === undefined))
      throw workspaceError("workspace-argument-invalid", `Provide exactly one of page or space. ${modes}`);
    if (args.page !== undefined && (args.etag === undefined || args.name !== undefined || args.parent !== undefined))
      throw workspaceError("workspace-argument-invalid", `Revisions require etag and omit name and parent. ${modes}`);
    if (args.space !== undefined && (args.name === undefined || args.etag !== undefined))
      throw workspaceError("workspace-argument-invalid", `New pages require name and omit etag. ${modes}`);
    const shared = {
      ...await htmlViewWorktree(args, context),
      html: await readHtmlView(args, context),
      idempotencyKey: args.idempotency_key,
    };
    return {
      input: args.page !== undefined
        ? { ...shared, kind: "replace" as const, resourceId: args.page, etag: replace.etag.parse(args.etag) }
        : { ...shared, kind: "create" as const, spaceId: await resolveRepo(context, repoInput.parse(args.space)),
            name: create.name.parse(args.name), ...(args.parent === undefined ? {} : { parentNodeId: args.parent }) },
    };
  },
  response: (result, args, context) => {
    if (args.html !== undefined)
      context.usage?.addTransfer("upload_bytes", Buffer.byteLength(args.html, "utf8"));
    return { output: result.output };
  },
});
