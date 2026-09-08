import { worktreeStatusLabel } from "./worktree-presentation.ts";
import { WorktreeBranchIcon } from "./components/worktree-review/WorktreeBranchIcon.tsx";
import { refreshWorktreeWindow } from "./api/worktree-pages.ts";
/**
 * Worktree tab of the Harness sidebar: origin-level Worktree discovery only —
 * state groups, search, and Worktree rows. There is deliberately no Unit
 * subtree here: clicking a row opens/activates the middle Worktree review
 * surface and Unit inspection lives there. Rows never show a "Personal Space"
 * label or a bare user/team kind; a team Worktree shows its real bound Team
 * Space name.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  Input,
  RefreshIcon,
  Select,
} from "@univerjs/univer-workspace-ui";
import type { WorktreeListQuery, WorktreeSummaryView, WorktreeStatus } from "../shared/state.ts";
import type { UniverLocaleKey } from "./locales.ts";
import { getWorktrees, subscribeFileStateInvalidation } from "./api/univer-api.ts";
import type { WorkspaceWorktreeSurface } from "./navigation/workspace-navigation.ts";
import { WORKSPACE_ME_PATH, type WorkspaceMeView } from "./workspace-contract.ts";
import {
  type WorktreeVisibilityFilter,
  formatWorktreeRelativeTime,
} from "./worktree-order.ts";
import css from "./WorktreeSidebar.module.scss";

type OwnershipGroupKey = "user" | "team";
const OWNERSHIP_GROUPS: readonly {
  readonly key: OwnershipGroupKey;
}[] = [{ key: "user" }, { key: "team" }];
const LOAD_RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000] as const;

export interface WorktreeSidebarProps {
  readonly onOpenWorktree: (surface: WorkspaceWorktreeSurface) => void;
  readonly activeWorktreeId: string | null;
  readonly t: (key: UniverLocaleKey) => string;
}

export function worktreeOwnershipOf(worktree: WorktreeSummaryView): OwnershipGroupKey {
  return worktree.kind;
}

export function WorktreeSidebar({ onOpenWorktree, activeWorktreeId, t }: WorktreeSidebarProps) {
  const [worktrees, setWorktrees] = useState<readonly WorktreeSummaryView[]>();
  const [workspaceOrigin, setWorkspaceOrigin] = useState("");
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string>();
  const [retrying, setRetrying] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [visibilityFilter, setVisibilityFilter] = useState<WorktreeVisibilityFilter>("open");
  const loadRetryAttempt = useRef(0);
  const [listQuery, setListQuery] = useState<WorktreeListQuery>({ scope: "active", order: "createdAtDesc", limit: 50 });
  const visibleCount = useRef(0);
  const refreshWindow = useRef(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((listQuery.search ?? "") === search.trim()) return;
      setWorktrees(undefined);
      setNextCursor(null);
      loadRetryAttempt.current = 0;
      setListQuery(({ cursor: _cursor, ...current }) => ({ ...current, search: search.trim() }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, listQuery.search]);
  const [expandedGroups, setExpandedGroups] = useState<
    Readonly<Record<OwnershipGroupKey, boolean>>
  >({
    user: true,
    team: true,
  });

  const refresh = useCallback(() => {
    refreshWindow.current = true;
    setRefreshing(true);
    setNextCursor(null);
    setListQuery(({ cursor: _cursor, ...current }) => current);
    setRefreshEpoch((value) => value + 1);
  }, []);

  useEffect(() => subscribeFileStateInvalidation((key) => {
    if (key === null || key.startsWith("wt:")) refresh();
  }), [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let retryTimer: number | undefined;
    const scheduleRetry = () => {
      const delay = LOAD_RETRY_DELAYS_MS[loadRetryAttempt.current];
      if (delay === undefined) {
        setRetrying(false);
        return;
      }
      loadRetryAttempt.current += 1;
      setRetrying(true);
      retryTimer = window.setTimeout(() => setRefreshEpoch((value) => value + 1), delay);
    };
    setPending(true);
    const replaceWindow = refreshWindow.current;
    refreshWindow.current = false;
    const listing = replaceWindow
      ? refreshWorktreeWindow(listQuery, visibleCount.current, query => getWorktrees(query, abort.signal))
      : getWorktrees(listQuery, abort.signal);
    void Promise.allSettled([listing, fetchWorkspaceMe(abort.signal)])
      .then(([worktreeResult, meResult]) => {
        if (abort.signal.aborted) return;

        let hasFailure = false;
        if (worktreeResult.status === "fulfilled") {
          const page = worktreeResult.value;
          setWorktrees((current) => {
            const items = replaceWindow || listQuery.cursor === undefined ? page.items :
              [...new Map([...(current ?? []), ...page.items].map((item) => [item.worktreeId, item])).values()];
            visibleCount.current = items.length;
            return items;
          });
          setNextCursor(page.nextCursor);
          setError(undefined);
        } else {
          hasFailure = true;
          const message =
            worktreeResult.reason instanceof Error
              ? worktreeResult.reason.message
              : String(worktreeResult.reason);
          setError(message);
        }

        if (meResult.status === "fulfilled") {
          setWorkspaceOrigin(meResult.value.workspaceOrigin);
          setAuthRequired(false);
        } else {
          hasFailure = true;
          const message =
            meResult.reason instanceof Error ? meResult.reason.message : String(meResult.reason);
          setAuthRequired(message === "workspace_connection_required");
          if (worktreeResult.status !== "fulfilled") {
            setError(message === "workspace_connection_required" ? undefined : message);
          }
        }

        if (hasFailure) {
          scheduleRetry();
        } else {
          loadRetryAttempt.current = 0;
          setRetrying(false);
          setError(undefined);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setPending(false);
          setRefreshing(false);
        }
      });
    return () => {
      abort.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [refreshEpoch, listQuery]);

  const groups = useMemo(
    () => OWNERSHIP_GROUPS.map((group) => ({
      ...group,
      worktrees: (worktrees ?? []).filter((worktree) => worktreeOwnershipOf(worktree) === group.key),
    })).filter((group) => group.worktrees.length > 0),
    [worktrees],
  );

  const openWorktree = useCallback(
    (worktree: WorktreeSummaryView) => {
      if (workspaceOrigin === "") return;
      onOpenWorktree({
        kind: "worktree",
        workspaceOrigin,
        worktreeId: worktree.worktreeId,
        name: worktree.name,
        unitId: null,
      });
    },
    [onOpenWorktree, workspaceOrigin],
  );

  const renderWorktree = (worktree: WorktreeSummaryView) => {
    const metaParts: string[] = [];
    if (worktree.kind === "team") {
      metaParts.push(worktree.teamSpace?.name ?? t("worktree.teamSpaceFallback"));
    }
    metaParts.push(worktree.creator.displayName);
    metaParts.push(formatWorktreeRelativeTime(worktree.createdAt, now, t));
    return (
      <li key={worktree.worktreeId}>
        <button
          type="button"
          className={css.worktreeRow}
          data-selected={activeWorktreeId === worktree.worktreeId || undefined}
          aria-current={activeWorktreeId === worktree.worktreeId ? "page" : undefined}
          onClick={() => openWorktree(worktree)}
        >
          <WorktreeStatusIcon status={worktree.status} />
          <span className={css.worktreeText}>
            <strong className={css.worktreeName}>{worktree.name}</strong>
            <small className={css.worktreeMeta}>{metaParts.join(" · ")}</small>
          </span>
          <span
            className={`${css.statusChip} ${statusChipClass(worktree.status)}`}
            title={worktreeStatusLabel(worktree.status, t)}
          >
            {worktreeStatusLabel(worktree.status, t)}
          </span>
        </button>
      </li>
    );
  };

  const showList = !authRequired && (error === undefined || retrying);
  const initialLoading = (pending || retrying) && worktrees === undefined;

  return (
    <section className={css.sidebar} aria-label={t("worktree.title")}>
      <header className={css.header}>
        <span className={css.headerTitle}>{t("worktree.title")}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("worktree.refresh")}
          aria-busy={refreshing}
          disabled={refreshing}
          onClick={refresh}
        >
          <RefreshIcon />
        </Button>
      </header>
      {showList ? (
        <div className={css.searchRow}>
          <Input
            className={css.searchInput}
            value={search}
            placeholder={t("worktree.searchPlaceholder")}
            aria-label={t("worktree.searchAria")}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      ) : null}
      {showList ? (
        <div className={css.visibilityFilter}>
          <span className={css.visibilityLabel}>{t("worktree.visibilityLabel")}</span>
          <Select
            value={visibilityFilter}
            onValueChange={(value) => {
              setVisibilityFilter(value);
              setWorktrees(undefined);
              setNextCursor(null);
              loadRetryAttempt.current = 0;
              setListQuery(({ cursor: _cursor, ...current }) => ({ ...current,
                scope: value === "open" ? "active" : value === "closed" ? "processed" : "all" }));
            }}
            size="sm"
            borderless
            aria-label={t("worktree.visibilityAria")}
            options={[
              { value: "open", label: t("worktree.visibility.open") },
              { value: "all", label: t("worktree.visibility.all") },
              { value: "closed", label: t("worktree.visibility.closed") },
            ]}
          />
        </div>
      ) : null}
      {authRequired ? (
        <div className={css.authNotice} role="status">
          <strong>{t("worktree.authTitle")}</strong>
          <span>{t("worktree.authBody")}</span>
        </div>
      ) : null}
      {error !== undefined && !retrying ? (
        <div className={css.error} role="alert">
          {error}
        </div>
      ) : null}
      {showList ? (
        <div className={css.list}>
          {initialLoading ? <p className={css.status}>{t("worktree.loading")}</p> : null}
          {!initialLoading && worktrees !== undefined && worktrees.length === 0 ? (
            <div className={css.empty}>
              <strong>{t(search.trim() !== "" ? "worktree.noMatch" : "worktree.emptyTitle")}</strong>
              {search.trim() === "" ? <span>{t("worktree.emptyBody")}</span> : null}
            </div>
          ) : null}
          {groups.map((group) => {
            const groupOpen = expandedGroups[group.key];
            return (
              <section key={group.key} className={css.group}>
                <button
                  type="button"
                  className={css.groupHeader}
                  aria-expanded={groupOpen}
                  aria-label={groupOpen ? t("worktree.groupCollapse") : t("worktree.groupExpand")}
                  onClick={() =>
                    setExpandedGroups((current) => ({ ...current, [group.key]: !groupOpen }))
                  }
                >
                  {groupOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  <span className={css.groupLabel}>
                    {t(`worktree.group.${group.key}` as UniverLocaleKey)}
                  </span>
                </button>
                {groupOpen ? (
                  <ul className={css.worktreeList}>{group.worktrees.map(renderWorktree)}</ul>
                ) : null}
              </section>
            );
          })}
          {nextCursor !== null ? (
            <Button disabled={pending || retrying || search.trim() !== (listQuery.search ?? "")}
              onClick={() => setListQuery((current) => ({ ...current, cursor: nextCursor }))}>
              {t(pending ? "worktree.loading" : "worktree.loadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

async function fetchWorkspaceMe(signal: AbortSignal): Promise<WorkspaceMeView> {
  const response = await fetch(WORKSPACE_ME_PATH, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  if (response.status === 401) throw new Error("workspace_connection_required");
  if (!response.ok) throw new Error(`workspace identity answered ${response.status}`);
  return (await response.json()) as WorkspaceMeView;
}

function statusChipClass(status: WorktreeStatus): string | undefined {
  switch (status) {
    case "draft":
      return css.statusDraft;
    case "ready":
      return css.statusReady;
    case "merging":
      return css.statusMerging;
    case "merged":
      return css.statusMerged;
    case "discarded":
      return css.statusDiscarded;
  }
}

function WorktreeStatusIcon({ status }: { readonly status: WorktreeStatus }): ReactElement {
  const className = `${css.statusIcon} ${statusChipClass(status) ?? ""}`;
  return <WorktreeBranchIcon status={status} className={className} />;
}
