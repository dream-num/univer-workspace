/**
 * Plugin-owned Tool row for the `univer_*` tools.
 *
 * DSH's generic fallback intentionally derives its summary from raw arguments.
 * Remote Workspace arguments are opaque ids, so that fallback exposes UUIDs in
 * the transcript even when the Host supplies a human `presentCall` title.  The
 * keyed `tool.call.toolview` slot is the public seam for owning that display.
 */
import * as React from "react";
import type { ToolCallBlock } from "../dsh-runtime-types.ts";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { workspaceToolRowModel } from "./workspace-tool-row-model.ts";

export { WORKSPACE_TOOL_NAMES } from "./workspace-tool-row-model.ts";

/** Owner payload supplied by DSH's keyed Tool view slot. */
export interface WorkspaceToolCallOwnerProps {
  readonly callId: string;
  readonly toolName: string;
  readonly block: ToolCallBlock;
  readonly cwd?: string;
  readonly home?: string;
  readonly openFile: (path: string) => void;
  readonly inspect?: () => void;
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "tool.call.toolview": {
      kind: "keyed";
      scope: "session";
      owner: WorkspaceToolCallOwnerProps;
    };
  }
}

type WorkspaceToolRowProps = PropsRuntime<"tool.call.toolview"> & PropsLocale<"univer">;

/** Render one replay-stable Univer tool call without exposing opaque ids. */
export function WorkspaceToolRow(props: WorkspaceToolRowProps): React.ReactElement {
  const model = workspaceToolRowModel(props.toolName, props.block);
  const [expanded, setExpanded] = React.useState(false);
  const expandable = model.output !== null;
  const open = expandable && expanded;
  const statusKey =
    model.state === "running"
      ? "tool.running"
      : model.state === "error"
        ? "tool.failed"
        : model.state === "stopped"
          ? "tool.stopped"
          : null;

  const summary = model.summary ?? (model.summaryKey === null ? "" : props.t(model.summaryKey));

  return (
    <div className="uvf_toolCall" data-tool={props.toolName} data-state={model.state}>
      <button
        type="button"
        className="uvf_toolCallRow"
        aria-expanded={expandable ? open : undefined}
        onClick={expandable ? () => setExpanded((value) => !value) : undefined}
      >
        <span className="uvf_toolCallLeading" aria-hidden="true">
          <span className="uvf_toolCallState" />
          <ToolIcon />
        </span>
        {statusKey === null ? null : <span className="uvf_srOnly">{props.t(statusKey)}</span>}
        <span className="uvf_toolCallTitle">{props.t(model.titleKey)}</span>
        {summary === "" ? null : (
          <>
            <span className="uvf_toolCallSeparator" aria-hidden="true" />
            <span className="uvf_toolCallSummary">{summary}</span>
          </>
        )}
        {expandable ? <ChevronIcon open={open} /> : null}
      </button>
      {open ? (
        <div className="uvf_toolCallBody">
          <pre>{model.output}</pre>
          {props.inspect === undefined ? null : (
            <button type="button" onClick={props.inspect}>
              {props.t("tool.inspectCall")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ToolIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" />
    </svg>
  );
}

function ChevronIcon(props: { readonly open: boolean }): React.ReactElement {
  return (
    <svg
      className="uvf_toolCallChevron"
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-open={props.open || undefined}
    >
      <path d="m5 6 3 3 3-3" />
    </svg>
  );
}
