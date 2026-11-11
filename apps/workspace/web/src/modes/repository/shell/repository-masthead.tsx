import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BookMarked,
  Bot,
  CircleDot,
  CodeXml,
  Copy,
  FileStack,
  GitPullRequest,
  Globe,
  LockKeyhole,
  Settings,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { components } from "../../../../../generated/http/schema.js";
import { spaceNodesQueryOptions } from "../../../features/nodes/nodes.queries";
import { teamMembersQueryOptions } from "../../../features/permissions/permissions.queries";
import { issueCountsQueryOptions } from "../../../features/issues/issues.queries";
import { spaceQueryOptions } from "../../../features/spaces";
import { spaceSupportsIssues } from "../../../features/spaces/space.rules";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import { toast } from "../../../shared/ui";
import { repositoryMembers } from "../code/team-members";
import { useRepositoryActivity } from "../data";
import { openWorktreesQueryOptions } from "../data/queries";
import type { RepositoryTab } from "../repository-tabs";
import { CurrentLink } from "../current-link";
import { RepositoryStar } from "../repository-star";
import { spaceDisplayName } from "../space-name";

type Space = components["schemas"]["SpaceView"];

export function RepositoryMasthead({
  spaceId,
  tab,
}: {
  readonly spaceId: string;
  readonly tab: RepositoryTab;
}) {
  const space = useQuery(spaceQueryOptions(spaceId));
  return space.data ? <Masthead space={space.data} tab={tab} /> : null;
}

function Masthead({ space, tab }: { readonly space: Space; readonly tab: RepositoryTab }) {
  const { t } = useI18n();
  const name = spaceDisplayName(space, t) ?? space.name;
  const fullName = space.fullName ?? name;
  const full = tab === "files";
  const hasIssues = spaceSupportsIssues(space);
  const issueCounts = useQuery({ ...issueCountsQueryOptions(space.id), enabled: hasIssues });
  const pulls = useQuery(openWorktreesQueryOptions(space));
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  const canOpenSettings =
    space.capabilities.renameSpace ||
    space.capabilities.manageMembers ||
    space.capabilities.viewTrash;
  const count = pulls.data
    ? `${pulls.data.items.length}${pulls.data.nextCursor ? "+" : ""}`
    : undefined;
  return (
    <section className="rd-masthead" aria-label={t("repository")}>
      <div className={full ? "rd-rhead" : "rd-rmini"}>
        <span className="rd-repo-ic">
          <BookMarked aria-hidden="true" />
        </span>
        <h1>
          <Link to="/spaces/$spaceId" params={{ spaceId: space.id }} search={{}}>
            {name}
          </Link>
        </h1>
        {!full ? <span className="rd-mono">{fullName}</span> : null}
      </div>
      {full ? (
        <>
          <div className="rd-slugline">
            <Link
              className="rd-owner"
              to="/spaces/$spaceId"
              params={{ spaceId: space.id }}
              search={{}}
            >
              {fullName}
            </Link>
            <button
              className="rd-iconbtn"
              type="button"
              aria-label={t("copyFullName")}
              title={t("copyFullName")}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(fullName);
                  toast.success(t("fullNameCopied"));
                } catch {
                  toast.error(t("copyFullNameFailed"));
                }
              }}
            >
              <Copy aria-hidden="true" />
            </button>
            <span className="rd-visibility">
              {space.publicRead ? <Globe aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
              {t(space.publicRead ? "repositoryVisibilityPublic" : "repositoryVisibilityPrivate")}
            </span>
            <RepositoryStar spaceId={space.id} name={name} showCount />
            <RepositoryMetas space={space} />
          </div>
          {space.description ? <p className="rd-rdesc">{space.description}</p> : null}
        </>
      ) : null}
      <nav ref={nav} className="rd-tabs" aria-label={t("repository")}>
        <CurrentLink
          to="/spaces/$spaceId"
          params={{ spaceId: space.id }}
          search={{}}
          current={tab === "files"}
        >
          <CodeXml aria-hidden="true" />
          {t("repositoryCode")}
        </CurrentLink>
        {hasIssues ? (
          <CurrentLink
            to="/spaces/$spaceId/issues"
            params={{ spaceId: space.id }}
            search={{}}
            current={tab === "issues"}
          >
            <CircleDot aria-hidden="true" />
            {t("issues")}
            {issueCounts.data ? <span className="rd-count">{issueCounts.data.open}</span> : null}
          </CurrentLink>
        ) : null}
        <CurrentLink
          to="/spaces/$spaceId"
          params={{ spaceId: space.id }}
          search={{ view: "prs" }}
          current={tab === "prs"}
        >
          <GitPullRequest aria-hidden="true" />
          {t("repositoryPullRequests")}
          {count !== undefined ? <span className="rd-count">{count}</span> : null}
        </CurrentLink>
        <CurrentLink to="/spaces/$spaceId/agents" params={{ spaceId: space.id }} current={tab === "agents"}>
          <Bot aria-hidden="true" />
          {t("agents")}
        </CurrentLink>
        <CurrentLink
          to="/spaces/$spaceId"
          params={{ spaceId: space.id }}
          search={{ view: "apps" }}
          current={tab === "apps"}
        >
          <FileStack aria-hidden="true" />
          {t("pages")}
        </CurrentLink>
        {canOpenSettings ? (
          <CurrentLink
            to="/spaces/$spaceId/settings"
            params={{ spaceId: space.id }}
            current={tab === "settings"}
          >
            <Settings aria-hidden="true" />
            {t("spaceSettings")}
          </CurrentLink>
        ) : null}
      </nav>
    </section>
  );
}

function RepositoryMetas({ space }: { readonly space: Space }) {
  const { t, language } = useI18n();
  const members = useQuery({
    ...teamMembersQueryOptions(space.id),
    enabled: space.type === "team",
  });
  const nodes = useQuery(spaceNodesQueryOptions(space.id));
  const activity = useRepositoryActivity(space);
  const latest = [
    ...(nodes.data?.nodes.map((node) => node.updatedAt) ?? []),
    ...(activity.status === "success" && activity.data.lastActivityAt
      ? [activity.data.lastActivityAt]
      : []),
  ].sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return (
    <dl className="rd-metas">
      {space.type === "team" && members.data ? (
        <div>
          <dt>{t("repositoryMetaMembers")}</dt>
          <dd>{repositoryMembers(members.data).length}</dd>
        </div>
      ) : null}
      {nodes.data ? (
        <div>
          <dt>{t("repositoryFiles")}</dt>
          <dd>
            {nodes.data.nodes.length}
            {nodes.data.nextCursor ? "+" : ""}
          </dd>
        </div>
      ) : null}
      {latest ? (
        <div>
          <dt>{t("repositoryPrUpdated")}</dt>
          <dd>
            <time dateTime={latest}>{formatRelativeDate(latest, language)}</time>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
