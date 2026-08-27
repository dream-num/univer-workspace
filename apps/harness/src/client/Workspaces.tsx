/**
 * Harness sidebar browsing region.
 *
 * Renders the platform's LIVE workspace/session snapshots scoped to the
 * signed-in user: every Host Workspace under the user's mechanical root
 * directory (the per-user root itself and its per-Space children) with that
 * Workspace's accounted sessions. No browser-local session bookkeeping —
 * the list is the same fact source the default DSH sidebar uses, only the
 * visible RANGE is narrowed to this user.
 */
import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import type { UwhMeView, UwhTemplate } from "../contract.ts";
import type { UwhWorkspacesProps } from "./workspaces-props.ts";

/** One renderable session row derived from the live snapshot. */
interface SessionRow {
  readonly sessionId: SessionId;
  readonly title: string;
  readonly running: boolean;
  readonly updatedAt: number;
}

/** One renderable Workspace group: a user-owned dir plus its sessions. */
interface WorkspaceGroup {
  readonly workspaceId: string;
  readonly title: string;
  readonly rows: readonly SessionRow[];
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
  t,
}: UwhWorkspacesProps) {
  const sessions = useSessions(s => s);
  const workspaces = useWorkspaces(s => s);

  const [me, setMe] = useState<UwhMeView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void loadMe().then(view => {
      if (mounted.current) setMe(view);
    }).catch((reason: unknown) => {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (mounted.current) setLoaded(true);
    });
    return () => { mounted.current = false; };
  }, [loadMe]);

  const onTemplate = useCallback((template: UwhTemplate) => {
    if (busy || me === null) return;
    setBusy(true);
    setError(null);
    setBanner("template.forking");
    void forkTemplate(template).then(childId => {
      open(childId);
    }).catch((reason: unknown) => {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (mounted.current) {
        setBusy(false);
        setBanner(null);
      }
    });
  }, [busy, me, forkTemplate, open]);

  const groups = useMemo<readonly WorkspaceGroup[]>(() => {
    if (me === null) return [];
    const root = me.workspace.path;
    const archived = new Set<string>(workspaces.archivedSessionIds);
    const scoped = (path: string): boolean => path === root || path.startsWith(`${root}/`);
    const result: WorkspaceGroup[] = [];
    for (const view of workspaces.items) {
      if (!scoped(view.path)) continue;
      const rows: SessionRow[] = [];
      for (const id of view.sessionIds) {
        if (archived.has(id)) continue;
        const summary = sessions.byId[id];
        if (summary === undefined) continue;
        // A blank session stays invisible unless selected — the default
        // browser's convention ("New Session" reuses blank ones).
        if (summary.blank && id !== sessions.current) continue;
        rows.push({
          sessionId: id,
          title: summary.displayTitle !== "" ? summary.displayTitle : String(id),
          running: summary.running,
          updatedAt: summary.updatedAt,
        });
      }
      rows.sort((a, b) => b.updatedAt - a.updatedAt);
      const title = view.title.trim() !== "" ? view.title : view.path.split("/").filter(Boolean).pop() ?? view.path;
      result.push({ workspaceId: String(view.workspaceId), title, rows });
    }
    return result;
  }, [me, workspaces, sessions]);

  const templates = me?.templates ?? [];
  const anyRows = groups.some(group => group.rows.length > 0);

  return createElement("div", { className: "uwh-root" },
    !wide && createElement("button", {
      type: "button",
      className: "uwh-collapsedButton",
      "aria-label": t("expand"),
      onClick: expandSidebar,
    }, "\u2630"),
    wide && !loaded && createElement("div", { className: "uwh-status" }, t("loading")),
    wide && loaded && error !== null && me === null && createElement("div", { className: "uwh-status uwh-error" }, error),
    wide && loaded && me !== null && createElement(Fragment, null,
      createElement("div", { className: "uwh-header" },
        createElement("span", { className: "uwh-title" }, me.identity.username),
        me.admin && createElement("span", { className: "uwh-adminBadge" }, t("adminBadge")),
      ),
      createElement("div", { className: "uwh-workspaceLine" },
        createElement("span", { className: "uwh-workspaceLabel" }, t("workspaceLabel")),
        createElement("code", { className: "uwh-workspacePath" }, me.workspace.path),
      ),
      banner !== null && createElement("div", { className: "uwh-banner" }, "正在从模板派生会话…"),
      error !== null && createElement("div", { className: "uwh-error" }, error),
      templates.length > 0 && createElement("ul", { className: "uwh-list", "aria-label": "模板" },
        templates.map(template => createElement("li", { key: `t:${template.key}`, className: "uwh-row" },
          createElement("div", { className: "uwh-rowMain" },
            createElement("span", { className: "uwh-rowTitle" }, template.label ?? template.key),
            template.description !== undefined && createElement("span", { className: "uwh-rowDesc" }, template.description),
          ),
          createElement("button", {
            type: "button",
            className: "uwh-rowButton",
            onClick: () => onTemplate(template),
            disabled: busy,
          }, t("templateFork")),
        )),
      ),
      groups.map(group => createElement(Fragment, { key: group.workspaceId },
        createElement("div", { className: "uwh-groupHeader" }, group.title),
        group.rows.length > 0 && createElement("ul", { className: "uwh-list", role: "tree", "aria-label": group.title },
          group.rows.map(row => createElement("li", { key: row.sessionId, className: "uwh-row" },
            createElement("button", {
              type: "button",
              className: clsx("uwh-sessionRow", sessions.current === row.sessionId && "uwh-selected"),
              onClick: () => open(row.sessionId),
            },
              createElement("span", {
                className: clsx("uwh-sessionStatus", row.running && "uwh-sessionRunning"),
                "aria-hidden": "true",
              }),
              createElement("span", { className: "uwh-rowTitle" }, row.title),
            ),
          )),
        ),
      )),
      !anyRows && templates.length === 0
        ? createElement("div", { className: "uwh-empty" }, t("empty"))
        : null,
    ),
  );
}
