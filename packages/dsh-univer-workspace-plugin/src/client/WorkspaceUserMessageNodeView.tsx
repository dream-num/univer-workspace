import { pathReferenceFromUrl } from "./path-reference.ts";
import { UnitTypeIcon } from "./components/worktree-review/unit-markers.tsx";
import type { ChatNodeViewProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { ContentBlock } from "@deepseek-ai/dsh-llm/types";
import type { ReactNode } from "react";
import { useState } from "react";
import { CheckIcon, CopyIcon, FolderIcon } from "@univerjs/univer-workspace-ui";
import { projectWorkspaceResourceMessageText } from "./workspace-resource-reference.ts";
import styles from "./WorkspaceUserMessageNodeView.module.scss";

/**
 * Keep the stock DSH user bubble while hiding Workspace wire metadata from
 * people. The node remains authoritative and immutable; only the render copy
 * is projected to the native dsh-session display form.
 */
export function WorkspaceUserMessageNodeView(
  props: ChatNodeViewProps<"user" | "steering"> & {
    readonly onOpenResource: (resourceId: string) => Promise<void>;
  },
): JSX.Element {
  const [copied, setCopied] = useState(false);
  const content = props.node.data.content as readonly ContentBlock[];
  const text = content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
  const displayText = projectWorkspaceResourceMessageText(text);
  const rest = content.filter((block) => block.type !== "text" && block.type !== "image");
  const copy = () => {
    if (copied) return;
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return;
    void clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    });
  };

  return (
    <div className={styles.userRow} data-chat-flow-kind={props.node.kind}>
      <div className={styles.userStack}>
        {(displayText !== "" || rest.length > 0) && (
          <div className={styles.bubble}>
            {renderDisplayText(displayText, props.onOpenResource)}
            {rest.map((block, index) => (
              <pre key={index}>{JSON.stringify(block)}</pre>
            ))}
          </div>
        )}
        <div className={styles.actions}>
          <time dateTime={new Date(props.node.data.time ?? Date.now()).toISOString()}>
            {new Date(props.node.data.time ?? Date.now()).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          <button type="button" aria-label={copied ? "Copied" : "Copy"} onClick={copy}>
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Render only the human-facing label of a projected Workspace reference.
 *
 * The DSH primitive `projectUserText` is intentionally not used here: the
 * Harness profile currently composes the alpha primitives package with the
 * rc chat package, and returning a JSX value created by that other React
 * runtime can crash the public `conversation.chat.node` slot. This local
 * projection is deliberately presentation-only; the logged message and its
 * wire reference remain unchanged.
 */
function renderDisplayText(
  text: string,
  onOpenResource: (resourceId: string) => Promise<void>,
): ReactNode {
  const reference =
    /@\[((?:\\.|[^\]\n])+)\]\((?:dsh-session:)?(univer-(?:workspace-resource|workspace-folder|local-path):[^\s)]+)\)/gu;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(reference)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push(text.slice(cursor, start));
    const label = match[1]?.replaceAll(/\\([\\\]])/g, "$1");
    const target = match[2];
    let node: ReactNode = match[0];
    if (label !== undefined && target !== undefined) {
      try {
        const url = new URL(target);
        if (url.protocol === "univer-workspace-resource:")
          node = (
            <ResourceReference
              key={`workspace-reference-${index}`}
              label={label}
              resourceId={decodeURIComponent(url.pathname)}
              unitType={url.searchParams.get("unitType") ?? ""}
              onOpen={onOpenResource}
            />
          );
        else {
          const value = pathReferenceFromUrl(target, label);
          if (value !== undefined)
            node = (
              <span
                key={`path-reference-${index}`}
                className={styles.reference}
                title={"path" in value ? value.path : `Workspace folder: ${value.name}`}
              >
                {value.kind === "local-file" ? (
                  <UnitTypeIcon type={localUnitType(value.path)} />
                ) : (
                  <FolderIcon />
                )}
                <span>{label}</span>
              </span>
            );
        }
      } catch {
        /* Malformed historical references remain readable text. */
      }
    }
    parts.push(node);
    index++;
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function ResourceReference(props: {
  readonly label: string;
  readonly resourceId: string;
  readonly unitType: string;
  readonly onOpen: (resourceId: string) => Promise<void>;
}): JSX.Element {
  const [opening, setOpening] = useState(false);
  return (
    <button
      type="button"
      className={styles.reference}
      title={props.label}
      aria-busy={opening}
      disabled={opening}
      onClick={() => {
        setOpening(true);
        void props.onOpen(props.resourceId).finally(() => setOpening(false));
      }}
    >
      <UnitTypeIcon type={props.unitType} />
      <span>{props.label}</span>
    </button>
  );
}

function localUnitType(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (["xlsx", "xls", "csv", "ods"].includes(extension)) return "sheet";
  if (["docx", "doc", "odt", "txt", "md"].includes(extension)) return "doc";
  if (["pptx", "ppt", "odp"].includes(extension)) return "slide";
  return "";
}
