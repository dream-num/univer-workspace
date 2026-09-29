import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { Avatar, Button, buttonVariants, Field, Input, toast } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { NodeIcon, nodeQueryOptions } from "../nodes";
import { teamMembersQueryOptions } from "../permissions";
import { IssueComposer } from "./issue-composer";
import { IssueLabelChip } from "./issue-label";
import { IssueAssigneesDialog, IssueLabelsDialog, IssueReferencesDialog } from "./issue-pickers";
import { Muted, SidebarSection } from "./issue-sidebar-section";
import { issueLabelsQueryOptions, issuesQueryKey } from "./issues.queries";

export function IssueNewForm({
  spaceId,
  canTriage,
  initialNodeId,
}: {
  readonly spaceId: string;
  readonly canTriage: boolean;
  readonly initialNodeId?: string | undefined;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [titleError, setTitleError] = useState<string>();
  const [labelIds, setLabelIds] = useState<readonly string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<readonly string[]>([]);
  const [nodeIds, setNodeIds] = useState<readonly string[]>(canTriage && initialNodeId ? [initialNodeId] : []);
  const [picker, setPicker] = useState<"labels" | "assignees" | "references" | null>(null);

  const labels = useQuery({ ...issueLabelsQueryOptions(spaceId), enabled: canTriage });
  const members = useQuery({ ...teamMembersQueryOptions(spaceId), enabled: canTriage });
  const nodes = useQueries({ queries: nodeIds.map((id) => nodeQueryOptions(id)) });
  const users = [
    ...(members.data ? [members.data.owner, ...members.data.members.map((member) => member.user)] : []),
  ];

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/spaces/{spaceId}/issues", {
        params: { path: { spaceId } },
        body: {
          title: title.trim(),
          ...(body.trim() ? { body } : {}),
          ...(labelIds.length ? { labelIds: [...labelIds] } : {}),
          ...(assigneeIds.length ? { assigneeUserIds: [...assigneeIds] } : {}),
          ...(nodeIds.length ? { nodeIds: [...nodeIds] } : {}),
        },
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: async (issue) => {
      await queryClient.invalidateQueries({ queryKey: issuesQueryKey });
      await navigate({
        to: "/spaces/$spaceId/issues/$number",
        params: { spaceId, number: String(issue.number) },
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setTitleError(t("issueTitleRequired"));
      return;
    }
    create.mutate();
  };

  return (
    <form onSubmit={submit} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 gap-4">
        <Field label={t("issueTitle")} htmlFor="issue-title" error={titleError} required>
          <Input
            id="issue-title"
            maxLength={256}
            autoFocus
            invalid={Boolean(titleError)}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleError(undefined);
            }}
          />
        </Field>
        <Field label={t("issueBody")} htmlFor="issue-body">
          <IssueComposer
            id="issue-body"
            ariaLabel={t("issueBody")}
            value={body}
            onChange={setBody}
            placeholder={t("issueBodyPlaceholder")}
            rows={10}
            onSubmit={() => {
              if (title.trim()) create.mutate();
              else setTitleError(t("issueTitleRequired"));
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Link
            to="/spaces/$spaceId/issues"
            params={{ spaceId }}
            search={{}}
            className={cn(buttonVariants({ variant: "secondary" }), "no-underline")}
          >
            {t("cancel")}
          </Link>
          <Button type="submit" disabled={create.isPending}>
            {t("issueSubmit")}
          </Button>
        </div>
      </div>

      {canTriage ? (
        <aside className="grid min-w-0 gap-4 max-lg:order-first">
          <SidebarSection title={t("issueAssignees")} onEdit={() => setPicker("assignees")}>
            {assigneeIds.length ? (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {assigneeIds.map((id) => {
                  const user = users.find((candidate) => candidate.id === id);
                  return (
                    <li key={id} className="flex items-center gap-2 text-sm">
                      <Avatar src={user?.avatarUrl} name={user?.displayName ?? "?"} size="xs" />
                      <span className="truncate">{user?.displayName ?? id}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Muted>{t("issueNoAssignees")}</Muted>
            )}
          </SidebarSection>
          <SidebarSection title={t("issueLabels")} onEdit={() => setPicker("labels")}>
            {labelIds.length ? (
              <div className="flex flex-wrap gap-1.5">
                {labelIds.map((id) => {
                  const label = labels.data?.find((candidate) => candidate.id === id);
                  return label ? <IssueLabelChip key={id} name={label.name} color={label.color} /> : null;
                })}
              </div>
            ) : (
              <Muted>{t("issueNoLabels")}</Muted>
            )}
          </SidebarSection>
          <SidebarSection title={t("issueReferences")} onEdit={() => setPicker("references")}>
            {nodeIds.length ? (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {nodeIds.map((id, index) => {
                  const node = nodes[index]?.data?.node;
                  return (
                    <li key={id} className="flex min-w-0 items-center gap-2 text-sm">
                      {node ? (
                        <>
                          <NodeIcon
                            kind={node.resource ? "resource" : "group"}
                            resourceKind={node.resource?.kind}
                            unitType={node.resource?.kind === "univer" ? node.resource.unitType : null}
                            mediaType={node.resource?.kind === "blob" ? node.resource.mediaType : null}
                            name={node.name}
                          />
                          <span className="truncate">{node.name}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">…</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Muted>{t("issueNoReferences")}</Muted>
            )}
          </SidebarSection>
        </aside>
      ) : null}

      <IssueLabelsDialog
        spaceId={spaceId}
        open={picker === "labels"}
        onOpenChange={(open) => setPicker(open ? "labels" : null)}
        selected={labelIds}
        saving={false}
        onSave={(ids) => {
          setLabelIds(ids);
          setPicker(null);
        }}
      />
      <IssueAssigneesDialog
        spaceId={spaceId}
        open={picker === "assignees"}
        onOpenChange={(open) => setPicker(open ? "assignees" : null)}
        current={users.filter((user) => assigneeIds.includes(user.id))}
        saving={false}
        onSave={(ids) => {
          setAssigneeIds(ids);
          setPicker(null);
        }}
      />
      <IssueReferencesDialog
        spaceId={spaceId}
        open={picker === "references"}
        onOpenChange={(open) => setPicker(open ? "references" : null)}
        selected={nodeIds}
        saving={false}
        onSave={(ids) => {
          setNodeIds(ids);
          setPicker(null);
        }}
      />
    </form>
  );
}
