import { htmlViewSourceSchema, readHtmlView } from "./html-view-support.js";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { readOnlyAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";

export const htmlViewValidateTool = executorTool({
  name: "html_view_validate",
  toolset: "files",
  scope: "read",
  title: "Validate an HTML View",
  description:
    "Check HTML bindings against trunk Sheets without executing JavaScript. Provide exactly one of html or html_upload_id (a ready html-view upload). HTML is limited to 512 KiB of UTF-8 text.",
  annotations: readOnlyAnnotations,
  inputSchema: htmlViewSourceSchema,
  op: opSpecs["htmlView.validate"],
  request: async (args, context) => ({ input: { html: await readHtmlView(args, context) } }),
});
