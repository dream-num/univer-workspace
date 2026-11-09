import { opSpecs } from "../../../shared/executor-protocol.js";
import { readOnlyAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";

export const htmlViewValidateTool = executorTool({
  name: "html_view_validate",
  toolset: "files",
  scope: "read",
  title: "Validate an HTML View",
  description:
    "Check HTML bindings against trunk Sheets without executing JavaScript. HTML is limited to 512 KiB of UTF-8 text.",
  annotations: readOnlyAnnotations,
  inputSchema: opSpecs["htmlView.validate"].input,
  op: opSpecs["htmlView.validate"],
  request: (input) => ({ input }),
});
