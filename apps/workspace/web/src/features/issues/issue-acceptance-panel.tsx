import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LocaleType } from "@univerjs/core";
import { UnitComparisonViewer, type UnitComparisonViewerValue } from "@univer/unit-comparison-viewer";
import { CircleCheck, GitPullRequest, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { useTheme } from "../../shared/theme";
import { Avatar, Badge, Button, Spinner, toast } from "../../shared/ui";
import { createComparisonUniver } from "../editor/comparison-univer";
import { worktreeHtmlViewDraftsQueryOptions } from "../html-views/drafts/draft-queries";
import {
  PullRequestChecks,
  UnitChangeIcon,
  UnitTypeIcon,
  worktreeQueryOptions,
  worktreeStateLabel,
  worktreeStateVariant,
  worktreeUnitComparisonQueryOptions,
} from "../worktrees";
import { IssueComposer } from "./issue-composer";
import { IssueMarkdown } from "./issue-markdown";
import { Muted } from "./issue-sidebar-section";
import { useIssueVerdict } from "./issues.commands";
import { issueAccessChangesQueryOptions } from "./issues.queries";

type Issue = components["schemas"]["Issue"];
type TimelineItem = components["schemas"]["IssueTimelineItem"];
type PullRequest = components["schemas"]["IssuePullRequest"];
type WorktreeUnit = components["schemas"]["WorktreeUnit"];
type Role = components["schemas"]["TeamRole"];

const MAX_ROWS = 50;
const ISSUE_VIEW_PULL_LIMIT = 100;
const ROLE_LABELS: Readonly<Record<Role, MessageKey>> = { admin: "accessAdmin", editor: "accessEditor", viewer: "accessViewer" };

export function awaitsDecision(issue: Issue): boolean {
  return issue.state === "open" && issue.acceptance?.kind === "submitted" && issue.capabilities.close;
}

/**
 * Everything a person needs to judge an Issue's whole task in one place, in reading order. It shows only
 * what the reader may already see: each part reads through the same route and rules as its own page.
 */
export function IssueAcceptancePanel({ issue, timeline }: { readonly issue: Issue; readonly timeline: readonly TimelineItem[] }) {
  const { language, t } = useI18n();
  const assignees = new Set(issue.assignees.map((user) => user.id));
  const submission = timeline.filter((item) => item.type === "event" && item.kind === "submitted").at(-1);
  const comments = timeline.filter((item) => item.type === "comment" && assignees.has(item.author.id));
  return (
    <div className="grid min-w-0 gap-6" data-issue-acceptance-panel="">
      <Section title={t("issueAcceptanceTask")}>
        {issue.body.trim() ? <IssueMarkdown text={issue.body} /> : <Muted>{t("issueNoDescription")}</Muted>}
      </Section>
      <Section title={t("issueAcceptanceSubmission")}>
        {submission?.type === "event" ? (
          <Entry user={submission.actor} meta={t("issueAcceptanceSubmittedOn", { date: formatRelativeDate(submission.createdAt, language) })}>
            <IssueMarkdown text={typeof submission.payload["body"] === "string" ? submission.payload["body"] : ""} />
          </Entry>
        ) : (
          <Muted>{t("issueAcceptanceNotSubmitted")}</Muted>
        )}
        {comments.length > MAX_ROWS ? <Muted>{t("issueAcceptanceLatestComments", { count: comments.length, shown: MAX_ROWS })}</Muted> : null}
        {comments.slice(-MAX_ROWS).map((comment) =>
          comment.type === "comment" ? (
            <Entry key={comment.id} user={comment.author} meta={t("issueCommentedOn", { date: formatRelativeDate(comment.createdAt, language) })}>
              <IssueMarkdown text={comment.body} />
            </Entry>
          ) : null,
        )}
      </Section>
      <Section title={t("issuePullRequests")}>
        {issue.pullRequests.length === 0 ? <Muted>{t("issueNoPullRequests")}</Muted> : null}
        {issue.pullRequests.map((pull) => <AcceptancePull key={pull.id} pull={pull} spaceId={issue.space.id} />)}
        {issue.pullRequests.length >= ISSUE_VIEW_PULL_LIMIT ? <Muted>{t("issueAcceptancePullsBound", { count: ISSUE_VIEW_PULL_LIMIT })}</Muted> : null}
      </Section>
      <OutwardActions issue={issue} />
      {awaitsDecision(issue) ? <Decision spaceId={issue.space.id} number={issue.number} /> : null}
    </div>
  );
}

function Section({ title, note, children }: { readonly title: string; readonly note?: string; readonly children: ReactNode }) {
  return (
    <section aria-label={title} className="grid min-w-0 gap-3">
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      {note ? <Muted>{note}</Muted> : null}
      {children}
    </section>
  );
}

function Entry({ user, meta, children }: {
  readonly user: components["schemas"]["PublicUser"];
  readonly meta: string;
  readonly children: ReactNode;
}) {
  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-3 py-2 text-sm">
        <Avatar src={user.avatarUrl} name={user.displayName} size="xs" />
        <span className="font-semibold">{user.displayName}</span>
        <span className="text-muted-foreground">{meta}</span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </article>
  );
}

