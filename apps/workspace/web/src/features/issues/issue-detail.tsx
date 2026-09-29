import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  CircleCheck,
  CircleDot,
  CircleSlash,
  Ellipsis,
  Paperclip,
  Pencil,
  Tag,
  User,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { useI18n, type MessageKey } from "../../shared/i18n";
import {
  Avatar,
  Button,
  buttonVariants,
  ConfirmDialog,
  Empty,
  Input,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  Spinner,
  toast,
} from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { sessionQueryOptions } from "../auth";
import { NodeIcon } from "../nodes";
import { spacesQueryOptions } from "../spaces";
import { IssueComposer } from "./issue-composer";
import { IssueLabelChip } from "./issue-label";
import { IssueMarkdown } from "./issue-markdown";
import { IssueAssigneesDialog, IssueLabelsDialog, IssueReferencesDialog } from "./issue-pickers";
import { Muted, SidebarSection } from "./issue-sidebar-section";
import { IssueStateBadge } from "./issue-state";
import { issueQueryOptions, issueTimelineQueryOptions, issuesQueryKey } from "./issues.queries";

type Issue = components["schemas"]["Issue"];
type TimelineComment = components["schemas"]["IssueTimelineComment"];
type TimelineEvent = components["schemas"]["IssueTimelineEvent"];
type PublicUser = components["schemas"]["PublicUser"];
type UpdateIssue = components["schemas"]["UpdateIssue"];

