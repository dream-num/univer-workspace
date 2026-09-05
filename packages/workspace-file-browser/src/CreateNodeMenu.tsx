import {
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  PlusIcon,
  Segmented,
  toast,
  UploadIcon,
} from "@univerjs/univer-workspace-ui";
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { browserCopy, unitLabel } from "./copy.js";
import { NodeIcon } from "./NodeIcon.js";
import type {
  WorkspaceDocumentMode,
  WorkspaceFileBrowserDataSource,
  WorkspaceFileCreateKind,
  WorkspaceFileLocale,
  WorkspaceUnitType,
} from "./types.js";
import css from "./CreateNodeMenu.module.scss";

const unitTypes: readonly WorkspaceUnitType[] = ["doc", "sheet", "slide", "board", "base"];

export function CreateNodeMenu(props: {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly locale: WorkspaceFileLocale;
  readonly dataSource: WorkspaceFileBrowserDataSource;
  readonly onCreated: () => void;
}) {
  const copy = browserCopy[props.locale];
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<WorkspaceFileCreateKind>("doc");
  const [documentMode, setDocumentMode] = useState<WorkspaceDocumentMode>("modern");
  const [name, setName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const openDialog = (nextKind: WorkspaceFileCreateKind) => {
    setKind(nextKind);
    setDocumentMode("modern");
    setName(nextKind === "folder" ? "" : copy.untitled(unitLabel(props.locale, nextKind)));
    setError(undefined);
    setDialogOpen(true);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(kind === "folder" ? copy.enterGroupName : copy.enterResourceName);
      return;
    }
    setPending(true);
    try {
      await props.dataSource.createNode({
        spaceId: props.spaceId,
        parentNodeId: props.parentNodeId,
        name: trimmed,
        kind,
        documentMode,
      });
      setDialogOpen(false);
      setName("");
      props.onCreated();
      toast.success(kind === "folder" ? copy.groupCreated : copy.resourceCreated);
    } catch (reason) {
      toast.error(errorMessage(reason, copy.createFailed));
    } finally {
      setPending(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPending(true);
    try {
      await props.dataSource.uploadFile({
        spaceId: props.spaceId,
        parentNodeId: props.parentNodeId,
        file,
      });
      props.onCreated();
      toast.success(copy.fileUploaded);
    } catch (reason) {
      toast.error(errorMessage(reason, copy.uploadFailed));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <MenuRoot>
        <MenuTrigger
          disabled={pending}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={copy.new}
              onClick={(event) => event.stopPropagation()}
            >
              <PlusIcon />
            </Button>
          }
        />
        <MenuContent align="end" sideOffset={4} className={css.menu}>
          <MenuGroup>
            <MenuGroupLabel>{copy.newDocument}</MenuGroupLabel>
            {unitTypes.map((unitType) => (
              <MenuItem key={unitType} onClick={() => openDialog(unitType)}>
                <NodeIcon resource={{ id: "new", kind: "univer", unitType }} />
                {unitLabel(props.locale, unitType)}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem onClick={() => fileInput.current?.click()}>
            <UploadIcon />
            {copy.uploadFile}
          </MenuItem>
          <MenuItem onClick={() => openDialog("folder")}>
            <NodeIcon resource={null} />
            {copy.group}
          </MenuItem>
        </MenuContent>
      </MenuRoot>
      <input
        ref={fileInput}
        className={css.hiddenInput}
        type="file"
        aria-label={copy.uploadFile}
        onChange={(event) => void upload(event)}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          kind === "folder" ? copy.createGroup : `${copy.create} ${unitLabel(props.locale, kind)}`
        }
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{copy.cancel}</Button>} />
            <Button onClick={() => void submit()} disabled={pending}>
              {copy.create}
            </Button>
          </>
        }
      >
        <form className={css.form} onSubmit={(event) => void submit(event)}>
          <Field
            label={kind === "folder" ? copy.groupName : copy.resourceName}
            htmlFor={inputId}
            error={error}
          >
            <Input
              id={inputId}
              autoFocus
              maxLength={255}
              value={name}
              invalid={Boolean(error)}
              onChange={(event) => {
                setError(undefined);
                setName(event.target.value);
              }}
              onFocus={(event) => {
                if (kind !== "folder") event.target.select();
              }}
            />
          </Field>
          {kind === "doc" ? (
            <Field
              label={copy.documentMode}
              hint={documentMode === "classic" ? copy.classicDescription : copy.modernDescription}
            >
              <Segmented<WorkspaceDocumentMode>
                aria-label={copy.documentMode}
                value={documentMode}
                onValueChange={setDocumentMode}
                options={[
                  { label: copy.modern, value: "modern" },
                  { label: copy.classic, value: "classic" },
                ]}
              />
            </Field>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
