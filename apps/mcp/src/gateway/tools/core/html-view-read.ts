import { readWorkspaceHtmlView } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { RESULT_LIMIT, resultTooLarge, serializedLength } from "../../paging.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const inputSchema = z.object({
  resource: z.string().min(1).describe("Resource ID of the .univer.html page to revise."),
});

export const htmlViewReadTool: ToolDefinition = {
  name: "html_view_read",
  toolset: "core",
  scope: "read",
  title: "Read an HTML View page",
  description:
    "Read a .univer.html Blob as inline HTML plus its exact quoted strong ETag. Use html_view_replace to revise it. Pages too large for the inline result are refused; the HTML is never truncated.",
  inputSchema,
  outputSchema: z.object({
    resource: z.string(), node: z.string(), space: z.string(), name: z.string(),
    html: z.string(), etag: z.string(), shareUrl: z.url(),
  }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { resource } = inputSchema.parse(args);
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