export function IssueDetail({
  spaceId,
  number,
  canCreate,
}: {
  readonly spaceId: string;
  readonly number: number;
  readonly canCreate: boolean;
}) {
  const { language, t } = useI18n();
  const queryClient = useQueryClient();
  const issueQuery = useQuery(issueQueryOptions(spaceId, number));
  const timeline = useQuery(issueTimelineQueryOptions(spaceId, number));
  const session = useQuery(sessionQueryOptions);
  const spaces = useQuery(spacesQueryOptions);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [editingBody, setEditingBody] = useState(false);
  const [body, setBody] = useState("");
  const [comment, setComment] = useState("");
  const [picker, setPicker] = useState<"labels" | "assignees" | "references" | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: issuesQueryKey });
  };
  const patch = useMutation({
    mutationFn: async (input: UpdateIssue) => {
      const { error } = await api.PATCH("/api/spaces/{spaceId}/issues/{number}", {
        params: { path: { spaceId, number } },
        body: input,
      });
      if (error) throw apiError(error);
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const postComment = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await api.POST("/api/spaces/{spaceId}/issues/{number}/comments", {
        params: { path: { spaceId, number } },
        body: { body: text },
      });
      if (error) throw apiError(error);
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  if (issueQuery.isPending) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner />
      </div>
    );
  }
  if (issueQuery.error) {
    return (
      <Empty title={t("issueLoadFailed")} description={issueQuery.error.message}>
        <Button variant="secondary" onClick={() => void issueQuery.refetch()}>
          {t("repositoryPageRetry")}
        </Button>
      </Empty>
    );
  }
  const issue = issueQuery.data;
  const me = session.data?.authenticated ? session.data.user.id : undefined;
  const role = spaces.data?.spaces.find((space) => space.id === spaceId)?.accessRole;
  const canManageComments = role === "owner" || role === "admin";
  const busy = patch.isPending || postComment.isPending;

  const closeIssue = async (reason: "completed" | "not_planned") => {
    try {
      if (comment.trim()) {
        await postComment.mutateAsync(comment);
        setComment("");
      }
      await patch.mutateAsync({ state: "closed", stateReason: reason });
    } catch {
      // Both mutations report their own error toast.
    }
  };
  const submitComment = async () => {
    if (!comment.trim()) return;
    try {
      await postComment.mutateAsync(comment);
      setComment("");
    } catch {
      // The mutation reports the error.
    }
  };

  return (
    <div className="grid gap-6">
      <header className="grid gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {editingTitle ? (
            <form
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim()) return;
                patch.mutate({ title }, { onSuccess: () => setEditingTitle(false) });
              }}
            >
              <Input
                aria-label={t("issueTitle")}
                className="min-w-60 flex-1"
                maxLength={256}
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Button type="submit" disabled={busy || !title.trim()}>
                {t("save")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditingTitle(false)}>
                {t("cancel")}
              </Button>
            </form>
          ) : (
            <h2 className="m-0 min-w-0 flex-1 text-2xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]">
              {issue.title} <span className="font-normal text-muted-foreground">#{issue.number}</span>
            </h2>
          )}
          {!editingTitle ? (
            <div className="flex shrink-0 gap-2">
              {issue.capabilities.edit ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTitle(issue.title);
                    setEditingTitle(true);
                  }}
                >
                  <Pencil />
                  {t("editItem")}
                </Button>
              ) : null}
              {canCreate ? (
                <Link
                  to="/spaces/$spaceId/issues/new"
                  params={{ spaceId }}
                  search={{}}
                  className={cn(buttonVariants(), "no-underline")}
                >
                  {t("issueNew")}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <IssueStateBadge issue={issue} />
          <span>
            {t("issueOpenedMeta", {
              name: issue.author.displayName,
              date: formatRelativeDate(issue.createdAt, language),
            })}
            {" · "}
            {t("issueCommentCount", { count: issue.commentCount })}
          </span>
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <IssueSidebar
          issue={issue}
          onEdit={(kind) => setPicker(kind)}
          className="order-first lg:order-last"
        />
        <div className="grid min-w-0 gap-4">
          <Card
            author={issue.author}
            date={formatRelativeDate(issue.createdAt, language)}
            actions={
              issue.capabilities.edit && !editingBody ? (
                <MenuRoot>
                  <MenuTrigger
                    render={
                      <Button variant="ghost" size="icon-sm" aria-label={t("issueMoreActions")}>
                        <Ellipsis />
                      </Button>
                    }
                  />
                  <MenuContent align="end">
                    <MenuItem
                      onClick={() => {
                        setBody(issue.body);
                        setEditingBody(true);
                      }}
                    >
                      <Pencil />
                      {t("editItem")}
                    </MenuItem>
                  </MenuContent>
                </MenuRoot>
              ) : null
            }
          >
            {editingBody ? (
              <div className="grid gap-3">
                <IssueComposer value={body} onChange={setBody} ariaLabel={t("issueBody")} />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setEditingBody(false)}>
                    {t("cancel")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => patch.mutate({ body }, { onSuccess: () => setEditingBody(false) })}
                  >
                    {t("save")}
                  </Button>
                </div>
              </div>
            ) : issue.body.trim() ? (
              <IssueMarkdown text={issue.body} />
            ) : (
              <p className="m-0 text-sm text-muted-foreground italic">{t("issueNoDescription")}</p>
            )}
          </Card>

          {timeline.isPending ? (
            <div className="grid place-items-center py-6">
              <Spinner />
            </div>
          ) : timeline.error ? (
            <p role="alert" className="m-0 text-sm text-destructive">
              {timeline.error.message}
            </p>
          ) : (
            timeline.data.map((item) =>
              item.type === "comment" ? (
                <CommentCard
                  key={item.id}
                  comment={item}
                  canEdit={me === item.author.id && issue.capabilities.comment}
                  canDelete={(me === item.author.id && issue.capabilities.comment) || canManageComments}
                />
              ) : (
                <EventLine key={item.id} event={item} />
              ),
            )
          )}

          {issue.capabilities.comment ? (
            <section aria-label={t("issueAddComment")} className="grid gap-3 rounded-lg border border-border p-4">
              <IssueComposer
                value={comment}
                onChange={setComment}
                ariaLabel={t("issueAddComment")}
                placeholder={t("issueCommentPlaceholder")}
                rows={4}
                onSubmit={() => void submitComment()}
              />
              <div className="flex flex-wrap justify-end gap-2">
                {issue.capabilities.close ? (
                  issue.state === "open" ? (
                    <div className="flex">
                      <Button
                        variant="secondary"
                        className="rounded-r-none"
                        disabled={busy}
                        onClick={() => void closeIssue("completed")}
                      >
                        <CircleCheck className="text-state-merged" />
                        {comment.trim() ? t("issueCloseWithComment") : t("issueClose")}
                      </Button>
                      <MenuRoot>
                        <MenuTrigger
                          render={
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-9 rounded-l-none border-l-0"
                              aria-label={t("issueCloseOptions")}
                              disabled={busy}
                            >
                              <ChevronDown />
                            </Button>
                          }
                        />
                        <MenuContent align="end">
                          <MenuItem onClick={() => void closeIssue("completed")}>
                            <CircleCheck className="text-state-merged" />
                            {t("issueCloseAsCompleted")}
                          </MenuItem>
                          <MenuItem onClick={() => void closeIssue("not_planned")}>
                            <CircleSlash />
                            {t("issueCloseAsNotPlanned")}
                          </MenuItem>
                        </MenuContent>
                      </MenuRoot>
                    </div>
                  ) : (
                    <Button variant="secondary" disabled={busy} onClick={() => patch.mutate({ state: "open" })}>
                      <CircleDot className="text-state-open" />
                      {t("issueReopen")}
                    </Button>
                  )
                ) : null}
                <Button disabled={busy || !comment.trim()} onClick={() => void submitComment()}>
                  {t("issueComment")}
                </Button>
              </div>
            </section>
          ) : (
            <p className="m-0 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t("issueMembersOnly")}
            </p>
          )}
        </div>
      </div>

      <IssueLabelsDialog
        spaceId={spaceId}
        open={picker === "labels"}
        onOpenChange={(open) => setPicker(open ? "labels" : null)}
        selected={issue.labels.map((label) => label.id)}
        saving={patch.isPending}
        onSave={(labelIds) => patch.mutate({ labelIds }, { onSuccess: () => setPicker(null) })}
      />
      <IssueAssigneesDialog
        spaceId={spaceId}
        open={picker === "assignees"}
        onOpenChange={(open) => setPicker(open ? "assignees" : null)}
        current={issue.assignees}
        saving={patch.isPending}
        onSave={(assigneeUserIds) => patch.mutate({ assigneeUserIds }, { onSuccess: () => setPicker(null) })}
      />
      <IssueReferencesDialog
        spaceId={spaceId}
        open={picker === "references"}
        onOpenChange={(open) => setPicker(open ? "references" : null)}
        selected={issue.references.map((reference) => reference.nodeId)}
        saving={patch.isPending}
        onSave={(nodeIds) => patch.mutate({ nodeIds }, { onSuccess: () => setPicker(null) })}
      />
    </div>
  );
}

