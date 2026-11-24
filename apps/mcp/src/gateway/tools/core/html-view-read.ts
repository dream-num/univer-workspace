import { readWorkspaceHtmlView, readWorkspaceHtmlViewDraftContent, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { RESULT_LIMIT, resultTooLarge, serializedLength } from "../../paging.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const inputSchema = z.object({
  draft: z.string().min(1).optional().describe("Pending draft ID, your own or one on a pull request you can review. Omit resource. Returns HTML without an etag."),
  resource: z.string().min(1).optional().describe("Resource ID of the .univer.html page to revise."),
});

export const htmlViewReadTool: ToolDefinition = {
  name: "html_view_read",
  toolset: "core",
  scope: "read",
  title: "Read an HTML View page",
  description:
    "Read a .univer.html Blob as inline HTML plus its exact quoted strong ETag. Use its resource as page in html_view_save to revise it. Alternatively pass draft to read a pending draft's HTML without an etag: your own, which you revise with html_view_save draft, or one on a pull request you can review. Pages too large for the inline result are refused; the HTML is never truncated.",
  inputSchema,
  outputSchema: z.union([z.object({ draft: z.string(), space: z.string(), name: z.string(), html: z.string(), previewUrl: z.url() }), z.object({
    resource: z.string(), node: z.string(), space: z.string(), name: z.string(),
    html: z.string(), etag: z.string(), shareUrl: z.url(),
  })]),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { resource, draft } = inputSchema.parse(args);
    if ((resource === undefined) === (draft === undefined))
      throw workspaceError("workspace-argument-invalid", "Provide exactly one of resource or draft.");
    if (draft !== undefined) {
      const page = await readWorkspaceHtmlViewDraftContent(async () => context.http, context.identityOrigin, draft, RESULT_LIMIT - 4_000);
      const output = { draft, space: page.draft.spaceId, name: page.draft.name, html: page.html, previewUrl: page.draft.previewUrl };
      if (serializedLength(output) > RESULT_LIMIT)
        throw resultTooLarge("html_view_read", "The draft is too large to revise inline.");
      context.usage?.addTransfer("export_bytes", Buffer.byteLength(page.html, "utf8"));
      return { output, repo: page.draft.spaceId };
    }
    if (resource === undefined) throw workspaceError("workspace-argument-invalid", "Resource is required.");
    const page = await readWorkspaceHtmlView(async () => context.http, resource, RESULT_LIMIT - 4_000);
    const output = {
      resource: page.resourceId, node: page.nodeId, space: page.spaceId,
      name: page.name, html: page.html, etag: page.etag,
      shareUrl: new URL(`/nodes/${encodeURIComponent(page.nodeId)}?view=immersive`, context.identityOrigin).href,
    };
    if (serializedLength(output) > RESULT_LIMIT)
      throw resultTooLarge("html_view_read", "The page is too large to revise inline.");
    context.usage?.addTransfer("export_bytes", Buffer.byteLength(page.html, "utf8"));
    return { output, repo: page.spaceId };
  },
};
