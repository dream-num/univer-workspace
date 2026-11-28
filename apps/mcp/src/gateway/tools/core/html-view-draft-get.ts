import { readWorkspaceHtmlViewDraft } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { htmlViewDraftOutput, htmlViewDraftResult } from "../../../shared/html-view-draft.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { publishedHtmlViewAccess } from "../files/html-view-support.js";

const inputSchema = z.object({ draft: z.string().min(1).describe("Draft ID from html_view_save.") });

export const htmlViewDraftGetTool: ToolDefinition = {
  name: "html_view_draft_get",
  toolset: "core",
  scope: "read",
  title: "Read an HTML View draft status",
  description: "Return the current state of an HTML View draft: pending, published, rejected, expired, conflicted or superseded. Pending drafts include publishWhen: merge means the pull request's merge publishes it as the merger, and a page whose author cannot publish it alone needs a person to merge in Workspace; publish requires the user to open the preview and press Publish. Superseded drafts include supersededBy and successorUrl. Published drafts include shareUrl, node, resource, etag, access and (for an unclaimed agent) handoffUrl and handoffExpiresAt; these fields appear only when published.",
  inputSchema,
  outputSchema: htmlViewDraftOutput,
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { draft: id } = inputSchema.parse(args);
    const draft = await readWorkspaceHtmlViewDraft(async () => context.http, context.identityOrigin, id);
    const summary = htmlViewDraftResult(draft);
    if (draft.status.state !== "published") return { output: { draft: summary }, repo: draft.spaceId };
    return {
      output: { draft: { ...summary, ...await publishedHtmlViewAccess(context, draft.status.nodeId) } },
      repo: draft.spaceId,
    };
  },
};
