import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CircleDot,
  Copy,
  ExternalLink,
  GitPullRequest,
  History,
  MessageSquare,
  Terminal,
} from "lucide-react";
import { Suspense } from "react";
import { HomeAgents } from "./agents";
import { IssueLabelChip } from "../../../features/issues/issue-label";
import { IssueStateIcon } from "../../../features/issues/issue-state";
import { CLI_GUIDE_URL } from "../../../features/worktrees/worktree-onboarding";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import { toast } from "../../../shared/ui";
import type { HomePageProps } from "../../page.types";
import { WorkspaceLayout } from "../../workspace-layout";
import { ACTOR_LABEL, ActorAvatar } from "../code/actor-avatar";
import { TypeBadge } from "../code/repository-file-table";
import { ACTOR_KINDS, actorOf, useHomeWork, type HomeHeadline as Headline, type HomeWork } from "../data";
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
        rightRail={<CliCard />}
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
            <HomeHeadline headline={work.data.headline} />
            <LoadRanking items={work.data.ranking} />
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

function HomeHeadline({ headline }: { readonly headline: Headline }) {
  const { t } = useI18n();
  return (
    <h1 className="rd-headline" data-headline={headline.kind}>
      {headline.kind === "quiet" ? (
        t("repositoryHomeQuiet")
      ) : headline.kind === "agents-drafted" ? (
        <>
          {t("repositoryHomeAgentsDraftedBefore", { count: headline.pulls })}
          <em>{t("repositoryHomeAgentsDraftedShare", { agents: headline.agents, count: headline.pulls })}</em>
          {t("repositoryHomeAgentsDraftedAfter", { count: headline.pulls })}
        </>
      ) : (
        <>
          <em>{headline.pulls}</em> {t("repositoryHomeOpenPulls", { count: headline.pulls })}{" "}
          <span className="rd-headline-phrase">{t("repositoryHomeAcross", { count: headline.repositories })}</span>
        </>
      )}
    </h1>
  );
}

function LoadRanking({ items }: { readonly items: HomeWork["ranking"] }) {
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
            <span key={kind}>
              <i style={{ background: `var(--rd-actor-${kind})` }} />
              {t(ACTOR_LABEL[kind])}
            </span>
          ))}
        </div>
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

const CLI_INSTALL = "npm install --global univer-workspace-cli@latest";

function CliCard() {
  const { t } = useI18n();
  return (
    <section className="rd-cli-card" aria-labelledby="home-cli-title">
      <h2 id="home-cli-title">
        <span className="rd-repo-ic">
          <Terminal aria-hidden="true" />
        </span>
        {t("dashboardCliTitle")}
      </h2>
      <p>{t("dashboardCliDescription")}</p>
      <div className="rd-cli-code">
        <code>
          <b aria-hidden="true">$ </b>
          {CLI_INSTALL}
        </code>
        <button
          className="rd-iconbtn"
          type="button"
          aria-label={t("repositoryHomeCopyCommand")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(CLI_INSTALL);
              toast.success(t("repositoryHomeCommandCopied"));
            } catch {
              toast.error(t("onboardingCopyFailed"));
            }
          }}
        >
          <Copy aria-hidden="true" />
        </button>
      </div>
      <a className="rd-cli-guide" href={CLI_GUIDE_URL} target="_blank" rel="noopener noreferrer">
        {t("onboardingCliLink")}
        <ExternalLink aria-hidden="true" />
      </a>
    </section>
  );
}
