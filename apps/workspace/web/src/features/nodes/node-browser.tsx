import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { NodeIcon } from "./node-icon";
import { CreateNodeDropdown } from "./create-node-dropdown";
import { NodeActionsMenu } from "./node-actions-menu";
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

export function NodeBrowser(props: {
  readonly page: NodePage;
  readonly canCreateAtRoot?: boolean;
  readonly actions?: ReactNode;
  readonly searchQuery?: string;
}) {
  const [editNode, setEditNode] = useState<Node | null>(null);
  const [typeFilter, setTypeFilter] = useState<NodeFilter>("all");
  const [editName, setEditName] = useState("");
  const [editParentNodeId, setEditParentNodeId] = useState("");
  const queryClient = useQueryClient();
  const { language, t } = useI18n();
  const parentNodeId = props.page.parentNode?.id ?? null;
  const canCreate =
    props.page.parentNode?.capabilities.createChildren ??
    props.canCreateAtRoot ??
    false;
  const normalizedSearch = (props.searchQuery ?? "")
    .trim()
    .toLocaleLowerCase();
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

  const updateNode = useMutation({
    mutationFn: async (values: {
      readonly name: string;
      readonly parentNodeId?: string;
    }) => {
      if (!editNode) throw new Error("No node is selected.");
      const { error } = await api.PATCH("/api/nodes/{nodeId}", {
        params: { path: { nodeId: editNode.id } },
        body: {
          ...(editNode.capabilities.rename ? { name: values.name } : {}),
          ...(editNode.capabilities.move
            ? { parentNodeId: values.parentNodeId || null }
            : {}),
        },
      });
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["nodes"] }),
        queryClient.invalidateQueries({ queryKey: ["recent-resources"] }),
        queryClient.invalidateQueries({ queryKey: ["owned-by-me"] }),
        queryClient.invalidateQueries({ queryKey: ["shared-with-me"] }),
      ]);
      setEditNode(null);
      toast.success(t("itemUpdated"));
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("updateFailed")
      );
    },
  });

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editName.trim()) return;
    updateNode.mutate({
      name: editName.trim(),
      ...(editParentNodeId.trim()
        ? { parentNodeId: editParentNodeId.trim() }
        : {}),
    });
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-2.5 max-[720px]:px-4">
          <div className="grid min-w-0 gap-0.5">
            {parentNodeId ? (
              <Breadcrumb
                items={[
                  {
                    label: props.page.space.name,
                    link: (
                      <Link
                        to="/spaces/$spaceId"
                        params={{ spaceId: props.page.space.id }}
                      >
                        {props.page.space.name}
                      </Link>
                    ),
                  },
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
            <p className="m-0 text-[13px] text-muted-foreground">
              {t("itemsCount", { count: props.page.nodes.length })}
            </p>
          </div>
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
        {props.page.nodes.length === 0 ? (
          <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
            <Empty title={t("groupEmpty")} />
          </div>
        ) : (
          <>
            <div
              className={cn(
                nodeGrid,
                "h-11 shrink-0 border-b border-border px-6 text-[13px] font-medium text-muted-foreground max-[720px]:px-4"
              )}
            >
              <Select<NodeFilter>
                borderless
                aria-label={t("allTypes")}
                className="-ml-2 w-32"
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
              <span className="max-[980px]:hidden">{t("access")}</span>
              <span className="max-[720px]:hidden">
                {t("lastModified")}
              </span>
              <span aria-hidden="true" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 max-[720px]:px-1.5">
              {visibleNodes.length === 0 ? (
                <Empty className="mt-16" title={t("noMatchingNodes")} />
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
                          nodeGrid,
                          "group relative min-h-14 rounded-lg px-3 text-muted-foreground transition-colors max-[720px]:px-2.5",
                          "hover:bg-muted/70 data-popup-open:bg-muted/70 focus-within:z-10"
                        )}
                      >
                        <Link
                          to="/nodes/$nodeId"
                          params={{ nodeId: node.id }}
                          aria-label={node.name}
                          className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        />
                        <div className="flex min-w-0 items-center gap-3">
                          <NodeIcon
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
                            className="truncate text-sm font-medium text-foreground"
                            title={node.name}
                          >
                            {node.name}
                          </span>
                        </div>
                        <span className="truncate text-sm max-[980px]:hidden">
                          {accessRoleLabel(node.accessRole, t)}
                        </span>
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
