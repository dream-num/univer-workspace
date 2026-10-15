import { Link } from "@tanstack/react-router";
import { FolderUp, Search } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useUpdateNode } from "./nodes.commands";
import type { components } from "../../../../generated/http/schema.js";
import { NodeIcon } from "./node-icon";
import { CreateNodeDropdown } from "./create-node-dropdown";
import { NodeActionsMenu } from "./node-actions-menu";
import { nodeParentRow } from "./node-parent-row";
import { useI18n } from "../../shared/i18n";
import { formatRelativeDate } from "../../shared/format-relative-date";
import {
  Breadcrumb,
  Button,
  Dialog,
  DialogClose,
  Empty,
  Field,
  Input,
  Select,
  toast,
} from "../../shared/ui";
import { cn } from "../../shared/utils/cn";

type NodePage = components["schemas"]["NodePage"];
type Node = NodePage["nodes"][number];
type UnitType = components["schemas"]["UnitType"];
type NodeFilter =
  | "all"
  | "group"
  | "blob"
  | UnitType;

const nodeGrid =
  "grid items-center gap-5 grid-cols-[minmax(280px,1fr)_132px_180px_40px] max-[980px]:grid-cols-[minmax(220px,1fr)_160px_40px] max-[720px]:grid-cols-[minmax(160px,1fr)_40px] max-[720px]:gap-3";

/** The compact layout drops the access column and shows denser rows. */
const compactNodeGrid =
  "grid items-center gap-5 grid-cols-[minmax(280px,1fr)_180px_40px] max-[720px]:grid-cols-[minmax(160px,1fr)_40px] max-[720px]:gap-3";

