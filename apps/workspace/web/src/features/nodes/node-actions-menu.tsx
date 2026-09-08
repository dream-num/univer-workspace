import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, ExternalLink, Link2, Pencil, Share2, Trash2 } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { ShareDialog } from "../permissions";
import { trashQueryKey } from "../trash";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import {
  Button,
  ConfirmDialog,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogClose,
  Field,
  Input,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  toast,
  Tooltip,
} from "../../shared/ui";

type Node = components["schemas"]["NodeSummary"];

export function NodeActionsMenu(props: {
  readonly node: Node;
  readonly onEdit?: () => void;
  readonly onMutated?: () => void;
  readonly children: (actions: ReactNode) => ReactElement;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [editName, setEditName] = useState(props.node.name);
  const [trashOpen, setTrashOpen] = useState(false);
  const nodeUrl = new URL(
    `/nodes/${encodeURIComponent(props.node.id)}`,
    window.location.origin,
  ).toString();

  const updateNode = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await api.PATCH("/api/nodes/{nodeId}", {
        params: { path: { nodeId: props.node.id } },
        body: { name },
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
      setRenameOpen(false);
      toast.success(t("itemUpdated"));
      props.onMutated?.();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("updateFailed"));
    },
  });

  const trashNode = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/api/nodes/{nodeId}/trash", {
        params: { path: { nodeId: props.node.id } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["nodes"] }),
        queryClient.invalidateQueries({ queryKey: ["recent-resources"] }),
        queryClient.invalidateQueries({ queryKey: ["owned-by-me"] }),
        queryClient.invalidateQueries({ queryKey: ["shared-with-me"] }),
        queryClient.invalidateQueries({
          queryKey: trashQueryKey(props.node.spaceId),
        }),
      ]);
      setTrashOpen(false);
      toast.success(t("movedToTrash"));
      props.onMutated?.();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("trashActionFailed"));
    },
  });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(nodeUrl);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("copyLinkFailed"));
    }
  };

  const onAction = (action: NodeAction) => {
    if (action === "open") {
      window.open(nodeUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (action === "share") {
      setShareOpen(true);
      return;
    }
    if (action === "copy") {
      void copyLink();
      return;
    }
    if (action === "rename") {
      if (props.onEdit) {
        props.onEdit();
        return;
      }
      setEditName(props.node.name);
      setRenameOpen(true);
      return;
    }
    setTrashOpen(true);
  };

  const dropdown = (
    <MenuRoot>
      <Tooltip content={t("actions")}>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("actions")}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.currentTarget.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "ArrowDown",
                    bubbles: true,
                    cancelable: true,
                  }),
                );
              }}
            >
              <Ellipsis />
            </Button>
          }
        />
      </Tooltip>
      <MenuContent align="end" sideOffset={4} className="w-56">
        <NodeActionItems node={props.node} customEdit={Boolean(props.onEdit)} onAction={onAction} />
      </MenuContent>
    </MenuRoot>
  );

  const submitEdit = () => {
    const name = editName.trim();
    if (!name) return;
    updateNode.mutate(name);
  };

  return (
    <>
      <ContextMenuRoot>
        <ContextMenuTrigger render={props.children(dropdown)} />
        <ContextMenuContent className="w-56">
          <NodeActionItems
            context
            node={props.node}
            customEdit={Boolean(props.onEdit)}
            onAction={onAction}
          />
        </ContextMenuContent>
      </ContextMenuRoot>

      <ShareDialog
        node={shareOpen ? { id: props.node.id, name: props.node.name } : null}
        onClose={() => setShareOpen(false)}
      />

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          if (!open) setRenameOpen(false);
        }}
        title={t("editNodeTitle", { name: props.node.name })}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t("cancel")}</Button>} />
            <Button onClick={submitEdit} disabled={updateNode.isPending || !editName.trim()}>
              {t("save")}
            </Button>
          </>
        }
      >
        <Field label={t("name")} htmlFor={`rename-node-${props.node.id}`} required>
          <Input
            id={`rename-node-${props.node.id}`}
            maxLength={255}
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitEdit();
            }}
          />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        title={t("moveItemToTrash", { name: props.node.name })}
        confirmText={t("move")}
        cancelText={t("cancel")}
        danger
        disabled={trashNode.isPending}
        onConfirm={() => trashNode.mutate()}
      />
    </>
  );
}

type NodeAction = "open" | "share" | "copy" | "rename" | "trash";

function NodeActionItems(props: {
  readonly node: Node;
  readonly context?: boolean;
  readonly customEdit?: boolean;
  readonly onAction: (action: NodeAction) => void;
}) {
  const { t } = useI18n();
  const Item = props.context ? ContextMenuItem : MenuItem;
  const Separator = props.context ? ContextMenuSeparator : MenuSeparator;
  const canEdit =
    props.node.capabilities.rename || (props.customEdit && props.node.capabilities.move);

  return (
    <>
      <Item onClick={() => props.onAction("open")}>
        <ExternalLink />
        {t("openInNewTab")}
      </Item>
      {props.node.capabilities.share ? (
        <Item onClick={() => props.onAction("share")}>
          <Share2 />
          {t("shareAction")}
        </Item>
      ) : null}
      <Item onClick={() => props.onAction("copy")}>
        <Link2 />
        {t("copyLink")}
      </Item>
      {canEdit ? <Separator /> : null}
      {canEdit ? (
        <Item onClick={() => props.onAction("rename")}>
          <Pencil />
          {props.customEdit ? t("editItem") : t("rename")}
        </Item>
      ) : null}
      {props.node.capabilities.trash ? <Separator /> : null}
      {props.node.capabilities.trash ? (
        <Item
          className="text-destructive data-highlighted:bg-destructive-soft data-highlighted:text-destructive [&_svg]:text-destructive"
          onClick={() => props.onAction("trash")}
        >
          <Trash2 />
          {t("moveToTrash")}
        </Item>
      ) : null}
    </>
  );
}
