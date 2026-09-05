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
import type { WorktreeStateView, WorktreeStatus } from "../shared/state.ts";
import type { UniverLocaleKey } from "./locales.ts";
import { getWorktrees } from "./api/univer-api.ts";
import type { WorkspaceWorktreeSurface } from "./navigation/workspace-navigation.ts";
import { WORKSPACE_ME_PATH, type WorkspaceMeView } from "./workspace-contract.ts";
import {
  worktreeMatchesVisibility,
  type WorktreeVisibilityFilter,
  formatWorktreeRelativeTime,
  sortWorktreesByCreatedAt,
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

export function worktreeOwnershipOf(worktree: WorktreeStateView): OwnershipGroupKey {
  return worktree.kind;
}

export function WorktreeSidebar({ onOpenWorktree, activeWorktreeId, t }: WorktreeSidebarProps) {
  const [worktrees, setWorktrees] = useState<readonly WorktreeStateView[]>();
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
  const [expandedGroups, setExpandedGroups] = useState<
    Readonly<Record<OwnershipGroupKey, boolean>>
  >({
    user: true,
    team: true,
  });

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshEpoch((value) => value + 1);
  }, []);

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
    void Promise.allSettled([getWorktrees(abort.signal), fetchWorkspaceMe(abort.signal)])
      .then(([worktreeResult, meResult]) => {
        if (abort.signal.aborted) return;

        let hasFailure = false;
        if (worktreeResult.status === "fulfilled") {
          setWorktrees(worktreeResult.value);
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
  }, [refreshEpoch]);

  const query = search.trim().toLocaleLowerCase();
  const visibleWorktrees = useMemo(
    () => (worktrees ?? []).filter((worktree) => matchesSearch(worktree, query)),
    [worktrees, query],
  );
  const groups = useMemo(
    () =>
      OWNERSHIP_GROUPS.map((group) => {
        const allWorktrees = visibleWorktrees.filter(
          (worktree) => worktreeOwnershipOf(worktree) === group.key,
        );
        return {
          ...group,
          worktrees: sortWorktreesByCreatedAt(
            allWorktrees.filter((worktree) =>
              worktreeMatchesVisibility(worktree.status, visibilityFilter),
            ),
          ),
        };
      }),
    [visibilityFilter, visibleWorktrees],
  );

  const openWorktree = useCallback(
    (worktree: WorktreeStateView) => {
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

  const renderWorktree = (worktree: WorktreeStateView) => {
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
            onValueChange={setVisibilityFilter}
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
              <strong>{t("worktree.emptyTitle")}</strong>
              <span>{t("worktree.emptyBody")}</span>
            </div>
          ) : null}
          {!initialLoading &&
          worktrees !== undefined &&
          worktrees.length > 0 &&
          visibleWorktrees.length === 0 ? (
            <p className={css.status}>{t("worktree.noMatch")}</p>
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
                  <span className={css.groupCount}>{group.worktrees.length}</span>
                </button>
                {groupOpen ? (
                  <>
                    {group.worktrees.length > 0 ? (
                      <ul className={css.worktreeList}>{group.worktrees.map(renderWorktree)}</ul>
                    ) : (
                      <p className={css.groupEmpty}>{t("worktree.groupEmpty")}</p>
                    )}
                  </>
                ) : null}
              </section>
            );
          })}
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

function matchesSearch(worktree: WorktreeStateView, query: string): boolean {
  if (query === "") return true;
  const fields: readonly (string | null | undefined)[] = [
    worktree.name,
    worktree.summary,
    worktree.creator.displayName,
    worktree.creator.username,
    worktree.teamSpace?.name,
  ];
  return fields.some((field) => field?.toLocaleLowerCase().includes(query) === true);
}

function worktreeStatusLabel(status: WorktreeStatus, t: (key: UniverLocaleKey) => string): string {
  switch (status) {
    case "draft":
      return t("worktree.status.draft");
    case "ready":
      return t("worktree.status.ready");
    case "merging":
      return t("worktree.status.merging");
    case "merged":
      return t("worktree.status.merged");
    case "discarded":
      return t("worktree.status.discarded");
  }
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
  return <WorktreeBranchIcon className={className} />;
}

function WorktreeBranchIcon({ className }: { readonly className: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="12" cy="5" r="1.5" />
      <path d="M4 4.5v7M5.5 3.5c3.8 0 6.5 0 6.5 1.5" />
    </svg>
  );
}