/** Growing layouts embed the browser in a naturally growing card instead of a fixed-height pane. */
export function NodeBrowser(props: {
  readonly page: NodePage;
  readonly canCreateAtRoot?: boolean;
  readonly actions?: ReactNode;
  readonly searchQuery?: string;
  /** Renders the search box in the card header when provided. */
  readonly onSearchChange?: (value: string) => void;
  /** Clears a search controlled by the page header without adding a card search box. */
  readonly onClearSearch?: () => void;
  readonly searchPlaceholder?: string;
  readonly showParentRow?: boolean;
  /** Display name of the Space for the parent row; defaults to the API name. */
  readonly spaceName?: string | undefined;
  /** Hides the access column and tightens rows for the compact layout. */
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const [editNode, setEditNode] = useState<Node | null>(null);
  const [typeFilter, setTypeFilter] = useState<NodeFilter>("all");
  const [editName, setEditName] = useState("");
  const [editParentNodeId, setEditParentNodeId] = useState("");
  const { language, t } = useI18n();
  const parentNodeId = props.page.parentNode?.id ?? null;
  const canCreate =
    props.page.parentNode?.capabilities.createChildren ??
    props.canCreateAtRoot ??
    false;
  const normalizedSearch = (props.searchQuery ?? "")
    .trim()
    .toLocaleLowerCase();
  const nodeGridClass = props.compact ? compactNodeGrid : nodeGrid;
  const rowHeightClass = props.compact ? "min-h-10 max-[720px]:min-h-12" : "min-h-14";
  const searchLabel = props.searchPlaceholder ?? t("searchNodes");
  const parentRow = props.showParentRow ? nodeParentRow(props.page, props.spaceName) : undefined;
  const visibleNodes = props.page.nodes.filter((node) => {
    const matchesType =
      typeFilter === "all" ||
      (typeFilter === "group"
        ? node.resource === null
        : typeFilter === "blob"
          ? node.resource?.kind === "blob"
          : node.resource?.kind === "univer" &&
            node.resource.unitType === typeFilter);
    const matchesSearch =
      !normalizedSearch ||
      node.name.toLocaleLowerCase().includes(normalizedSearch);
    return matchesType && matchesSearch;
  });
  const itemCount =
    typeFilter !== "all" || normalizedSearch
      ? t("filteredItemsCount", { count: visibleNodes.length, total: props.page.nodes.length })
      : t("itemsCount", { count: props.page.nodes.length });
  const filtering = typeFilter !== "all" || Boolean(normalizedSearch);
  const compact = props.compact === true;
  const rowClass = compact
    ? "group relative border-t border-border px-4 text-muted-foreground transition-colors first:border-t-0 focus-within:z-10"
    : "group relative rounded-lg px-3 text-muted-foreground transition-colors max-[720px]:px-2.5 focus-within:z-10";
  const rowHoverClass = compact
    ? "hover:bg-accent data-popup-open:bg-accent"
    : "hover:bg-muted/70 data-popup-open:bg-muted/70";
  const rowLinkClass = cn(
    "absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
    compact ? "focus-visible:ring-inset" : "rounded-lg",
  );
  const canClearFilters =
    typeFilter !== "all" ||
    Boolean(normalizedSearch && (props.onClearSearch || props.onSearchChange));

  const updateNode = useUpdateNode();

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editName.trim()) return;
    if (!editNode) {
      toast.error("No node is selected.");
      return;
    }
    updateNode.mutate({
      nodeId: editNode.id,
      body: {
        ...(editNode.capabilities.rename ? { name: editName.trim() } : {}),
        ...(editNode.capabilities.move ? { parentNodeId: editParentNodeId.trim() || null } : {}),
      },
    }, {
      onSuccess: () => {
        setEditNode(null);
        toast.success(t("itemUpdated"));
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : t("updateFailed")),
    });
  };

  return (
    <>
      <div className={cn(compact ? "grid gap-3" : "flex h-full min-h-0 flex-col", props.className)}>
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2",
            !compact && "min-h-14 border-b border-border px-6 py-2.5 max-[720px]:px-4",
          )}
        >
          {props.onSearchChange ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
              <div className={cn("relative w-full min-w-0", compact ? "max-w-xs" : "max-w-sm")}>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
                  aria-hidden="true"
                />
                <Input
                  aria-label={searchLabel}
                  className={cn("pl-9", compact ? "h-8" : "h-9")}
                  placeholder={searchLabel}
                  value={props.searchQuery ?? ""}
                  onChange={(event) => props.onSearchChange?.(event.target.value)}
                />
              </div>
              <p className={cn("m-0 text-[13px] text-muted-foreground", compact && !filtering && "hidden")}>
                {itemCount}
              </p>
            </div>
          ) : (
            <div className="grid min-w-0 gap-0.5">
              {parentNodeId && !props.showParentRow ? (
                <Breadcrumb
                  items={[
                    ...(props.page.navigationRootNodeId === null ? [{
                      label: props.page.space.name,
                      link: (
                        <Link
                          to="/spaces/$spaceId"
                          params={{ spaceId: props.page.space.id }}
                        >
                          {props.page.space.name}
                        </Link>
                      ),
                    }] : []),
                    ...props.page.breadcrumbs.map((item, index) => ({
                      label: item.name,
                      link:
                        index === props.page.breadcrumbs.length - 1
                          ? undefined
                          : (
                              <Link
                                to="/nodes/$nodeId"
                                params={{ nodeId: item.id }}
                              >
                                {item.name}
                              </Link>
                            ),
                    })),
                  ]}
                />
              ) : null}
              <p className={cn("m-0 text-[13px] text-muted-foreground", compact && !filtering && "hidden")}>
                {itemCount}
              </p>
            </div>
          )}
          {props.actions || canCreate ? (
            <div className="flex flex-wrap items-center gap-2">
              {props.actions}
              {canCreate ? (
                <CreateNodeDropdown
                  spaceId={props.page.space.id}
                  parentNodeId={parentNodeId}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        <div
          className={cn(
            compact ? "overflow-hidden rounded-md border border-border bg-background" : "contents",
          )}
        >
        {props.page.nodes.length === 0 ? (
          <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
            <Empty title={t("groupEmpty")} />
          </div>
        ) : (
          <>
            <div
              className={cn(
                nodeGridClass,
                "shrink-0 border-b border-border text-[13px] font-medium text-muted-foreground",
                compact ? "h-10 bg-surface px-4" : "h-11 px-6 max-[720px]:px-4"
              )}
            >
              <Select<NodeFilter>
                borderless
                aria-label={t("allTypes")}
                className="-ml-2 w-max max-w-full justify-self-start"
                value={typeFilter}
                options={[
                  { label: t("allTypes"), value: "all" },
                  { label: t("group"), value: "group" },
                  { label: t("file"), value: "blob" },
                  { label: t("doc"), value: "doc" },
                  { label: t("sheet"), value: "sheet" },
                  { label: t("slide"), value: "slide" },
                  { label: t("board"), value: "board" },
                  { label: t("base"), value: "base" },
                ]}
                onValueChange={setTypeFilter}
              />
              {props.compact ? null : (
                <span className="max-[980px]:hidden">{t("access")}</span>
              )}
              <span className="max-[720px]:hidden">
                {t("lastModified")}
              </span>
              <span aria-hidden="true" />
            </div>
            <div className={cn(!compact && "min-h-0 flex-1 overflow-y-auto px-3 py-2 max-[720px]:px-1.5")}>
              {parentRow ? (
                <div
                  className={cn(
                    nodeGridClass,
                    rowHeightClass,
                    rowClass,
                    compact ? "hover:bg-accent" : "hover:bg-muted/70"
                  )}
                >
                  <Link
                    {...(parentRow.nodeId === undefined
                      ? {
                          to: "/spaces/$spaceId",
                          params: { spaceId: props.page.space.id },
                          search: {},
                        }
                      : {
                          to: "/nodes/$nodeId",
                          params: { nodeId: parentRow.nodeId },
                        })}
                    aria-label={t("repositoryGoToParent", { name: parentRow.label })}
                    className={rowLinkClass}
                  />
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-5 shrink-0 place-items-center">
                      <FolderUp className="size-4" aria-hidden="true" />
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">
                      ..
                    </span>
                  </div>
                  {props.compact ? null : (
                    <span aria-hidden="true" className="max-[980px]:hidden" />
                  )}
                  <span className="text-sm max-[720px]:hidden">
                    {t("parentDirectory")}
                  </span>
                  <span aria-hidden="true" />
                </div>
              ) : null}
              {visibleNodes.length === 0 ? (
                <Empty className="mt-16" title={t("noMatchingNodes")}>
                  {canClearFilters ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => {
                        setTypeFilter("all");
                        if (props.onClearSearch) props.onClearSearch();
                        else props.onSearchChange?.("");
                      }}
                    >
                      {t("clearFilters")}
                    </Button>
                  ) : null}
                </Empty>
              ) : (
                visibleNodes.map((node) => (
                  <NodeActionsMenu
                    key={node.id}
                    node={node}
                    onEdit={() => {
                      setEditName(node.name);
                      setEditParentNodeId("");
                      setEditNode(node);
                    }}
                  >
                    {(actions) => (
                      <div
                        className={cn(
                          nodeGridClass,
                          rowHeightClass,
                          rowClass,
                          rowHoverClass
                        )}
                      >
                        <Link
                          to="/nodes/$nodeId"
                          params={{ nodeId: node.id }}
                          aria-label={node.name}
                          className={rowLinkClass}
                        />
                        <div className="flex min-w-0 items-center gap-3">
                          <NodeIcon
                            name={node.name}
                            kind={node.resource ? "resource" : "group"}
                            resourceKind={node.resource?.kind}
                            unitType={
                              node.resource?.kind === "univer"
                                ? node.resource.unitType
                                : null
                            }
                            mediaType={
                              node.resource?.kind === "blob"
                                ? node.resource.mediaType
                                : null
                            }
                            variant="list"
                          />
                          <span
                            className={cn(
                              "truncate text-sm text-foreground",
                              compact ? "font-normal group-hover:underline" : "font-medium",
                            )}
                            title={node.name}
                          >
                            {node.name}
                          </span>
                        </div>
                        {props.compact ? null : (
                          <span className="truncate text-sm max-[980px]:hidden">
                            {accessRoleLabel(node.accessRole, t)}
                          </span>
                        )}
                        <time
                          className="truncate text-sm max-[720px]:hidden"
                          dateTime={node.updatedAt}
                          title={new Date(node.updatedAt).toLocaleString(
                            language
                          )}
                        >
                          {formatRelativeDate(node.updatedAt, language)}
                        </time>
                        <div className="relative z-10 flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[720px]:opacity-100">
                          {actions}
                        </div>
                      </div>
                    )}
                  </NodeActionsMenu>
                ))
              )}
            </div>
          </>
        )}
        </div>
      </div>

      <Dialog
        open={Boolean(editNode)}
        onOpenChange={(next) => {
          if (!next) setEditNode(null);
        }}
        title={
          editNode
            ? t("editNodeTitle", { name: editNode.name })
            : t("editNodeFallback")
        }
        footer={
          <>
            <DialogClose
              render={<Button variant="secondary">{t("cancel")}</Button>}
            />
            <Button onClick={submitEdit} disabled={updateNode.isPending}>
              {t("save")}
            </Button>
          </>
        }
      >
        <form onSubmit={submitEdit} className="grid gap-4">
          {editNode?.capabilities.rename ? (
            <Field label={t("name")} htmlFor="edit-node-name" required>
              <Input
                id="edit-node-name"
                maxLength={255}
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </Field>
          ) : null}
          {editNode?.capabilities.move ? (
            <Field
              label={t("destinationParentNodeId")}
              htmlFor="edit-node-parent"
              hint={t("destinationParentNodeHint")}
            >
              <Input
                id="edit-node-parent"
                value={editParentNodeId}
                onChange={(event) =>
                  setEditParentNodeId(event.target.value)
                }
              />
            </Field>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}

function accessRoleLabel(
  role: Node["accessRole"],
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (role === "owner") return t("accessOwner");
  if (role === "admin") return t("accessAdmin");
  if (role === "editor") return t("accessEditor");
  return t("accessViewer");
}
