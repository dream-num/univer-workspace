import { htmlViewSourceSchema, readHtmlView } from "./html-view-support.js";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { readOnlyAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";

export const htmlViewValidateTool = executorTool({
  name: "html_view_validate",
  toolset: "core",
  scope: "read",
  title: "Validate an HTML View",
  description:
    "Read the html-view-creator Skill first. Read the source Sheet, propose the page plan and, unless already named, a style in your reply, and wait; default to night-gauge (Night Gauge) only when the user leaves it to you. Start from its template. Check HTML bindings against trunk Sheets without executing JavaScript. Provide exactly one of html or html_upload_id (a ready html-view upload). HTML is limited to 512 KiB of UTF-8 text.",
  annotations: readOnlyAnnotations,
  inputSchema: htmlViewSourceSchema,
  op: opSpecs["htmlView.validate"],
  request: async (args, context) => ({ input: { html: await readHtmlView(args, context) } }),
});
