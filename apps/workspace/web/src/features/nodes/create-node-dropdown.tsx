import { ChevronDown, Plus, Upload } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useCreateFolder, useCreateUniverResource, useUploadBlob, useImportDocument } from "./nodes.commands";
import { useI18n } from "../../shared/i18n";
import { cn } from "../../shared/utils/cn";
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
  Segmented,
  toast,
} from "../../shared/ui";
import type { NewDocumentMode } from "./create-document-initial-data";
import { NodeIcon } from "./node-icon";

type UnitType = "sheet" | "doc" | "slide" | "board" | "base";

const IMPORTABLE_DOCUMENT_EXTENSION =
  /\.(?:xls|xlsx|csv|tsv|doc|docx|ppt|pptx)$/iu;

export function CreateNodeDropdown(props: {
  readonly spaceId?: string;
  readonly parentNodeId?: string | null;
  readonly placement?: "toolbar" | "tree" | "home";
  readonly action?: "all" | "create" | "upload";
  readonly onCreated?: () => void | Promise<void>;
}) {
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);
  const [selectedUnitType, setSelectedUnitType] = useState<UnitType>("doc");
  const [selectedDocumentMode, setSelectedDocumentMode] =
    useState<NewDocumentMode>("modern");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const nameInputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const parentNodeId = props.parentNodeId ?? null;

  const createGroup = useCreateFolder(t("noWritableSpace"));
  const createGroupCallbacks = {
    onSuccess: async () => {
      await props.onCreated?.();
      setGroupDialogOpen(false);
      setName("");
      toast.success(t("groupCreated"));
    },
    onError: (mutationError: Error) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : t("groupCreationFailed")
      );
    },
  };

  const createResource = useCreateUniverResource(language, { noWritableSpace: t("noWritableSpace"), failed: t("resourceCreationFailed"), continuing: t("resourceCreationContinuing") });
  const createResourceCallbacks = {
    onSuccess: async (nodeId: string) => {
      await props.onCreated?.();
      setResourceDialogOpen(false);
      setSelectedDocumentMode("modern");
      setName("");
      toast.success(t("resourceCreated"));
      await navigate({ to: "/nodes/$nodeId", params: { nodeId } });
    },
    onError: (mutationError: Error) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : t("resourceCreationFailed")
      );
    },
  };

  const uploadBlob = useUploadBlob({ noWritableSpace: t("noWritableSpace"), failed: t("fileUploadFailed"), readResponseError: true });
  const uploadBlobCallbacks = {
    onSuccess: async () => {
      await props.onCreated?.();
      toast.success(t("fileUploaded"));
    },
    onError: (mutationError: Error) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : t("fileUploadFailed")
      );
    },
  };

  const importDocument = useImportDocument({ noWritableSpace: t("noWritableSpace"), failed: t("fileImportFailed"), requireUnitId: true });
  const importDocumentCallbacks = {
    onSuccess: async () => {
      await props.onCreated?.();
      toast.success(t("fileImported"));
    },
    onError: (mutationError: Error) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : t("fileImportFailed")
      );
    },
  };

  const placement = props.placement ?? "toolbar";
  const action = props.action ?? "all";
  const pending =
    createGroup.isPending ||
    createResource.isPending ||
    uploadBlob.isPending ||
    importDocument.isPending;

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (IMPORTABLE_DOCUMENT_EXTENSION.test(file.name)) {
      importDocument.mutate({ spaceId: props.spaceId ?? "", parentNodeId, file }, importDocumentCallbacks);
    } else {
      uploadBlob.mutate({ spaceId: props.spaceId ?? "", parentNodeId, file }, uploadBlobCallbacks);
    }
  };

  const openDialog = (unitType: UnitType | "group") => {
    setError(undefined);
    if (unitType === "group") {
      setName("");
      setGroupDialogOpen(true);
      return;
    }
    setSelectedUnitType(unitType);
    setSelectedDocumentMode("modern");
    setName(t("untitledType", { type: t(unitType) }));
    setResourceDialogOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(
        groupDialogOpen ? t("enterGroupName") : t("enterResourceName")
      );
      return;
    }
    if (groupDialogOpen) createGroup.mutate({ spaceId: props.spaceId ?? "", parentNodeId, name: trimmed }, createGroupCallbacks);
    else {
      createResource.mutate({
        spaceId: props.spaceId ?? "",
        parentNodeId,
        documentMode: selectedDocumentMode,
        name: trimmed,
        unitType: selectedUnitType,
      }, createResourceCallbacks);
    }
  };

  const dialogOpen = groupDialogOpen || resourceDialogOpen;

  const trigger =
    placement === "tree" ? (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("new")}
        onClick={(event) => event.stopPropagation()}
      >
        <Plus />
      </Button>
    ) : placement === "home" ? (
      <button
        type="button"
        disabled={!props.spaceId || pending}
        onClick={
          action === "upload"
            ? () => fileInput.current?.click()
            : undefined
        }
        className="group relative flex h-18 w-full cursor-pointer items-center gap-3.5 overflow-hidden rounded-xl border border-border/85 bg-gradient-to-br from-background via-background to-surface/70 px-4 text-left shadow-xs transition-[transform,border-color,box-shadow] duration-150 outline-none hover:-translate-y-px hover:border-brand-200 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
      >
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg ring-1 [&_svg]:size-4.5",
            action === "upload"
              ? "bg-gradient-to-br from-warning-soft to-background text-warning-soft-foreground ring-warning/15"
              : "bg-gradient-to-br from-brand-50 to-brand-100/75 text-brand-600 ring-brand-100"
          )}
        >
          {action === "upload" ? <Upload /> : <Plus />}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-[13px] font-semibold text-foreground">
            {action === "upload" ? t("uploadFile") : t("new")}
          </strong>
          <span className="truncate text-[12px] text-muted-foreground">
            {action === "upload" ? t("uploadFromHome") : t("createFromHome")}
          </span>
        </span>
        {action === "upload" ? null : (
          <ChevronDown className="size-4 shrink-0 text-subtle-foreground transition-[color,transform] group-hover:translate-y-0.5 group-hover:text-brand-600" />
        )}
      </button>
    ) : (
      <Button variant="secondary">
        <Plus />
        {t("new")}
      </Button>
    );

  return (
    <>
      {action === "upload" ? (
        trigger
      ) : (
        <MenuRoot>
          <MenuTrigger
            disabled={!props.spaceId || pending}
            render={trigger}
          />
          <MenuContent
            align={placement === "toolbar" ? "end" : "start"}
            className="w-52"
          >
            <MenuGroup>
              <MenuGroupLabel>{t("newDocument")}</MenuGroupLabel>
              {(
                ["doc", "sheet", "slide", "board", "base"] as const
              ).map((unitType) => (
                <MenuItem
                  key={unitType}
                  onClick={() => openDialog(unitType)}
                >
                  <NodeIcon kind="resource" unitType={unitType} />
                  {t(unitType)}
                </MenuItem>
              ))}
            </MenuGroup>
            <MenuSeparator />
            {action === "all" ? (
              <MenuItem onClick={() => fileInput.current?.click()}>
                <Upload />
                {t("uploadFile")}
              </MenuItem>
            ) : null}
            <MenuItem onClick={() => openDialog("group")}>
              <NodeIcon kind="group" unitType={null} />
              {t("group")}
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      )}
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        aria-label={t("uploadFile")}
        onChange={selectFile}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (!next) {
            setGroupDialogOpen(false);
            setResourceDialogOpen(false);
          }
        }}
        title={
          groupDialogOpen
            ? t("createGroup")
            : t("createType", { type: t(selectedUnitType) })
        }
        footer={
          <>
            <DialogClose
              render={<Button variant="secondary">{t("cancel")}</Button>}
            />
            <Button onClick={submit} disabled={pending}>
              {t("create")}
            </Button>
          </>
        }
      >
        <form className="grid gap-4" onSubmit={submit}>
          <Field
            label={groupDialogOpen ? t("groupName") : t("resourceName")}
            htmlFor={nameInputId}
            error={error}
          >
            <Input
              id={nameInputId}
              autoFocus
              maxLength={255}
              value={name}
              invalid={Boolean(error)}
              onChange={(event) => {
                setError(undefined);
                setName(event.target.value);
              }}
              onFocus={(event) => {
                if (resourceDialogOpen) event.target.select();
              }}
            />
          </Field>
          {!groupDialogOpen && selectedUnitType === "doc" ? (
            <Field
              label={t("documentMode")}
              hint={
                selectedDocumentMode === "classic"
                  ? t("documentModeClassicDescription")
                  : t("documentModeModernDescription")
              }
            >
              <Segmented<NewDocumentMode>
                aria-label={t("documentMode")}
                value={selectedDocumentMode}
                onValueChange={setSelectedDocumentMode}
                options={[
                  {
                    label: t("documentModeModern"),
                    value: "modern",
                  },
                  {
                    label: t("documentModeClassic"),
                    value: "classic",
                  },
                ]}
              />
            </Field>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
