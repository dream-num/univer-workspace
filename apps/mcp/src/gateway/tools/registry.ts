import { whoamiTool } from "./core/whoami.js";
import { repoListTool } from "./core/repo-list.js";
import { repoViewTool } from "./core/repo-view.js";
import { issueCommentTool } from "./core/issue-comment.js";
import { issueCreateTool } from "./core/issue-create.js";
import { issueEditTool } from "./core/issue-edit.js";
import { issueListTool } from "./core/issue-list.js";
import { issueSetStateTool } from "./core/issue-set-state.js";
import { issueViewTool } from "./core/issue-view.js";
import type { ToolDefinition } from "./definition.js";

export const tools: readonly ToolDefinition[] = [
  whoamiTool,
  repoListTool,
  repoViewTool,
  issueListTool,
  issueViewTool,
  issueCreateTool,
  issueEditTool,
  issueCommentTool,
  issueSetStateTool,
];
export const toolsets = ["core", "files", "admin", "all"] as const;

export function selectTools(value: string | null): readonly ToolDefinition[] | undefined {
  const selected = (value ?? "core").split(",");
  if (selected.some((name) => !toolsets.some((valid) => valid === name))) return undefined;
  return tools.filter((tool) => selected.includes("all") || selected.includes(tool.toolset));
}