function Card({
  author,
  date,
  actions,
  edited,
  children,
}: {
  readonly author: PublicUser;
  readonly date: string;
  readonly actions?: ReactNode;
  readonly edited?: boolean;
  readonly children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2 text-sm">
        <Avatar src={author.avatarUrl} name={author.displayName} size="xs" />
        <span className="font-semibold text-foreground">{author.displayName}</span>
        <span className="text-muted-foreground">{date}</span>
        {edited ? <span className="text-muted-foreground">· {t("issueEdited")}</span> : null}
        <span className="ml-auto">{actions}</span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </article>
  );
}

function CommentCard({
  comment,
  canEdit,
  canDelete,
}: {
  readonly comment: TimelineComment;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}) {
  const { language, t } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: issuesQueryKey });
  };
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH("/api/issue-comments/{commentId}", {
        params: { path: { commentId: comment.id } },
        body: { body: text },
      });
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/api/issue-comments/{commentId}", {
        params: { path: { commentId: comment.id } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const edited = Date.parse(comment.updatedAt) - Date.parse(comment.createdAt) > 1000;
  return (
    <>
      <Card
        author={comment.author}
        date={formatRelativeDate(comment.createdAt, language)}
        edited={edited}
        actions={
          (canEdit || canDelete) && !editing ? (
            <MenuRoot>
              <MenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={t("issueMoreActions")}>
                    <Ellipsis />
                  </Button>
                }
              />
              <MenuContent align="end">
                {canEdit ? (
                  <MenuItem
                    onClick={() => {
                      setText(comment.body);
                      setEditing(true);
                    }}
                  >
                    <Pencil />
                    {t("editItem")}
                  </MenuItem>
                ) : null}
                {canDelete ? (
                  <MenuItem
                    className="text-destructive data-highlighted:bg-destructive-soft data-highlighted:text-destructive [&_svg]:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    {t("remove")}
                  </MenuItem>
                ) : null}
              </MenuContent>
            </MenuRoot>
          ) : null
        }
      >
        {editing ? (
          <div className="grid gap-3">
            <IssueComposer value={text} onChange={setText} ariaLabel={t("issueComment")} rows={4} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)}>
                {t("cancel")}
              </Button>
              <Button disabled={save.isPending || !text.trim()} onClick={() => save.mutate()}>
                {t("save")}
              </Button>
            </div>
          </div>
        ) : (
          <IssueMarkdown text={comment.body} />
        )}
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("issueDeleteCommentTitle")}
        description={t("issueDeleteCommentDescription")}
        confirmText={t("remove")}
        cancelText={t("cancel")}
        danger
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

const EVENT_MESSAGES: Readonly<Record<TimelineEvent["kind"], MessageKey>> = {
  closed: "issueEventClosed",
  reopened: "issueEventReopened",
  renamed: "issueEventRenamed",
  labeled: "issueEventLabeled",
  unlabeled: "issueEventUnlabeled",
  assigned: "issueEventAssigned",
  unassigned: "issueEventUnassigned",
  node_referenced: "issueEventNodeReferenced",
  node_unreferenced: "issueEventNodeUnreferenced",
};

