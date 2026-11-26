import { z } from "zod";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { htmlViewSourceSchema, readHtmlView, htmlViewPullRequestShape, htmlViewWorktree, pendingPageDraft } from "../files/html-view-support.js";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { writeAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { repoInput, resolveRepo } from "./issue-support.js";

const create = opSpecs["htmlView.draft"].input.options[0].shape;
const replace = opSpecs["htmlView.draft"].input.options[1].shape;
const modes = "To create a page, pass space and name. To revise one, pass the page and etag from html_view_read. For a pending draft, pass draft instead.";

export const htmlViewSaveTool = executorTool({
  name: "html_view_save",
  toolset: "core",
  scope: "write",
  title: "Save an HTML View draft",
  description:
    "Save a shareable live page (HTML View, .univer.html) on Workspace Sheet data as a draft. Use it for a page, dashboard, report or form that shares or presents Workspace data; prefer it over a local .html unless the user asks for a file. For authoring, read the html-view-creator Skill. To create a page, pass space and name, plus optional parent; .univer.html is appended if missing. To revise or restyle, pass page (the resource from html_view_read) and its exact quoted etag; publishing preserves the page identity and URL. For a pending draft, pass draft to supersede it, inheriting its destination and source PR unless worktree, or repo and pr, override it. Provide exactly one of draft, page or space; etag is only for revisions. Pass inline html by default. Use html_upload_id (a ready html-view upload) only when the HTML is too large for one call. Exactly one of html or html_upload_id is required; HTML is limited to 512 KiB of UTF-8 text. Every save needs idempotency_key; reuse it only for identical retries, including result-unknown. A stale ETag is refused. Optional worktree, or repo and pr, attach the draft to a pull request: the page reads its data, and its merge publishes the draft. A fork address as worktree names the fork's pull request, which a save opens on a clean fork. With worktree, page and the etag from html_view_read with the same worktree revise your pending draft of that page. A ready pull request takes no new or revised drafts; use pr_ready with undo: true first. A pull request holds at most 20 pending drafts. In a Team repo's pull request you may draft its pages with read access; whoever merges needs edit access. dryRun: true only checks the HTML and bindings before saving and creates no draft. It needs html or html_upload_id, and no destination or key. It reads the data the save would read, so pass the save's worktree, or repo and pr, too, including the pull request a superseded draft inherits: without them it reads merged data, where a Sheet that exists only in a pull request is unavailable. It returns {dryRun, valid, bindings, bindingCount, truncated?}. The call validates bindings and returns {draft, bindings, bindingCount, truncated?}. draft includes previewUrl and access details. draft.publishWhen says how a pending draft goes live: merge, when whoever merges the pull request publishes it, or publish, when the user publishes it. html_view_draft_get reports its current state and returns shareUrl only once published.",
  annotations: writeAnnotations,
  inputSchema: htmlViewSourceSchema.safeExtend({
    ...htmlViewPullRequestShape,
    space: repoInput.optional().describe("New page destination. Required with name; omit for revisions."),
    name: create.name.optional().describe("New page name. Required with space; omit for revisions."),
    parent: create.parentNodeId.describe("Optional parent Node for a new page."),
    draft: z.string().min(1).optional().describe("Pending draft ID to revise. Omit space, page, name, parent and etag; read its HTML with html_view_read draft if needed."),
    page: replace.resourceId.optional().describe("For revisions: the resource returned by html_view_read. Omit space, name and parent."),
    etag: replace.etag.optional().describe("For revisions only: the exact quoted etag from html_view_read."),
    idempotency_key: create.idempotencyKey.optional().describe(IDEMPOTENCY_KEY_DESCRIPTION),
    dryRun: z.boolean().optional().describe("Validate the HTML and its bindings and return samples without creating a draft."),
  }).strict(),
  op: opSpecs["htmlView.draft"],
  request: async (args, context) => {
    if (args.dryRun === true)
      return { input: { kind: "dryRun" as const, ...await htmlViewWorktree(args, context, false), html: await readHtmlView(args, context) } };
    if (args.idempotency_key === undefined)
      throw workspaceError("workspace-argument-invalid", "idempotency_key is required unless dryRun is true.");
    if ([args.draft, args.page, args.space].filter((value) => value !== undefined).length !== 1)
      throw workspaceError("workspace-argument-invalid", `Provide exactly one of draft, page or space. ${modes}`);
    if (args.draft !== undefined && (args.etag !== undefined || args.name !== undefined || args.parent !== undefined))
      throw workspaceError("workspace-argument-invalid", `Pending draft revisions omit etag, name and parent. ${modes}`);
    if (args.page !== undefined && (args.etag === undefined || args.name !== undefined || args.parent !== undefined))
      throw workspaceError("workspace-argument-invalid", `Revisions require etag and omit name and parent. ${modes}`);
    if (args.space !== undefined && (args.name === undefined || args.etag !== undefined))
      throw workspaceError("workspace-argument-invalid", `New pages require name and omit etag. ${modes}`);
    const html = await readHtmlView(args, context);
    const spaceId = args.space === undefined ? undefined : await resolveRepo(context, repoInput.parse(args.space));
    const scope = await htmlViewWorktree(args, context, true);
    const shared = { ...scope, html, idempotencyKey: args.idempotency_key };
    if (args.page !== undefined) {
      const etag = replace.etag.parse(args.etag);
      // Through worktree a page has one pending draft of yours, so saving the page again revises it.
      const pending = args.worktree === undefined || scope.sourceWorktreeId === undefined
        ? undefined : await pendingPageDraft(context, scope.sourceWorktreeId, args.page);
      return {
        input: pending?.baseEtag === etag
          ? { ...shared, kind: "revise" as const, draftId: pending.id }
          : { ...shared, kind: "replace" as const, resourceId: args.page, etag },
      };
    }
    return {
      input: args.draft !== undefined
        ? { ...shared, kind: "revise" as const, draftId: args.draft }
        : { ...shared, kind: "create" as const, spaceId: spaceId!,
            name: create.name.parse(args.name), ...(args.parent === undefined ? {} : { parentNodeId: args.parent }) },
    };
  },
  response: (result, args, context) => {
    if (args.html !== undefined)
      context.usage?.addTransfer("upload_bytes", Buffer.byteLength(args.html, "utf8"));
    return { output: result.output };
  },
});
