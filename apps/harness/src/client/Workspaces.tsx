/**
 * Harness sidebar browsing region.
 *
 * Reads the identity route on mount (returning the per-user workspace, admin
 * flag, and template config), then renders the browser-local session list for
 * THIS user: configured templates (fork-or-open the copy) and the sessions
 * this browser created.
 */
import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import type { UwhMeView, UwhState, UwhTemplate } from "../contract.ts";
import { emptyUwhState } from "../contract.ts";
import type { UwhWorkspacesProps } from "./workspaces-props.ts";
import {
  readLocalState, writeLocalState, recordCreatedSession, recordTemplateFork, templateForkOf,
} from "./local-state.ts";

/** One row to render: a template (forkable) or an owned session id. */
type Row =
  | { kind: "template"; template: UwhTemplate; sessionId: string | undefined }
  | { kind: "session"; sessionId: string };

/** Rows for the current view, browser-local only. */
function rowsOf(state: UwhState | null, templates: UwhTemplate[]): Row[] {
  const base: Row[] = templates.map(template => ({
    kind: "template" as const,
    template,
    sessionId: state === null ? undefined : templateForkOf(state, template.key),
  }));
  const owned = (state?.createdSessionIds ?? []).map(id => ({ kind: "session" as const, sessionId: id }));
  return [...base, ...owned];
}

/** Render the browsing region. */
export function Workspaces({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  loadMe,
  forkTemplate,
  open,
}: UwhWorkspacesProps) {
  const sessions = useSessions(s => s);
  // The workspace baseline is only a liveness/coordination fact here; the list
  // content is browser-local, so we subscribe but render from local state.
  const workspaces = useWorkspaces(s => s);

  const [me, setMe] = useState<UwhMeView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<UwhState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const mounted = useRef(true);

  // Identity + browser-local state, once per mount.
  useEffect(() => {
    mounted.current = true;
    void loadMe().then(view => {
      if (!mounted.current) return;
      setMe(view);
      setState(readLocalState(window.localStorage, view.identity.userId));
    }).catch((reason: unknown) => {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (mounted.current) setLoaded(true);
    });
    return () => { mounted.current = false; };
  }, [loadMe]);

  const persist = useCallback((next: UwhState) => {
    setState(next);
    if (me !== null) writeLocalState(window.localStorage, me.identity.userId, next);
  }, [me]);

  const run = useCallback(async (operation: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const sessionId = await operation();
      if (me !== null) persist(recordCreatedSession(state ?? emptyUwhState(), sessionId));
      open(sessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [busy, me, persist, open, state]);

  const onTemplate = useCallback((template: UwhTemplate) => {
    if (me === null || state === null) return;
    const existing = templateForkOf(state, template.key);
    setBanner(existing === undefined ? "template.forking" : "template.opening");
    void run(async () => existing ?? forkTemplate(template))
      .then(() => { if (mounted.current) setBanner(null); });
  }, [me, state, run, forkTemplate]);

  const sessionListKey = sessions.ids.join("\u0000");
  useEffect(() => {
    if (me === null) return;
    setState(readLocalState(window.localStorage, me.identity.userId));
  }, [me, sessionListKey]);

  const rows = useMemo(() => rowsOf(state, me?.templates ?? []), [state, me]);

  return createElement("div", { className: "uwh-root" },
    !wide && createElement("button", {
      type: "button",
      className: "uwh-collapsedButton",
      "aria-label": "展开会话列表",
      onClick: expandSidebar,
    }, "\u2630"),
    wide && me === null && loaded && createElement("div", { className: "uwh-status" }, error === null ? "正在读取用户信息…" : error),
    wide && me !== null && createElement(Fragment, null,
      createElement("div", { className: "uwh-header" },
        createElement("span", { className: "uwh-title" }, me.identity.username),
        me.admin && createElement("span", { className: "uwh-adminBadge" }, "管理员"),
      ),
      createElement("div", { className: "uwh-workspaceLine" },
        createElement("span", { className: "uwh-workspaceLabel" }, "工作区"),
        createElement("code", { className: "uwh-workspacePath" }, me.workspace.path),
      ),
      banner !== null && createElement("div", { className: "uwh-banner" }, banner === "template.forking" ? "正在从模板派生会话…" : "正在打开会话副本…"),
      error !== null && createElement("div", { className: "uwh-error" }, error),
      createElement("ul", { className: "uwh-list", role: "tree", "aria-label": wide ? "会话与模板列表" : undefined },
        rows.map(row => row.kind === "template"
          ? createElement("li", { key: `t:${row.template.key}`, className: "uwh-row" },
              createElement("div", { className: "uwh-rowMain" },
                createElement("span", { className: "uwh-rowTitle" }, row.template.label ?? row.template.key),
                row.template.description !== undefined
                  && createElement("span", { className: "uwh-rowDesc" }, row.template.description),
              ),
              createElement("button", {
                type: "button",
                className: clsx("uwh-rowButton", row.sessionId === undefined ? "" : ""),
                onClick: () => onTemplate(row.template),
                disabled: busy,
              }, row.sessionId === undefined ? "从模板派生" : "打开副本"),
            )
          : createElement("li", { key: `s:${row.sessionId}`, className: "uwh-row" },
              createElement("button", {
                type: "button",
                className: clsx("uwh-sessionRow", sessions.current === row.sessionId && "uwh-selected"),
                onClick: () => open(row.sessionId),
                disabled: busy,
              },
                createElement("span", { className: "uwh-sessionStatus", "aria-hidden": "true" }),
                createElement("span", { className: "uwh-rowTitle" },
                  sessions.byId[row.sessionId as SessionId]?.displayTitle ?? row.sessionId,
                ),
              ),
            ),
        ),
      ),
      rows.length === 0 && createElement("div", { className: "uwh-empty" }, "暂无本地会话，请使用侧边栏的“新建会话”按钮。"),
    ),
  );
}
