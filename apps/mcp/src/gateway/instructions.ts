import type { OpName } from "../shared/executor-protocol.js";
import type { ToolDefinition } from "./tools/definition.js";
import { tools, toolAvailable } from "./tools/registry.js";
import { IDEMPOTENCY_KEY_DESCRIPTION } from "./tools/schemas.js";

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
    ...(has("unit_create") ? ["Create new Units inside the pull request with unit_create."] : []),
    "Make the change inside the pull request.",
    "Read the result back to verify it before you report success.",
    ...(has("pr_ready") ? ["Mark the pull request ready with pr_ready."] : []),
    "Give the user the pull request link so they can review it.",
    "Leave merging and discarding to the user in the browser, unless they explicitly ask you to do it.",
  ];
  const instructions = [
    "This server operates a Univer Workspace on behalf of the signed-in user. Every change to Unit files goes through a pull request (a Worktree), never straight into the shared files.",
    ...(executorRestricted
      ? [
          "Editing document contents is not enabled for this account; ask the user to edit in the browser.",
        ]
      : []),
    `Workflow: ${workflow.map((step, index) => `${index + 1}) ${step}`).join(" ")}`,
    has("html_view_create")
      ? "A page is an HTML View (.univer.html) bound to live Sheets. It is not a Slide, Board or other Unit. HTML View tools publish immediately, outside pull requests; the client may ask the user to approve first. If the user rejects, ask what to change."
      : "This connection cannot publish pages (.univer.html). When asked for one, say so and stop. Never build a Slide, Board or other Unit instead.",
    ...(has("html_view_read") && has("html_view_replace")
      ? ["Revise a page with html_view_read then html_view_replace."]
      : []),
    "Never mix up spaceId, nodeId, resourceId, unitId, pull request number and Worktree id; take identifiers from tool results, not from display names. Never invent the user, the repository or a confirmed revision.",
    ...(has("api_find") && has("api_show")
      ? ["Before writing Facade API code, look the APIs up with api_find and api_show."]
      : []),
    ...(has("skills_read")
      ? [
          "Read skill://univer-workspace/core/SKILL.md first, or call skills_read with name core when the client cannot read resources. The core Skill explains workflows and operation bindings; then load the matching domain Skill.",
        ]
      : []),
    "When a tool named in a Skill is not in this connection's tool list, that step is not available here; tell the user instead of guessing. Admin tools appear only when the connection URL selects ?toolsets=admin (alone or with other toolsets) or ?toolsets=all.",
    `Creating tools take an idempotency_key. ${IDEMPOTENCY_KEY_DESCRIPTION} When a result is too large, repeat the call with the cursor it returned, or narrow the request.`,
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
