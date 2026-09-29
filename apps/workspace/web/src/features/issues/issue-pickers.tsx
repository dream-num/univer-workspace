import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { useI18n } from "../../shared/i18n";
import { Avatar, Button, Dialog, Input, Spinner } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { NodeIcon, nodeChildrenQueryOptions, spaceNodesQueryOptions } from "../nodes";
import { teamMembersQueryOptions } from "../permissions";
import { IssueLabelChip } from "./issue-label";
import { issueLabelsQueryOptions } from "./issues.queries";

type PublicUser = components["schemas"]["PublicUser"];
type NodeSummary = components["schemas"]["NodeSummary"];

interface ChecklistItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly keywords: string;
}

/** A modal checklist that commits the whole selection once, when the user confirms. */
function ChecklistDialog({
  open,
  onOpenChange,
  title,
  items,
  selected,
  saving,
  loading,
  emptyText,
  searchPlaceholder,
  onSave,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly items: readonly ChecklistItem[];
  readonly selected: readonly string[];
  readonly saving: boolean;
  readonly loading?: boolean;
  readonly emptyText: string;
  readonly searchPlaceholder: string;
  readonly onSave: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ReadonlySet<string>>(new Set(selected));
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (open) {
      setDraft(new Set(selected));
      setFilter("");
    }
    // Reset only when the dialog opens; edits in flight must survive background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const visible = items.filter((item) => item.keywords.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button disabled={saving} onClick={() => onSave([...draft])}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {items.length > 6 ? (
          <Input
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        ) : null}
        {loading ? (
          <div className="grid place-items-center py-8">
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <p className="m-0 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="m-0 grid max-h-72 list-none gap-0.5 overflow-y-auto p-0">
            {visible.map((item) => (
              <li key={item.id}>
                <label className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={draft.has(item.id)}
                    onChange={(event) => {
                      const next = new Set(draft);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      setDraft(next);
                    }}
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-2">{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

export function UserLabel({ user }: { readonly user: PublicUser }) {
  return (
    <>
      <Avatar src={user.avatarUrl} name={user.displayName} size="xs" />
      <span className="truncate text-sm">{user.displayName}</span>
      <span className="truncate text-xs text-muted-foreground">@{user.username}</span>
    </>
  );
}

export function IssueLabelsDialog({
  spaceId,
  open,
  onOpenChange,
  selected,
  saving,
  onSave,
}: {
  readonly spaceId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selected: readonly string[];
  readonly saving: boolean;
  readonly onSave: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const labels = useQuery({ ...issueLabelsQueryOptions(spaceId), enabled: open });
  return (
    <ChecklistDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("issueEditLabels")}
      items={(labels.data ?? []).map((label) => ({
        id: label.id,
        keywords: `${label.name} ${label.description}`,
        label: (
          <>
            <IssueLabelChip name={label.name} color={label.color} />
            <span className="truncate text-xs text-muted-foreground">{label.description}</span>
          </>
        ),
      }))}
      selected={selected}
      saving={saving}
      loading={labels.isPending}
      emptyText={t("issueLabelsEmpty")}
      searchPlaceholder={t("issueFilterLabel")}
      onSave={onSave}
    />
  );
}

export function IssueAssigneesDialog({
  spaceId,
  open,
  onOpenChange,
  current,
  saving,
  onSave,
}: {
  readonly spaceId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Kept selectable so a former member can still be unassigned. */
  readonly current: readonly PublicUser[];
  readonly saving: boolean;
  readonly onSave: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const members = useQuery({ ...teamMembersQueryOptions(spaceId), enabled: open });
  const users = useMemo(() => {
    const byId = new Map<string, PublicUser>();
    if (members.data) {
      byId.set(members.data.owner.id, members.data.owner);
      for (const member of members.data.members) byId.set(member.user.id, member.user);
    }
    for (const user of current) if (!byId.has(user.id)) byId.set(user.id, user);
    return [...byId.values()];
  }, [members.data, current]);
  return (
    <ChecklistDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("issueEditAssignees")}
      items={users.map((user) => ({
        id: user.id,
        keywords: `${user.displayName} ${user.username}`,
        label: <UserLabel user={user} />,
      }))}
      selected={current.map((user) => user.id)}
      saving={saving}
      loading={members.isPending}
      emptyText={t("issueAssigneesEmpty")}
      searchPlaceholder={t("issueSearchMembers")}
      onSave={onSave}
    />
  );
}

/**
 * Browses the Space tree one level at a time. Selection survives navigation between folders, and
 * names are remembered so the parent can display files picked from a deeper level.
 */
export function IssueReferencesDialog({
  spaceId,
  open,
  onOpenChange,
  selected,
  saving,
  onSave,
}: {
  readonly spaceId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selected: readonly string[];
  readonly saving: boolean;
  readonly onSave: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [trail, setTrail] = useState<readonly { readonly id: string; readonly name: string }[]>([]);
  const [draft, setDraft] = useState<ReadonlySet<string>>(new Set(selected));
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (open) {
      setDraft(new Set(selected));
      setTrail([]);
      setFilter("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const parent = trail.at(-1);
  const root = useQuery({ ...spaceNodesQueryOptions(spaceId), enabled: open && !parent });
  const children = useQuery({ ...nodeChildrenQueryOptions(parent?.id ?? ""), enabled: open && Boolean(parent) });
  const active = parent ? children : root;
  const nodes: readonly NodeSummary[] = (active.data?.nodes ?? []).filter((node) =>
    node.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("issueEditReferences")}
      description={t("issueReferencesDescription")}
      width="md"
      footer={
        <>
          <span className="mr-auto text-sm text-muted-foreground">
            {t("issueReferencesSelected", { count: draft.size })}
          </span>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button disabled={saving} onClick={() => onSave([...draft])}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <nav aria-label={t("issueReferencesLocation")} className="flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            className="rounded-sm text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => setTrail([])}
          >
            {t("issueReferencesRoot")}
          </button>
          {trail.map((item, index) => (
            <span key={item.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-subtle-foreground" aria-hidden="true" />
              <button
                type="button"
                className="max-w-40 truncate rounded-sm text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setTrail(trail.slice(0, index + 1))}
              >
                {item.name}
              </button>
            </span>
          ))}
        </nav>
        <Input
          aria-label={t("issueReferencesFilter")}
          placeholder={t("issueReferencesFilter")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {active.isPending ? (
          <div className="grid place-items-center py-8">
            <Spinner />
          </div>
        ) : nodes.length === 0 ? (
          <p className="m-0 py-6 text-center text-sm text-muted-foreground">{t("issueReferencesEmpty")}</p>
        ) : (
          <ul className="m-0 grid max-h-72 list-none gap-0.5 overflow-y-auto p-0">
            {nodes.map((node) => (
              <li key={node.id} className="flex items-center gap-1">
                <label className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={draft.has(node.id)}
                    onChange={(event) => {
                      const next = new Set(draft);
                      if (event.target.checked) next.add(node.id);
                      else next.delete(node.id);
                      setDraft(next);
                    }}
                  />
                  <NodeIcon
                    kind={node.resource ? "resource" : "group"}
                    resourceKind={node.resource?.kind}
                    unitType={node.resource?.kind === "univer" ? node.resource.unitType : null}
                    mediaType={node.resource?.kind === "blob" ? node.resource.mediaType : null}
                    name={node.name}
                  />
                  <span className="truncate text-sm">{node.name}</span>
                </label>
                {node.hasChildren ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("issueReferencesOpenFolder", { name: node.name })}
                    onClick={() => {
                      setTrail([...trail, { id: node.id, name: node.name }]);
                      setFilter("");
                    }}
                  >
                    <Folder />
                  </Button>
                ) : (
                  <span className={cn("size-7 shrink-0")} aria-hidden="true" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
