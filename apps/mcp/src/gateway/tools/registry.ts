import { whoamiTool } from "./core/whoami.js";
import { repoListTool } from "./core/repo-list.js";
import { repoViewTool } from "./core/repo-view.js";
import type { ToolDefinition } from "./definition.js";

export const tools: readonly ToolDefinition[] = [whoamiTool, repoListTool, repoViewTool];
export const toolsets = ["core", "files", "admin", "all"] as const;

export function selectTools(value: string | null): readonly ToolDefinition[] | undefined {
  const selected = (value ?? "core").split(",");
  if (selected.some((name) => !toolsets.some((valid) => valid === name))) return undefined;
  return tools.filter((tool) => selected.includes("all") || selected.includes(tool.toolset));
}
