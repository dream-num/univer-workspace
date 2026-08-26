/**
 * The Space picker for the blank-session hero (and future sidebar surfaces).
 *
 * Reads the current User's Spaces from the harness browser API and lets the
 * User pick one; picking a Space hands its backing dsh workspace id to the
 * shell's `onPick`, which starts or switches the session in that workspace.
 * The directory is an invisible mechanical carrier — the User only ever sees
 * the Univer Workspace Space.
 */
import { createElement, Fragment, useEffect, useState } from "react";
import type { WorkspaceId } from "@deepseek-ai/dsh-client-runtime/client";
import type { EmptyWorkspaceOwnerProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { WorkspaceSpace } from "../shared/wire.ts";

const SPACES_PATH = "/univer-workspace/api/spaces";
const LOGIN_PATH = "/auth/login";

/** Read the current User's Spaces. */
async function fetchSpaces(): Promise<readonly WorkspaceSpace[]> {
  const response = await fetch(SPACES_PATH, { headers: { accept: "application/json" } });
  if (response.status === 401) {
    window.location.assign(LOGIN_PATH);
    throw new Error("not authenticated");
  }
  if (!response.ok) throw new Error(`space list answered ${response.status}`);
  const body = (await response.json()) as { spaces?: unknown };
  if (!Array.isArray(body.spaces)) throw new Error("space list returned an unexpected payload");
  return body.spaces as WorkspaceSpace[];
}

/** Render the Space picker inside the blank-session hero. */
export function SpacePicker({ open, selectedId, onPick }: EmptyWorkspaceOwnerProps) {
  const [spaces, setSpaces] = useState<readonly WorkspaceSpace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    void fetchSpaces()
      .then(result => { if (live) setSpaces(result); })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [open]);

  if (!open) return null;

  return createElement("div", { className: "uws-space-picker" },
    !loaded && createElement("div", { className: "uws-space-status" }, "正在读取空间…"),
    error !== null && createElement("div", { className: "uws-space-error" }, error),
    loaded && spaces.map(space => createElement("button", {
      key: space.spaceId,
      type: "button",
      className: selectedId === (space.dshWorkspaceId as WorkspaceId) ? "uws-space-row uws-space-selected" : "uws-space-row",
      onClick: () => onPick(space.dshWorkspaceId as WorkspaceId),
    },
      createElement(Fragment, null,
        createElement("span", { className: "uws-space-name" }, space.name),
        createElement("span", { className: "uws-space-meta" }, space.type === "team" ? "团队空间" : "个人空间"),
      ),
    )),
    loaded && spaces.length === 0 && createElement("div", { className: "uws-space-empty" }, "暂无可用空间"),
  );
}
