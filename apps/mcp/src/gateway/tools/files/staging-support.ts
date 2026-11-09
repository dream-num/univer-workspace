import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import type { ToolContext } from "../definition.js";
export function stagingStore(context: ToolContext) {
  if (!context.staging)
    throw workspaceError("workspace-staging-unavailable", "File staging is not configured.");
  return context.staging;
}
