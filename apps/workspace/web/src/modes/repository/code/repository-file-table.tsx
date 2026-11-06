import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  Database,
  File,
  FileText,
  Folder,
  FolderUp,
  LayoutDashboard,
  Presentation,
  Search,
  Table2,
  X,
} from "lucide-react";
import { useState } from "react";
import type { components } from "../../../../../generated/http/schema.js";
import { CreateNodeDropdown } from "../../../features/nodes/create-node-dropdown";
import { filterNodes } from "../../../features/nodes/filter-nodes";
import { NodeActionsMenu } from "../../../features/nodes/node-actions-menu";
import { useNodeEditDialog } from "../../../features/nodes/node-edit-dialog";
import { nodeParentRow } from "../../../features/nodes/node-parent-row";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import { Button, Empty, Input } from "../../../shared/ui";
import { dayKeyOf, type ActivityEvent, type DayKey, type PendingChangeIndex } from "../data";
import { PullRequestLink } from "../repository-pull-request-link";
import { ActorAvatar } from "./actor-avatar";
import { ActivityEventLine } from "./activity-event";
import { formatChartDay } from "./activity-chart";
import { PendingChip } from "./pending-chip";

type NodePage = components["schemas"]["NodePage"];
type FileType = "group" | "blob" | components["schemas"]["UnitType"];
const icons = {
  group: Folder,
  blob: File,
  doc: FileText,
  sheet: Table2,
  slide: Presentation,
  board: LayoutDashboard,
  base: Database,
};

export function TypeBadge({ type }: { readonly type: FileType }) {
  const { t } = useI18n();
  const Icon = icons[type];
  return (
    <span className={`rd-tb rd-tb-${type}`} title={t(type === "blob" ? "file" : type)}>
      <Icon aria-hidden="true" />
    </span>
  );
}