function AcceptancePull({ pull, spaceId }: { readonly pull: PullRequest; readonly spaceId: string }) {
  const { t } = useI18n();
  const detail = useQuery(worktreeQueryOptions(pull.id));
  const worktree = detail.data?.worktree;
  const files = worktree?.units.filter((unit) => unit.change !== "unchanged") ?? [];
  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-border" data-acceptance-pull={pull.id}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-3 py-2 text-sm">
        <GitPullRequest className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {pull.number === null ? (
          <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{pull.title}</span>
        ) : (
          <Link
            to="/spaces/$spaceId/pulls/$number"
            params={{ spaceId, number: String(pull.number) }}
            className="min-w-0 font-semibold text-foreground no-underline [overflow-wrap:anywhere] hover:underline"
          >
            {pull.title} <span className="font-normal text-muted-foreground">#{pull.number}</span>
          </Link>
        )}
        <Badge variant={worktreeStateVariant(pull.state)}>{worktreeStateLabel(pull.state, t)}</Badge>
        <span className="text-muted-foreground">
          {t("issueAcceptanceOpenedBy", { name: pull.author.displayName })}
          {pull.mergedBy ? ` · ${t("issueAcceptanceMergedBy", { name: pull.mergedBy.displayName })}` : ""}
        </span>
      </header>
      <div className="grid gap-2 px-3 py-3">
        {detail.isPending ? (
          <Spinner />
        ) : detail.isError ? (
          <p role="alert" className="m-0 text-sm text-destructive">{detail.error.message}</p>
        ) : pull.state === "discarded" ? (
          <Muted>{t("issueAcceptanceDiscarded")}</Muted>
        ) : !worktree?.capabilities.review ? (
          <Muted>{t("issueAcceptanceFilesHidden")}</Muted>
        ) : files.length === 0 ? (
          <Muted>{t("issueAcceptanceNoFiles")}</Muted>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {files.slice(0, MAX_ROWS).map((unit) => (
              <AcceptanceFile key={unit.unitId} worktreeId={pull.id} unit={unit} merged={pull.state === "merged"} />
            ))}
          </ul>
        )}
        {files.length > MAX_ROWS ? <Muted>{t("issueAcceptanceFilesBound", { count: files.length, shown: MAX_ROWS })}</Muted> : null}
      </div>
      {worktree?.capabilities.review && pull.state !== "discarded" ? <PullRequestChecks worktreeId={pull.id} explainNone /> : null}
    </article>
  );
}

function AcceptanceFile({ worktreeId, unit, merged }: {
  readonly worktreeId: string;
  readonly unit: WorktreeUnit;
  readonly merged: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trashed = merged && unit.change === "deleted" && unit.source === "trunk";
  return (
    <li className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <UnitChangeIcon change={unit.change} />
        <UnitTypeIcon type={unit.unitType} />
        <span className="min-w-0 flex-1 truncate">{unit.name}</span>
        {trashed ? null : (
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t(open ? "issueAcceptanceHideComparison" : "issueAcceptanceCompare")}
          </Button>
        )}
      </div>
      {trashed ? <Muted>{t("issueAcceptanceMovedToTrash")}</Muted> : null}
      {open ? <Comparison worktreeId={worktreeId} unitId={unit.unitId} merged={merged} /> : null}
    </li>
  );
}

function Comparison({ worktreeId, unitId, merged }: { readonly worktreeId: string; readonly unitId: string; readonly merged: boolean }) {
  const { language, t } = useI18n();
  const { resolvedTheme } = useTheme();
  const query = useQuery(worktreeUnitComparisonQueryOptions(worktreeId, unitId, merged ? "merge" : "draft"));
  if (query.isPending) return <div className="grid h-24 place-items-center"><Spinner /></div>;
  if (query.isError) return <p role="alert" className="m-0 text-sm text-destructive">{t("comparisonFailed")}</p>;
  const comparison = {
    result: query.data.result,
    left: { label: t(merged ? "issueAcceptanceBeforeMerge" : "officialVersion"), ...query.data.left },
    right: { label: t(merged ? "issueAcceptanceAfterMerge" : "agentVersion"), ...query.data.right },
  } as UnitComparisonViewerValue;
  return (
    <div className="flex h-[480px] min-w-0 flex-col overflow-hidden rounded-md border border-border max-sm:h-[760px]">
      <UnitComparisonViewer
        key={comparison.result.comparisonId}
        comparison={comparison}
        createUniver={createComparisonUniver}
        locale={language === "zh-CN" ? LocaleType.ZH_CN : LocaleType.EN_US}
        darkMode={resolvedTheme === "dark"}
      />
    </div>
  );
}

