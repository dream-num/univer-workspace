import { compileTypstTool } from "./files/compile-typst.js";
import { compileSvgTool } from "./files/compile-svg.js";
import { compileMarkdownTool } from "./files/compile-markdown.js";
import { exportMarkdownTool } from "./files/export-markdown.js";
import { fileUploadCreateTool } from "./core/file-upload-create.js";
import { blobUploadTool } from "./files/blob-upload.js";
import { blobDownloadTool } from "./files/blob-download.js";
import { blobReplaceTool } from "./files/blob-replace.js";
import { htmlViewValidateTool } from "./files/html-view-validate.js";
import { htmlViewCreateTool } from "./files/html-view-create.js";
import { assetDownloadTool } from "./files/asset-download.js";
import { executeTool } from "./core/execute.js";
import { importTool } from "./core/import.js";
import { jobGetTool } from "./core/job-get.js";
import { exportTool } from "./core/export.js";
import { inspectTool } from "./core/inspect.js";
import { whoamiTool } from "./core/whoami.js";
import { repoListTool } from "./core/repo-list.js";
import { repoViewTool } from "./core/repo-view.js";
import { issueCommentTool } from "./core/issue-comment.js";
import { issueCreateTool } from "./core/issue-create.js";
import { issueEditTool } from "./core/issue-edit.js";
import { issueListTool } from "./core/issue-list.js";
import { issueSetStateTool } from "./core/issue-set-state.js";
import { issueViewTool } from "./core/issue-view.js";
import { prListTool } from "./core/pr-list.js";
import { prViewTool } from "./core/pr-view.js";
import { prCreateTool } from "./core/pr-create.js";
import { prEditTool } from "./core/pr-edit.js";
import { prReadyTool } from "./core/pr-ready.js";
import { searchTool } from "./core/search.js";
import { browseTool } from "./core/browse.js";
import { spaceBrowseTool } from "./core/space-browse.js";
import { spaceFindTool } from "./core/space-find.js";
import { unitListTool } from "./core/unit-list.js";
import { unitAddTool } from "./core/unit-add.js";
import { unitCreateTool } from "./core/unit-create.js";
import { apiFindTool } from "./core/api-find.js";
import { apiShowTool } from "./core/api-show.js";
import { skillsReadTool } from "./core/skills-read.js";
import { blobGetTool } from "./files/blob-get.js";
import { repoCreateTool } from "./admin/repo-create.js";
import { repoEditTool } from "./admin/repo-edit.js";
import { labelListTool } from "./admin/label-list.js";
import { labelWriteTool } from "./admin/label-write.js";
import { spaceNodeTool } from "./admin/space-node.js";
import { prMergeTool } from "./admin/pr-merge.js";
import { prDiscardTool } from "./admin/pr-discard.js";
import { resourcesRegistriesTool } from "./admin/resources-registries.js";
import { resourcesFindTool } from "./admin/resources-find.js";
import { resourcesExportTool } from "./admin/resources-export.js";
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
  prListTool,
  prViewTool,
  prCreateTool,
  prEditTool,
  prReadyTool,
  searchTool,
  browseTool,
  spaceBrowseTool,
  spaceFindTool,
  unitListTool,
  unitAddTool,
  unitCreateTool,
  fileUploadCreateTool,
  executeTool,
  inspectTool,
  importTool,
  exportTool,
  jobGetTool,
  apiFindTool,
  apiShowTool,
  skillsReadTool,
  blobGetTool,
  blobUploadTool,
  blobDownloadTool,
  blobReplaceTool,
  assetDownloadTool,
  htmlViewValidateTool,
  htmlViewCreateTool,
  compileMarkdownTool,
  exportMarkdownTool,
  compileTypstTool,
  compileSvgTool,
  repoCreateTool,
  repoEditTool,
  labelListTool,
  labelWriteTool,
  spaceNodeTool,
  prMergeTool,
  prDiscardTool,
  resourcesRegistriesTool,
  resourcesFindTool,
  resourcesExportTool,
];
export const toolsets = ["core", "files", "admin", "all"] as const;

export function selectTools(value: string | null): readonly ToolDefinition[] | undefined {
  const selected = (value ?? "core").split(",");
  if (selected.some((name) => !toolsets.some((valid) => valid === name))) return undefined;
  return tools.filter((tool) => selected.includes("all") || selected.includes(tool.toolset));
}
