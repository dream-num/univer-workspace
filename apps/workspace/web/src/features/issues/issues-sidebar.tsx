import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronRightIcon, UsersIcon } from "@univerjs/univer-workspace-ui";
import { useCallback, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { cn } from "../../shared/utils/cn";
import { spacesQueryOptions } from "../spaces";
import { IssueStateIcon } from "./issue-state";
import { issueCountsQueryOptions, sidebarIssuesQueryOptions } from "./issues.queries";

/**
 * Wiki theme entry for Issues, shaped like the Apps section: a collapsible group headed by a link
 * to the cross-Space list, with one expandable row per Team Space the user belongs to.
 */
export function IssuesSidebarSection(props: { readonly storageScope: string }) {
  const { t } = useI18n();
  const location = useLocation();
  const spaces = useQuery(spacesQueryOptions);
  // `createIssue` is granted to the owner and members only, not to public-read visitors.
  const memberSpaces = (spaces.data?.spaces ?? []).filter(
    (space) => space.type === "team" && space.capabilities.createIssue,
  );
  const match = /^\/spaces\/([^/]+)\/issues\/(\d+)$/.exec(location.pathname);
  const [sectionExpanded, setSectionExpanded] = useStoredFlag(
    `workspace-file-tree:${props.storageScope}:issues`,
    true,
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  if (memberSpaces.length === 0) return null;
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="mt-1 min-w-0" aria-label={t("issues")}>
      <div className="flex min-h-11 items-center rounded-md pr-0.5 pl-1.5 md:min-h-8">
        <button
          type="button"
          className="grid size-9 shrink-0 place-items-center rounded-sm text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 md:size-3.5"
          aria-expanded={sectionExpanded}
          aria-label={t(sectionExpanded ? "collapseSection" : "expandSection", { name: t("issues") })}
          onClick={() => setSectionExpanded(!sectionExpanded)}
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 transition-transform motion-reduce:transition-none",
              sectionExpanded && "rotate-90",
            )}
          />
        </button>
        <Link
          to="/issues"
          search={{}}
          className="ml-[5px] flex h-11 min-w-0 flex-1 items-center truncate text-xs font-semibold text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 md:h-8"
          onClick={() => setSectionExpanded(true)}
        >
          {t("issues")}
        </Link>
      </div>
      {sectionExpanded
        ? memberSpaces.map((space) => (
            <SpaceRow
              key={space.id}
              spaceId={space.id}
              name={space.name}
              expanded={expanded.has(space.id) || match?.[1] === space.id}
              selectedNumber={match?.[1] === space.id ? Number(match[2]) : undefined}
              onToggle={() => toggle(space.id)}
            />
          ))
        : null}
    </section>
  );
}

function SpaceRow({
  spaceId,
  name,
  expanded,
  selectedNumber,
  onToggle,
}: {
  readonly spaceId: string;
  readonly name: string;
  readonly expanded: boolean;
  readonly selectedNumber: number | undefined;
  readonly onToggle: () => void;
}) {
  const { t } = useI18n();
  const counts = useQuery(issueCountsQueryOptions(spaceId));
  const issues = useQuery({ ...sidebarIssuesQueryOptions(spaceId), enabled: expanded });
  const open = counts.data?.open ?? 0;
  return (
    <div>
      <div className="flex min-h-11 items-center rounded-md pr-2 text-secondary-foreground hover:bg-accent hover:text-foreground md:min-h-8">
        <button
          type="button"
          className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:size-7"
          aria-expanded={expanded}
          aria-label={t(expanded ? "collapseNode" : "expandNode", { name })}
          onClick={onToggle}
        >
          <ChevronRightIcon
            className={cn("size-3.5 transition-transform motion-reduce:transition-none", expanded && "rotate-90")}
          />
        </button>
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:min-h-8"
          onClick={onToggle}
        >
          <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </button>
        {open ? <span className="text-xs text-muted-foreground tabular-nums">{open}</span> : null}
      </div>
      {expanded ? (
        <div className="ms-[18px]">
          {issues.data?.items.map((issue) => {
            const selected = issue.number === selectedNumber;
            return (
              <Link
                key={issue.id}
                to="/spaces/$spaceId/issues/$number"
                params={{ spaceId, number: String(issue.number) }}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-md pr-2 pl-7 text-sm no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:min-h-8",
                  selected
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-secondary-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <IssueStateIcon issue={issue} className="size-3.5" />
                <span className="truncate">
                  <span className="text-muted-foreground">#{issue.number}</span> {issue.title}
                </span>
              </Link>
            );
          })}
          {issues.data && issues.data.items.length === 0 ? (
            <p className="m-0 py-1.5 pl-7 text-xs text-subtle-foreground">{t("issueSidebarEmpty")}</p>
          ) : null}
          <Link
            to="/spaces/$spaceId/issues"
            params={{ spaceId }}
            search={{}}
            className="flex min-h-11 items-center rounded-md pl-7 text-xs text-muted-foreground no-underline hover:text-foreground md:min-h-8"
          >
            {t("issueSidebarViewAll")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function useStoredFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === "true";
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Persistence is optional; the in-memory state stays authoritative.
      }
    },
    [key],
  );
  return [value, update] as const;
}