function OutwardActions({ issue }: { readonly issue: Issue }) {
  const { language, t } = useI18n();
  const changes = useQuery(issueAccessChangesQueryOptions(issue.space.id, issue.number));
  const details = useQueries({ queries: issue.pullRequests.map((pull) => worktreeQueryOptions(pull.id)) });
  const reviewable = issue.pullRequests.filter((_, index) => details[index]?.data?.worktree.capabilities.review);
  const drafts = useQueries({ queries: reviewable.map((pull) => worktreeHtmlViewDraftsQueryOptions(pull.id)) });
  const published = drafts
    .flatMap((query) => query.data ?? [])
    .filter((draft) => draft.published !== null)
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
  const date = (value: string) => formatRelativeDate(value, language);
  const none = (rows: readonly unknown[]) => (rows.length ? null : t("issueAcceptanceNone"));
  const personal = changes.data?.personalSharing;
  return (
    <Section title={t("issueAcceptanceOutward")} note={t("issueAcceptanceCurrentState")}>
      <Part title={t("issueAcceptancePublished")} emptyText={none(published)} truncated={published.length > MAX_ROWS}>
        {published.slice(0, MAX_ROWS).map((draft) => (
          <Row key={draft.id} meta={draft.decidedAt ? date(draft.decidedAt) : ""}>
            <Link to="/nodes/$nodeId" params={{ nodeId: draft.published!.nodeId }} className="text-foreground [overflow-wrap:anywhere]">
              {draft.name}
            </Link>
            <span className="text-muted-foreground"> · {t(draft.kind === "create" ? "issueAcceptanceNewPage" : "issueAcceptanceReplaced")}</span>
          </Row>
        ))}
      </Part>
      {changes.isPending ? (
        <Spinner />
      ) : changes.isError ? (
        <p role="alert" className="m-0 text-sm text-destructive">{changes.error.message}</p>
      ) : (
        <>
          <Part title={t("issueAcceptanceMembers")} emptyText={none(changes.data.members)} truncated={changes.data.membersTruncated}>
            {changes.data.members.map((member) => (
              <Row key={member.user.id} meta={date(member.updatedAt)}>
                {t("issueAcceptanceGrantRow", {
                  user: member.user.displayName, role: t(ROLE_LABELS[member.role]), actor: member.grantedBy.displayName,
                })}
              </Row>
            ))}
          </Part>
          <Muted>{t(changes.data.publicRead ? "issueAcceptancePublicRead" : "issueAcceptanceMembersOnly")}</Muted>
          <Part
            title={t("issueAcceptancePersonal")}
            emptyText={personal ? none(personal.items) : t("issueAcceptancePersonalHidden")}
            truncated={personal?.truncated ?? false}
          >
            {personal?.items.map((item) => (
              <Row key={`${item.kind}:${item.node.id}:${item.kind === "grant" ? item.user.id : ""}`} meta={date(item.updatedAt)}>
                <Link to="/nodes/$nodeId" params={{ nodeId: item.node.id }} className="text-foreground [overflow-wrap:anywhere]">
                  {item.node.name}
                </Link>{" "}
                {item.kind === "link"
                  ? t(item.enabled ? "issueAcceptanceLinkOn" : "issueAcceptanceLinkOff", { role: t(ROLE_LABELS[item.role]), actor: item.actor.displayName })
                  : t("issueAcceptanceGrantRow", { user: item.user.displayName, role: t(ROLE_LABELS[item.role]), actor: item.actor.displayName })}
              </Row>
            ))}
          </Part>
        </>
      )}
      <Muted>{t("issueAcceptanceCopiesUnknown")}</Muted>
    </Section>
  );
}

function Part({ title, emptyText, truncated = false, children }: {
  readonly title: string;
  readonly emptyText: string | null;
  readonly truncated?: boolean;
  readonly children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="grid min-w-0 gap-1.5">
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      {emptyText === null ? <ul className="m-0 grid list-none gap-1.5 p-0">{children}</ul> : <Muted>{emptyText}</Muted>}
      {truncated ? <Muted>{t("issueAcceptanceRowsBound", { count: MAX_ROWS })}</Muted> : null}
    </div>
  );
}

function Row({ meta, children }: { readonly meta: string; readonly children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span className="min-w-0">{children}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </li>
  );
}

function Decision({ spaceId, number }: { readonly spaceId: string; readonly number: number }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const verdict = useIssueVerdict(spaceId, number);
  const onError = (error: Error) => toast.error(error.message);
  return (
    <section aria-label={t("issueAcceptanceReview")} className="grid gap-3 rounded-lg border border-border p-4">
      <h2 className="m-0 text-base font-semibold">{t("issueAcceptanceReview")}</h2>
      <IssueComposer
        value={reason}
        onChange={setReason}
        ariaLabel={t("issueSendBackReason")}
        placeholder={t("issueSendBackPlaceholder")}
        rows={3}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          disabled={verdict.isPending || !reason.trim()}
          onClick={() => verdict.mutate({ kind: "sent_back", body: reason }, { onError, onSuccess: () => setReason("") })}
        >
          <Undo2 />
          {t("issueSendBack")}
        </Button>
        <Button disabled={verdict.isPending} onClick={() => verdict.mutate({ kind: "accepted" }, { onError })}>
          <CircleCheck />
          {t("issueAccept")}
        </Button>
      </div>
    </section>
  );
}