export function RepositoryFileTable({
  page,
  canCreateAtRoot = false,
  spaceName,
  pending,
  latest,
  pickedDay = null,
  onClearDay,
  searchQuery,
  onSearchChange,
}: {
  readonly page: NodePage;
  readonly canCreateAtRoot?: boolean;
  readonly spaceName?: string | undefined;
  readonly pending: PendingChangeIndex | undefined;
  readonly latest: ActivityEvent | undefined;
  readonly pickedDay?: DayKey | null;
  readonly onClearDay?: () => void;
  readonly searchQuery?: string;
  readonly onSearchChange?: (query: string) => void;
}) {
  const { t, language } = useI18n();
  const [localSearch, setLocalSearch] = useState("");
  const search = searchQuery ?? localSearch;
  const setSearch = onSearchChange ?? setLocalSearch;
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const edit = useNodeEditDialog();
  const parentId = page.parentNode?.id ?? null;
  const parent = parentId ? nodeParentRow(page, spaceName) : undefined;
  const canCreate = page.parentNode?.capabilities.createChildren ?? canCreateAtRoot;
  const nodes = filterNodes(page.nodes, "all", normalizedSearch)
    .filter((node) => !pickedDay || dayKeyOf(node.updatedAt) === pickedDay)
    .sort((a, b) => Number(b.resource === null) - Number(a.resource === null));
  const listedChanges = new Set(page.nodes.flatMap((node) => pending?.byNode.get(node.id) ?? []));
  // shortcut: pending additions have no changed timestamp, show them only without a day filter until the API supplies one.
  const additions = pickedDay
    ? []
    : (pending?.additionsByParent.get(parentId ?? "root") ?? []).filter((change) =>
        !listedChanges.has(change) && change.unitName.toLocaleLowerCase().includes(normalizedSearch),
      );
  return (
    <>
      <div className="rd-ftool">
        <label className="rd-file-search">
          <Search aria-hidden="true" />
          <Input
            aria-label={t("repositoryGoToFile")}
            placeholder={t("repositoryGoToFile")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {pickedDay ? (
          <button className="rd-dayf" type="button" onClick={onClearDay}>
            <CalendarDays aria-hidden="true" />
            {t("repositoryChangedOn", { day: formatChartDay(pickedDay, language) })}
            <X aria-hidden="true" />
          </button>
        ) : null}
        {canCreate ? (
          <div className="rd-file-new">
            <CreateNodeDropdown spaceId={page.space.id} parentNodeId={parentId} />
          </div>
        ) : null}
      </div>
      <div className="rd-files">
        <div className="rd-file-head">
          {latest ? (
            <ActivityEventLine event={latest} />
          ) : (
            <span>{t("itemsCount", { count: page.nodes.length })}</span>
          )}
        </div>
        {parent ? (
          <div className="rd-frow rd-parent">
            <div className="rd-fname">
              <FolderUp aria-hidden="true" />
              {parent.nodeId === undefined ? (
                <Link
                  to="/spaces/$spaceId"
                  params={{ spaceId: page.space.id }}
                  search={{}}
                  aria-label={t("repositoryGoToParent", { name: parent.label })}
                >
                  ..
                </Link>
              ) : (
                <Link
                  to="/nodes/$nodeId"
                  params={{ nodeId: parent.nodeId }}
                  aria-label={t("repositoryGoToParent", { name: parent.label })}
                >
                  ..
                </Link>
              )}
            </div>
            <span className="rd-fnote">{t("parentDirectory")}</span>
          </div>
        ) : null}
        {nodes.map((node) => {
          const changes = pending?.byNode.get(node.id) ?? [];
          const change = changes[0];
          const type =
            node.resource === null
              ? "group"
              : node.resource.kind === "univer"
                ? node.resource.unitType
                : "blob";
          const deleted = changes.some(
            (change) => change.scope === "self" && change.kind === "deleted",
          );
          return (
            <NodeActionsMenu key={node.id} node={node} onEdit={() => edit.onEdit(node)}>
              {(actions) => (
                <div className={`rd-frow${deleted ? " rd-deleted" : ""}`}>
                  <div className="rd-fname">
                    <TypeBadge type={type} />
                    <Link to="/nodes/$nodeId" params={{ nodeId: node.id }}>
                      {node.name}
                    </Link>
                    {changes.map((change, i) => (
                      <PendingChip key={`${change.pull.id}-${i}`} change={change} />
                    ))}
                  </div>
                  <div className="rd-fnote" title={change?.pull.title}>
                    {change?.pull.title ?? t(type === "blob" ? "file" : type)}
                  </div>
                  <div className="rd-fwho">
                    {change ? (
                      <>
                        <ActorAvatar actor={change.actor} size="sm" />
                        <span>
                          {change.actor.user?.displayName ||
                            change.actor.user?.username ||
                            t("repositoryUnknownActor")}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="rd-fwhen">
                    <time
                      dateTime={node.updatedAt}
                      title={new Date(node.updatedAt).toLocaleString(language)}
                    >
                      {formatRelativeDate(node.updatedAt, language)}
                    </time>
                    <div className="rd-file-actions">{actions}</div>
                  </div>
                </div>
              )}
            </NodeActionsMenu>
          );
        })}
        {additions.map((change, i) => (
          <div className="rd-frow rd-ghost" key={`${change.pull.id}-${change.unitName}-${i}`}>
            <div className="rd-fname">
              <TypeBadge type={change.unitType} />
              <PullRequestLink
                target={{ spaceId: change.pull.spaceId ?? undefined, worktree: change.pull }}
              >
                {change.unitName}
              </PullRequestLink>
              <PendingChip change={change} />
            </div>
            <div className="rd-fnote" title={change.pull.title}>
              {change.pull.title}
            </div>
            <div className="rd-fwho">
              <ActorAvatar actor={change.actor} size="sm" />
              <span>
                {change.actor.user?.displayName ||
                  change.actor.user?.username ||
                  t("repositoryUnknownActor")}
              </span>
            </div>
            <div className="rd-fwhen">{t("repositoryPendingAddition")}</div>
          </div>
        ))}
        {nodes.length === 0 && additions.length === 0 ? (
          <Empty
            title={
              pickedDay
                ? t("repositoryNoChangesOn", { day: formatChartDay(pickedDay, language) })
                : t(normalizedSearch ? "noMatchingNodes" : "groupEmpty")
            }
          >
            {pickedDay || normalizedSearch ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch("");
                  onClearDay?.();
                }}
              >
                {t("clearFilters")}
              </Button>
            ) : null}
          </Empty>
        ) : null}
      </div>
      {pending && !pending.complete ? (
        <p className="rd-data-note">{t("repositoryPartialData")}</p>
      ) : null}
      {edit.dialog}
    </>
  );
}
