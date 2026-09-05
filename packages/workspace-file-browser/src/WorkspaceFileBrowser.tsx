import {
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  ListTreeIcon,
  PlusIcon,
  Tooltip,
  toast,
} from "@univerjs/univer-workspace-ui";
import { useId, useMemo, useState, type FormEvent } from "react";
import { browserCopy } from "./copy.js";
import { CreateNodeMenu } from "./CreateNodeMenu.js";
import { NodeActionsMenu } from "./NodeActionsMenu.js";
import { WorkspaceFileTree } from "./WorkspaceFileTree.js";
import type { WorkspaceFileBrowserProps, WorkspaceFileTreeDataSource } from "./types.js";
import css from "./WorkspaceFileBrowser.module.scss";

export function WorkspaceFileBrowser(props: WorkspaceFileBrowserProps) {
  const copy = browserCopy[props.locale];
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const treeDataSource = useMemo<WorkspaceFileTreeDataSource>(
    () => ({
      loadChildren: props.dataSource.loadChildren,
      moveNode: async (input) => {
        try {
          await props.dataSource.moveNode(input);
          toast.success(copy.itemMoved);
        } catch (reason) {
          toast.error(reason instanceof Error ? reason.message : copy.moveFailed);
          throw reason;
        }
      },
    }),
    [copy.itemMoved, copy.moveFailed, props.dataSource],
  );

  return (
    <>
      <WorkspaceFileTree
        spaces={props.spaces}
        dataSource={treeDataSource}
        storageScope={props.storageScope}
        locale={props.locale}
        {...(props.selectedSpaceId === undefined ? {} : { selectedSpaceId: props.selectedSpaceId })}
        {...(props.selectedNodeId === undefined ? {} : { selectedNodeId: props.selectedNodeId })}
        {...(props.selectedNodePath === undefined
          ? {}
          : { selectedNodePath: props.selectedNodePath })}
        onOpenSpace={props.onOpenSpace}
        onOpenNode={props.onOpenNode}
        renderTeamActions={() => (
          <Tooltip content={copy.createTeamSpace}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={copy.createTeamSpace}
              onClick={() => setTeamDialogOpen(true)}
            >
              <PlusIcon />
            </Button>
          </Tooltip>
        )}
        renderSpaceActions={(space, controls) => (
          <>
            {space.capabilities.createAtRoot ? (
              <CreateNodeMenu
                spaceId={space.id}
                parentNodeId={null}
                locale={props.locale}
                dataSource={props.dataSource}
                onCreated={() => {
                  controls.expand();
                  controls.refresh();
                }}
              />
            ) : null}
            {space.type === "personal" ? (
              <Tooltip content={copy.openInNewTab}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={copy.openInNewTab}
                  onClick={() => props.onOpenSpace(space)}
                >
                  <ListTreeIcon />
                </Button>
              </Tooltip>
            ) : null}
          </>
        )}
        decorateNodeRow={(node, controls, renderRow) => (
          <NodeActionsMenu
            node={node}
            locale={props.locale}
            dataSource={props.dataSource}
            onMutated={controls.refresh}
          >
            {(nodeActions) =>
              renderRow(
                <>
                  {node.resource === null && node.capabilities.createChildren ? (
                    <CreateNodeMenu
                      spaceId={node.spaceId}
                      parentNodeId={node.id}
                      locale={props.locale}
                      dataSource={props.dataSource}
                      onCreated={() => {
                        controls.expand();
                        controls.refresh();
                      }}
                    />
                  ) : null}
                  {props.renderNodeActions?.(node, controls)}
                  {nodeActions}
                </>,
              )
            }
          </NodeActionsMenu>
        )}
      />
      <CreateTeamDialog
        open={teamDialogOpen}
        locale={props.locale}
        dataSource={props.dataSource}
        onOpenChange={setTeamDialogOpen}
        onCreated={props.onOpenSpace}
      />
    </>
  );
}

function CreateTeamDialog(props: {
  readonly open: boolean;
  readonly locale: WorkspaceFileBrowserProps["locale"];
  readonly dataSource: WorkspaceFileBrowserProps["dataSource"];
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: WorkspaceFileBrowserProps["onOpenSpace"];
}) {
  const copy = browserCopy[props.locale];
  const [name, setName] = useState("");
  const [publicRead, setPublicRead] = useState(false);
  const nameFieldId = useId();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(copy.enterSpaceName);
      return;
    }
    setPending(true);
    try {
      const space = await props.dataSource.createTeamSpace({ name: trimmed, publicRead });
      props.onOpenChange(false);
      setName("");
      setPublicRead(false);
      props.onCreated(space);
      toast.success(copy.teamCreated);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : copy.teamCreateFailed);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        setError(undefined);
        props.onOpenChange(open);
      }}
      title={copy.createTeamSpace}
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{copy.cancel}</Button>} />
          <Button onClick={() => void submit()} disabled={pending}>
            {pending ? "…" : copy.create}
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => void submit(event)}>
        <Field label={copy.spaceName} htmlFor={nameFieldId} error={error}>
          <Input
            id={nameFieldId}
            autoFocus
            maxLength={100}
            value={name}
            invalid={Boolean(error)}
            onChange={(event) => {
              setError(undefined);
              setName(event.target.value);
            }}
          />
        </Field>
        <label className={css.publicRead}>
          <span>
            <strong>{copy.publicRead}</strong>
            <small>{copy.publicReadDescription}</small>
          </span>
          <input
            type="checkbox"
            checked={publicRead}
            onChange={(event) => setPublicRead(event.target.checked)}
          />
        </label>
      </form>
    </Dialog>
  );
}