/** Replaces `{name}` placeholders with nodes so each language keeps its own word order. */
function interpolate(template: string, nodes: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={index}>{name === undefined ? part : (nodes[name] ?? "")}</Fragment>;
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function EventLine({ event }: { readonly event: TimelineEvent }) {
  const { language, t } = useI18n();
  const payload = event.payload;
  const notPlanned = event.kind === "closed" && payload["reason"] === "not_planned";
  const key = notPlanned ? "issueEventClosedNotPlanned" : EVENT_MESSAGES[event.kind];
  const strong = (value: string) => <strong className="font-semibold text-foreground">{value || "?"}</strong>;
  const nodes: Record<string, ReactNode> = {
    actor: strong(event.actor.displayName),
    from: strong(text(payload["from"])),
    to: strong(text(payload["to"])),
    label: <IssueLabelChip name={text(payload["name"])} color={text(payload["color"])} />,
    user: strong(text(payload["displayName"]) || text(payload["username"])),
    name: strong(text(payload["name"])),
  };
  const Icon =
    event.kind === "closed"
      ? notPlanned
        ? CircleSlash
        : CircleCheck
      : event.kind === "reopened"
        ? CircleDot
        : event.kind === "renamed"
          ? Pencil
          : event.kind === "labeled" || event.kind === "unlabeled"
            ? Tag
            : event.kind === "assigned" || event.kind === "unassigned"
              ? User
              : Paperclip;
  const tone =
    event.kind === "closed"
      ? notPlanned
        ? "text-muted-foreground"
        : "text-state-merged"
      : event.kind === "reopened"
        ? "text-state-open"
        : "text-subtle-foreground";
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-4 text-sm text-muted-foreground">
      <Icon className={cn("size-4 shrink-0", tone)} aria-hidden="true" />
      <span className="flex flex-wrap items-center gap-x-1.5">{interpolate(t(key), nodes)}</span>
      <span aria-hidden="true">·</span>
      <span>{formatRelativeDate(event.createdAt, language)}</span>
    </p>
  );
}

function IssueSidebar({
  issue,
  onEdit,
  className,
}: {
  readonly issue: Issue;
  readonly onEdit: (kind: "labels" | "assignees" | "references") => void;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const triage = issue.capabilities.triage;
  return (
    <aside className={cn("grid min-w-0 gap-4 max-lg:grid-cols-2 max-[560px]:grid-cols-1", className)}>
      <SidebarSection title={t("issueAssignees")} onEdit={triage ? () => onEdit("assignees") : undefined}>
        {issue.assignees.length ? (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {issue.assignees.map((user) => (
              <li key={user.id} className="flex min-w-0 items-center gap-2">
                <Avatar src={user.avatarUrl} name={user.displayName} size="xs" />
                <span className="truncate text-sm">{user.displayName}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>{t("issueNoAssignees")}</Muted>
        )}
      </SidebarSection>
      <SidebarSection title={t("issueLabels")} onEdit={triage ? () => onEdit("labels") : undefined}>
        {issue.labels.length ? (
          <div className="flex flex-wrap gap-1.5">
            {issue.labels.map((label) => (
              <IssueLabelChip key={label.id} name={label.name} color={label.color} />
            ))}
          </div>
        ) : (
          <Muted>{t("issueNoLabels")}</Muted>
        )}
      </SidebarSection>
      <SidebarSection
        title={t("issueReferences")}
        onEdit={triage ? () => onEdit("references") : undefined}
        className="max-lg:col-span-full"
      >
        {issue.references.length ? (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {issue.references.map((reference) => (
              <li key={reference.nodeId} className="flex min-w-0 items-center gap-2 text-sm">
                {reference.available && reference.name !== null ? (
                  <>
                    <NodeIcon
                      kind={reference.resource ? "resource" : "group"}
                      resourceKind={reference.resource?.kind}
                      unitType={reference.resource?.kind === "univer" ? reference.resource.unitType : null}
                      mediaType={reference.resource?.kind === "blob" ? reference.resource.mediaType : null}
                      name={reference.name}
                    />
                    <Link
                      to="/nodes/$nodeId"
                      params={{ nodeId: reference.nodeId }}
                      className="truncate text-foreground no-underline hover:underline"
                    >
                      {reference.name}
                    </Link>
                  </>
                ) : (
                  <span className="text-muted-foreground italic">{t("issueReferenceUnavailable")}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Muted>{t("issueNoReferences")}</Muted>
        )}
      </SidebarSection>
    </aside>
  );
}
