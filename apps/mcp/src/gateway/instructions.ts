import type { OpName } from "../shared/executor-protocol.js";
import type { ToolDefinition } from "./tools/definition.js";
import { tools, toolAvailable } from "./tools/registry.js";

// The core Skill's workflow rules, for clients that cannot load Skills.
export function buildServerInstructions(
  selected: readonly ToolDefinition[],
  operations: ReadonlySet<OpName>,
  executorRestricted: boolean,
): string {
  const visible = new Set(selected.map((tool) => tool.name));
  const has = (name: string) => visible.has(name);
  const find = ["space_find", "space_browse"].filter(has);
  const workflow = [
    ...(find.length ? [`Find the file with ${find.join(" or ")}.`] : []),
    ...(has("pr_create")
      ? [
          "Open a pull request with pr_create for each new task; continue an existing pull request only to rework that same task.",
        ]
      : []),
    ...(has("unit_add") ? ["Add existing files to it with unit_add."] : []),
    ...(has("unit_create") ? ["Create new files inside the pull request with unit_create."] : []),
    "Make the change inside the pull request.",
    "Read the result back to verify it before you report success.",
    ...(has("pr_ready") ? ["Mark the pull request ready with pr_ready."] : []),
    "Give the user the pull request link so they can review it.",
    "Leave merging and discarding to the user in the browser, unless they explicitly ask you to do it.",
  ];
  const instructions = [
    "This server operates a Univer Workspace on behalf of the signed-in user. Every change goes through a pull request (a Worktree), never straight into the shared files.",
    ...(executorRestricted
      ? [
          "Editing document contents is not enabled for this account; ask the user to edit in the browser.",
        ]
      : []),
    `Workflow: ${workflow.map((step, index) => `${index + 1}) ${step}`).join(" ")}`,
    "Never mix up spaceId, nodeId, resourceId, unitId, pull request number and Worktree id; take identifiers from tool results, not from display names. Never invent the user, the repository or a confirmed revision.",
    ...(has("api_find") && has("api_show")
      ? ["Before writing Facade API code, look the APIs up with api_find and api_show."]
      : []),
    ...(has("skills_read")
      ? [
          "Read the matching skill first with skills_read: call it without arguments to list the skills, then with name (and full, or resource) to read one. The skills also appear as resources under uvw://skills/. Skill text names uvw commands; the tool with the same name in snake_case does the same thing." +
            (has("pr_create") ? " (uvw pr create is pr_create)." : ""),
        ]
      : []),
    "When a skill names a uvw command with no matching tool in this connection's tool list, that step is not available here; tell the user instead of guessing. Admin tools appear only when the connection URL selects ?toolsets=admin (alone or with other toolsets) or ?toolsets=all.",
    "Creating tools take an idempotency_key: generate one before the first attempt and reuse it when you retry. When a result is too large, repeat the call with the cursor it returned, or narrow the request.",
  ];
  if (!selected.some((tool) => tool.toolset === "files")) {
    const available = new Set(
      tools.filter((tool) => toolAvailable(tool, operations)).map((tool) => tool.name),
    );
    const capabilities = [
      { tools: ["print_pdf"], label: "PDF" },
      { tools: ["compile_markdown", "export_markdown"], label: "Markdown" },
      { tools: ["compile_typst"], label: "Typst" },
      { tools: ["compile_svg"], label: "SVG" },
      { tools: ["html_view_create", "html_view_validate"], label: "HTML View" },
      { tools: ["blob_upload", "blob_download", "blob_get", "blob_replace"], label: "Blob" },
    ]
      .filter((capability) => capability.tools.some((name) => available.has(name)))
      .map(({ label }) => label);
    if (capabilities.length)
      instructions.push(
        `${capabilities.join(", ")} work needs ?toolsets=files (alone or with other toolsets), or ?toolsets=all.`,
      );
  }
  return instructions.join("\n\n");
}
