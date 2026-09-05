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
  EllipsisIcon,
  ExternalLinkIcon,
  Field,
  Input,
  LinkIcon,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  PencilIcon,
  ShareIcon,
  Tooltip,
  TrashIcon,
  toast,
} from "@univerjs/univer-workspace-ui";
import { useState, type ReactElement, type ReactNode } from "react";
import { browserCopy } from "./copy.js";
import { ShareDialog } from "./ShareDialog.js";
import type {
  WorkspaceFileBrowserDataSource,
  WorkspaceFileLocale,
  WorkspaceFileNode,
} from "./types.js";
import css from "./NodeActionsMenu.module.scss";

type NodeAction = "open" | "share" | "copy" | "rename" | "trash";

export function NodeActionsMenu(props: {
  readonly node: WorkspaceFileNode;
  readonly locale: WorkspaceFileLocale;
  readonly dataSource: WorkspaceFileBrowserDataSource;
  readonly onMutated: () => void;
  readonly children: (actions: ReactNode) => ReactElement;
}) {
  const copy = browserCopy[props.locale];
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [editName, setEditName] = useState(props.node.name);
  const [pending, setPending] = useState(false);
  const nodeUrl = props.dataSource.nodeUrl(props.node);

  const runMutation = async (
    operation: () => Promise<void>,
    success: string,
    fallback: string,
    close: () => void,
  ) => {
    setPending(true);
    try {
      await operation();
      close();
      props.onMutated();
      toast.success(success);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : fallback);
    } finally {
      setPending(false);
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
      void navigator.clipboard.writeText(nodeUrl).then(
        () => toast.success(copy.linkCopied),
        () => toast.error(copy.copyLinkFailed),
      );
      return;
    }
    if (action === "rename") {
      setEditName(props.node.name);
      setRenameOpen(true);
      return;
    }
    setTrashOpen(true);
  };

  const submitRename = () => {
    const name = editName.trim();
    if (!name) return;
    void runMutation(
      () => props.dataSource.renameNode({ node: props.node, name }),
      copy.itemUpdated,
      copy.updateFailed,
      () => setRenameOpen(false),
    );
  };

  const dropdown = (
    <MenuRoot>
      <Tooltip content={copy.actions}>
        <MenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={copy.actions}>
              <EllipsisIcon />
            </Button>
          }
        />
      </Tooltip>
      <MenuContent align="end" sideOffset={4} className={css.menu}>
        <NodeActionItems locale={props.locale} node={props.node} onAction={onAction} />
      </MenuContent>
    </MenuRoot>
  );

  const quickTrash = props.node.capabilities.trash ? (
    <Tooltip content={copy.moveToTrash}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copy.moveToTrash}
        onClick={(event) => {
          event.stopPropagation();
          setTrashOpen(true);
        }}
      >
        <TrashIcon />
      </Button>
    </Tooltip>
  ) : null;

  return (
    <>
      <ContextMenuRoot>
        <ContextMenuTrigger
          render={props.children(
            <>
              {quickTrash}
              {dropdown}
            </>,
          )}
        />
        <ContextMenuContent className={css.menu}>
          <NodeActionItems context locale={props.locale} node={props.node} onAction={onAction} />
        </ContextMenuContent>
      </ContextMenuRoot>

      <ShareDialog
        node={shareOpen ? props.node : null}
        locale={props.locale}
        nodeUrl={nodeUrl}
        dataSource={props.dataSource.sharing}
        onClose={() => setShareOpen(false)}
      />

      <Dialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={copy.editTitle(props.node.name)}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{copy.cancel}</Button>} />
            <Button onClick={submitRename} disabled={pending || !editName.trim()}>
              {copy.save}
            </Button>
          </>
        }
      >
        <Field label={copy.name} htmlFor={`rename-node-${props.node.id}`} required>
          <Input
            id={`rename-node-${props.node.id}`}
            autoFocus
            maxLength={255}
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submitRename()}
          />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        title={copy.trashTitle(props.node.name)}
        confirmText={copy.move}
        cancelText={copy.cancel}
        danger
        disabled={pending}
        onConfirm={() =>
          void runMutation(
            () => props.dataSource.trashNode({ node: props.node }),
            copy.movedToTrash,
            copy.trashFailed,
            () => setTrashOpen(false),
          )
        }
      />
    </>
  );
}

function NodeActionItems(props: {
  readonly node: WorkspaceFileNode;
  readonly locale: WorkspaceFileLocale;
  readonly context?: boolean;
  readonly onAction: (action: NodeAction) => void;
}) {
  const copy = browserCopy[props.locale];
  const Item = props.context ? ContextMenuItem : MenuItem;
  const Separator = props.context ? ContextMenuSeparator : MenuSeparator;
  return (
    <>
      <Item onClick={() => props.onAction("open")}>
        <ExternalLinkIcon />
        {copy.openInNewTab}
      </Item>
      {props.node.capabilities.share ? (
        <Item onClick={() => props.onAction("share")}>
          <ShareIcon />
          {copy.share}
        </Item>
      ) : null}
      <Item onClick={() => props.onAction("copy")}>
        <LinkIcon />
        {copy.copyLink}
      </Item>
      {props.node.capabilities.rename ? <Separator /> : null}
      {props.node.capabilities.rename ? (
        <Item onClick={() => props.onAction("rename")}>
          <PencilIcon />
          {copy.rename}
        </Item>
      ) : null}
      {props.node.capabilities.trash ? <Separator /> : null}
      {props.node.capabilities.trash ? (
        <Item className={css.destructive} onClick={() => props.onAction("trash")}>
          <TrashIcon />
          {copy.moveToTrash}
        </Item>
      ) : null}
    </>
  );
}
