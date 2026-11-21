import { readWorkspaceHtmlViewDraft } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { htmlViewDraftOutput, htmlViewDraftResult } from "../../../shared/html-view-draft.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const inputSchema = z.object({ draft: z.string().min(1).describe("Draft ID from html_view_save.") });

export const htmlViewDraftGetTool: ToolDefinition = {
  name: "html_view_draft_get",
  toolset: "core",
  scope: "read",
  title: "Read an HTML View draft status",
  description: "Return the current state of an HTML View draft: pending, published, rejected, expired or conflicted. Published drafts include shareUrl, node, resource and etag; other states do not include publication fields.",
  inputSchema,
  outputSchema: htmlViewDraftOutput,
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { draft: id } = inputSchema.parse(args);
    const draft = await readWorkspaceHtmlViewDraft(async () => context.http, context.identityOrigin, id);
    return { output: { draft: htmlViewDraftResult(draft) }, repo: draft.spaceId };
  },
};
