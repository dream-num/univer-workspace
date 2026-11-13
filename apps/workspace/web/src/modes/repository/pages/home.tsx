import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CircleDot,
  GitPullRequest,
  History,
  MessageSquare,
} from "lucide-react";
import { Suspense } from "react";
import { HomeAgents } from "./agents";
import { IssueLabelChip } from "../../../features/issues/issue-label";
import { IssueStateIcon } from "../../../features/issues/issue-state";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import type { HomePageProps } from "../../page.types";
import { WorkspaceLayout } from "../../workspace-layout";
import { ACTOR_LABEL, ActorAvatar } from "../code/actor-avatar";
import { TypeBadge } from "../code/repository-file-table";
import { ACTOR_KINDS, actorOf, useHomeWork, type HomeWork } from "../data";
import { PullRequestCard } from "../pull-request-card";
import { HomeFrame } from "../shell/home-frame";
import { spaceDisplayName } from "../space-name";

export function RepositoryHomePage(_props: HomePageProps) {
  const { t } = useI18n();
  const work = useHomeWork();
  if (work.status === "error") throw work.error;
  return (
    <WorkspaceLayout repositoryView="home" selectedView="home" headerTitle={t("home")}>
      <HomeFrame
        updatedBySpace={work.status === "success" ? work.data.updatedBySpace : undefined}
        openBySpace={work.status === "success" ? work.data.openBySpace : undefined}
      >
        <Suspense fallback={<div className="rd-home-agent-placeholder" />}><HomeAgents /></Suspense>
        {work.status === "pending" ? (
          <p className="rd-home-empty" role="status">
            {t("dashboardLoading")}
          </p>
        ) : (
          <>
            <LoadRanking items={work.data.ranking} totals={work.data.totals} />
            {!work.data.complete ? (
              <p className="rd-data-note">{t("repositoryHomePartial")}</p>
            ) : null}
            <section className="rd-home-sec" aria-labelledby="home-pulls-title">
              <div className="rd-home-sec-h">
                <h2 id="home-pulls-title">
                  <GitPullRequest aria-hidden="true" />
                  {t("repositoryPullRequests")}
                </h2>
                <Link to="/worktrees" search={{}}>
                  {t("viewAll")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>
              <PullCards items={work.data.pulls} />
            </section>
            <section className="rd-home-sec" aria-labelledby="home-recent-title">
              <div className="rd-home-sec-h">
                <h2 id="home-recent-title">
                  <History aria-hidden="true" />
                  {t("dashboardContinue")}
                </h2>
                <Link to="/recent" search={{}}>
                  {t("viewAll")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>
              <ContinueCards items={work.data.continueWorking} />
            </section>
            <section className="rd-home-sec" aria-labelledby="home-issues-title">
              <div className="rd-home-sec-h">
                <h2 id="home-issues-title">
                  <CircleDot aria-hidden="true" />
                  {t("issues")}
                </h2>
                <Link to="/issues" search={{ sort: "updated" }}>
                  {t("viewAll")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>
              <IssueRows items={work.data.issues} />
            </section>
          </>
        )}
      </HomeFrame>
    </WorkspaceLayout>
  );
}

function LoadRanking({ items, totals }: { readonly items: HomeWork["ranking"]; readonly totals: HomeWork["totals"] }) {
  const { t } = useI18n();
  const maximum = Math.max(1, ...items.map((item) => item.total));
  const kinds = ACTOR_KINDS.filter((kind) => kind !== "unknown" || items.some((item) => item.segments.some((segment) => segment.key === kind)));
  return (
    <section className="rd-who-chg" aria-labelledby="home-ranking-title">
      <div className="rd-wh">
        <h2 id="home-ranking-title">{t("repositoryHomeRankingTitle")}</h2>
        <p>{t("repositoryHomeRankingBasis")}</p>
        <div className="rd-home-key">
          {kinds.map((kind) => (
            <span key={kind} title={kind === "unknown" ? t("repositoryHomeUnknownSource") : undefined}>
              <i style={{ background: `var(--rd-actor-${kind})` }} />
              {t(ACTOR_LABEL[kind])}
            </span>
          ))}
        </div>
      </div>
      <div className="rd-work-figures">
        <div><strong>{totals.pulls}</strong><span>{t("repositoryHomePullsFigure")}</span></div>
        <div className="rd-agent-figure"><strong>{totals.agentPulls} <small>{t("repositoryHomeOfPulls", { count: totals.pulls })}</small></strong><span><i aria-hidden="true" />{t("repositoryHomeAgentsFigure")}</span></div>
        <div><strong>{totals.issues}</strong><span>{t("repositoryHomeIssuesFigure")}</span></div>
      </div>
      {items.length ? (
        <ol className="rd-rank">
          {items.map((item, index) => (
            <li key={item.space.id}>
              <Link to="/spaces/$spaceId" params={{ spaceId: item.space.id }} search={{}}>
                <span className="rd-no">{index + 1}</span>
                <span className="rd-nm">{item.space.name}</span>
                <span className="rd-track" aria-hidden="true">
                  {item.segments.map((segment) =>
                    segment.value > 0 ? (
                      <i
                        key={segment.key}
                        style={{
                          width: `${(segment.value / maximum) * 100}%`,
                          background: `var(--rd-actor-${segment.key})`,
                        }}
                      />
                    ) : null,
                  )}
                </span>
                <span className="rd-rank-fig">
                  {item.segments.map((segment, i) => (
                    <span key={segment.key}>
                      {i ? " · " : ""}
                      {t(ACTOR_LABEL[segment.key])}{" "}
                      <b>{segment.value}</b>
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rd-home-empty">{t("repositoryHomeNoOpenWork")}</p>
      )}
    </section>
  );
}

function PullCards({ items }: { readonly items: HomeWork["pulls"] }) {
  const { t } = useI18n();
  if (!items.length) return <p className="rd-home-empty">{t("dashboardNoPullRequests")}</p>;
  return (
    <div className="rd-mcards">
      {items.map((item) => <PullRequestCard key={item.pull.id} item={item} />)}
    </div>
  );
}

function ContinueCards({ items }: { readonly items: HomeWork["continueWorking"] }) {
  const { t, language } = useI18n();
  if (!items.length) return <p className="rd-home-empty">{t("dashboardNoRecent")}</p>;
  return (
    <div className="rd-mcards">
      {items.map((item) => {
        const type = item.resource.kind === "univer" ? item.resource.unitType : "blob";
        const typeName = t(type === "blob" ? "file" : type);
        const repository = spaceDisplayName(item.location.space, t);
        return (
          <Link
            key={item.resource.id}
            className="rd-mcard"
            to="/nodes/$nodeId"
            params={{ nodeId: item.node.id }}
            search={{}}
          >
            <div className="rd-mc-t">
              <TypeBadge type={type} />
              <span className="rd-tt">{item.node.name}</span>
            </div>
            <time className="rd-mc-fig" dateTime={item.lastOpenedAt}>
              {formatRelativeDate(item.lastOpenedAt, language)}
            </time>
            <p className="rd-mc-d">
              {repository} · {typeName}
            </p>
            <div className="rd-mc-m">
              <span>{repository}</span>
              <span>{typeName}</span>
              <span>{t("lastOpened")}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function IssueRows({ items }: { readonly items: HomeWork["issues"] }) {
  const { t, language } = useI18n();
  if (!items.length) return <p className="rd-home-empty">{t("dashboardNoIssues")}</p>;
  return (
    <ul className="rd-home-issues">
      {items.map(({ summary: issue }) => (
        <li key={issue.id}>
          <Link
            className="rd-home-issue"
            to="/spaces/$spaceId/issues/$number"
            params={{ spaceId: issue.space.id, number: String(issue.number) }}
            search={{}}
          >
            <IssueStateIcon issue={issue} />
            <div className="rd-home-issue-main">
              <div className="rd-home-issue-title">
                <span>{issue.title}</span>
                {issue.labels.map((label) => (
                  <IssueLabelChip key={label.id} name={label.name} color={label.color} />
                ))}
              </div>
              <div className="rd-mc-m">
                <span>
                  {t("issueOpenedBy", {
                    number: issue.number,
                    name: issue.author.displayName,
                    date: formatRelativeDate(issue.createdAt, language),
                  })}
                </span>
                <span>{issue.space.name}</span>
              </div>
            </div>
            <div className="rd-home-issue-side">
              {issue.assignees.slice(0, 3).map((user) => (
                <ActorAvatar key={user.id} actor={actorOf(user, "unknown")} size="sm" />
              ))}
              <span
                className="rd-comments"
                aria-label={t("issueCommentCount", { count: issue.commentCount })}
              >
                <MessageSquare aria-hidden="true" />
                {issue.commentCount}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
