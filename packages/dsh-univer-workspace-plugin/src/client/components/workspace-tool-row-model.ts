/** Pure, replay-stable display model for the keyed Univer tool rows. */
import type { ToolCallBlock } from "@deepseek-ai/dsh-client-runtime/client";

export const WORKSPACE_TOOL_NAMES = [
  "univer_spaces",
  "univer_documents",
  "univer_list",
  "univer_open",
  "univer_status",
  "univer_new",
  "univer_create",
  "univer_worktree",
  "univer_edit",
  "univer_inspect",
  "univer_execute",
  "univer_import",
  "univer_export",
  "univer_unit",
  "univer_api",
  "univer_resources",
] as const;

type WorkspaceToolName = typeof WORKSPACE_TOOL_NAMES[number];
type ToolRowState = "running" | "ok" | "error" | "stopped";

export interface WorkspaceToolRowModel {
  readonly titleKey:
    | "tool.spaces"
    | "tool.documents"
    | "tool.open"
    | "tool.status"
    | "tool.create"
    | "tool.worktree"
    | "tool.edit"
    | "tool.inspect"
    | "tool.execute"
    | "tool.import"
    | "tool.export"
    | "tool.api"
    | "tool.resources";
  readonly summary: string | null;
  readonly summaryKey: "tool.document" | null;
  readonly output: string | null;
  readonly state: ToolRowState;
}

const TITLE_KEYS: Record<WorkspaceToolName, WorkspaceToolRowModel["titleKey"]> = {
  univer_spaces: "tool.spaces",
  univer_documents: "tool.documents",
  univer_list: "tool.documents",
  univer_open: "tool.open",
  univer_status: "tool.status",
  univer_new: "tool.create",
  univer_create: "tool.create",
  univer_worktree: "tool.worktree",
  univer_edit: "tool.edit",
  univer_inspect: "tool.inspect",
  univer_execute: "tool.execute",
  univer_import: "tool.import",
  univer_export: "tool.export",
  univer_unit: "tool.create",
  univer_api: "tool.api",
  univer_resources: "tool.resources",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[0-9a-f]{24,}$/iu;

/** Derive a human row without using opaque Workspace ids as summaries. */
export function workspaceToolRowModel(toolName: string, block: ToolCallBlock): WorkspaceToolRowModel {
  const settled = "kind" in block;
  const args = parseRecord(settled ? block.call?.argsRaw ?? "" : block.argsRaw);
  const output = settled ? resultText(block) : null;
  const result = output === null ? null : parseEmbeddedRecord(output);
  const state: ToolRowState = !settled
    ? "running"
    : block.error?.code === "interrupted"
      ? "stopped"
      : block.isError ? "error" : "ok";
  const name = firstHumanString(result, ["name", "title", "fileName"])
    ?? firstNestedHumanString(result, ["document", "unit", "result"], ["name", "title", "fileName"])
    ?? firstHumanString(args, ["name", "title"]);
  const action = firstHumanString(result, ["action", "operation"])
    ?? firstNestedHumanString(result, ["result"], ["action", "operation"])
    ?? firstHumanString(args, ["action", "mode"]);
  const unitType = firstHumanString(result, ["unitType"])
    ?? firstNestedHumanString(result, ["document", "unit", "result"], ["unitType"])
    ?? firstHumanString(args, ["unitType"]);
  const summary = state === "error"
    ? firstLine(output ?? "")
    : name ?? action ?? unitType;

  return {
    titleKey: TITLE_KEYS[asWorkspaceToolName(toolName)] ?? "tool.status",
    summary,
    summaryKey: summary === null && documentScoped(toolName) ? "tool.document" : null,
    output,
    state,
  };
}

function asWorkspaceToolName(value: string): WorkspaceToolName {
  return WORKSPACE_TOOL_NAMES.includes(value as WorkspaceToolName)
    ? value as WorkspaceToolName
    : "univer_status";
}

function documentScoped(toolName: string): boolean {
  return toolName === "univer_open" || toolName === "univer_status" || toolName === "univer_edit"
    || toolName === "univer_inspect" || toolName === "univer_execute" || toolName === "univer_export";
}

function parseRecord(value: string): Record<string, unknown> | null {
  if (value === "") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseEmbeddedRecord(value: string): Record<string, unknown> | null {
  const start = value.indexOf("{");
  return start === -1 ? null : parseRecord(value.slice(start));
}

function firstNestedHumanString(
  input: Record<string, unknown> | null,
  containers: readonly string[],
  keys: readonly string[],
): string | null {
  if (input === null) return null;
  for (const container of containers) {
    const nested = input[container];
    if (isRecord(nested)) {
      const candidate = firstHumanString(nested, keys);
      if (candidate !== null) return candidate;
    }
  }
  return null;
}

function firstHumanString(input: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (input === null) return null;
  for (const key of keys) {
    const value = input[key];
    if (typeof value !== "string") continue;
    const candidate = firstLine(value).trim();
    if (candidate !== "" && candidate.length <= 120 && !UUID.test(candidate) && !HASH.test(candidate)) return candidate;
  }
  return null;
}

function resultText(block: Extract<ToolCallBlock, { kind: "tool-result" }>): string {
  const parts = block.content.map(item => item.type === "text" ? item.text : JSON.stringify(item));
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`);
  return parts.join("\n");
}

function firstLine(value: string): string {
  const newline = value.indexOf("\n");
  return newline === -1 ? value : value.slice(0, newline);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
