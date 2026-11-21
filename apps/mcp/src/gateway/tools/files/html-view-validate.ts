import { htmlViewSourceSchema, readHtmlView, htmlViewPullRequestShape, htmlViewWorktree } from "./html-view-support.js";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { readOnlyAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";

export const htmlViewValidateTool = executorTool({
  name: "html_view_validate",
  toolset: "core",
  scope: "read",
  title: "Validate an HTML View",
  description:
    "Optional: check HTML View bindings against live Sheets before saving a draft, without executing JavaScript. html_view_create and html_view_replace already validate and return binding samples, so a separate validation call is unnecessary on the default path. Read the html-view-creator Skill for authoring and context-based style selection. For a Sheet still in a pull request, pass repo and pr to check its data. Compare returned bindings with the intended data. Provide exactly one of html or html_upload_id (a ready html-view upload). HTML is limited to 512 KiB of UTF-8 text.",
  annotations: readOnlyAnnotations,
  inputSchema: htmlViewSourceSchema.safeExtend(htmlViewPullRequestShape),
  op: opSpecs["htmlView.validate"],
  request: async (args, context) => ({ input: { html: await readHtmlView(args, context), ...await htmlViewWorktree(args, context) } }),
});
