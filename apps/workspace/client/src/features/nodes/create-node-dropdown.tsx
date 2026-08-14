import { ChevronDown, Plus, Upload } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { createIdempotencyKey } from "../../shared/idempotency-key";
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
import {
  createDocumentInitialData,
  type NewDocumentMode,
} from "./create-document-initial-data";
import { NodeIcon } from "./node-icon";

type UnitType = "sheet" | "doc" | "slide" | "board" | "base";

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
  const queryClient = useQueryClient();
  const { language, t } = useI18n();
  const nameInputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const parentNodeId = props.parentNodeId ?? null;

  async function refreshCreatedNodes() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["nodes"] }),
      queryClient.invalidateQueries({ queryKey: ["recent-resources"] }),
      queryClient.invalidateQueries({ queryKey: ["owned-by-me"] }),
    ]);
  }

  const createGroup = useMutation({
    mutationFn: async (values: { readonly name: string }) => {
      if (!props.spaceId) throw new Error(t("noWritableSpace"));
      const { data, error: apiErr } = await api.POST("/api/nodes", {
        body: {
          spaceId: props.spaceId,
          parentNodeId,
          name: values.name,
        },
      });
      if (apiErr) throw apiError(apiErr);
      return data;
    },
    onSuccess: async () => {
      await refreshCreatedNodes();
      await props.onCreated?.();
      setGroupDialogOpen(false);
      setName("");
      toast.success(t("groupCreated"));
    },
    onError: (mutationError) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : t("groupCreationFailed")
      );
    },
  });

  const createResource = useMutation({
    mutationFn: async (values: {
      readonly documentMode: NewDocumentMode;
      readonly name: string;
      readonly unitType: UnitType;
    }) => {
      if (!props.spaceId) throw new Error(t("noWritableSpace"));
      const initialData =
        values.unitType === "doc"
          ? await createDocumentInitialData({
              language,
              mode: values.documentMode,
              title: values.name,
            })
          : undefined;
      const { data, error: apiErr } = await api.POST("/api/resources", {
        params: {
          header: {
            "Idempotency-Key": createIdempotencyKey(),
          },
        },
        body: {
          kind: "univer",
          spaceId: props.spaceId,
          parentNodeId,
          name: values.name,
          unitType: values.unitType,
          ...(initialData === undefined
            ? {}
            : { initialData: { ...initialData } }),
        },
      });
      if (apiErr) throw apiError(apiErr);
      return data;
    },
    onSuccess: async () => {
      await refreshCreatedNodes();
      await props.onCreated?.();
      setResourceDialogOpen(false);
      setSelectedDocumentMode("modern");
      setName("");
      toast.success(t("resourceCreated"));
    },
    onError: (mutationError) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : t("resourceCreationFailed")
      );
    },
  });

  const uploadBlob = useMutation({
    mutationFn: async (file: File) => {
      if (!props.spaceId) throw new Error(t("noWritableSpace"));
      const { data: reserved, error: reserveError } = await api.POST(
        "/api/blob-upload-sessions",
        {
          params: {
            header: { "Idempotency-Key": createIdempotencyKey() },
          },
          body: {
            spaceId: props.spaceId,
            parentNodeId,
            name: file.name,
            originalFilename: file.name,
            byteSize: file.size,
            ...(file.type ? { declaredMediaType: file.type } : {}),
          },
        }
      );
      if (reserveError) throw apiError(reserveError);
      if (!reserved.uploadTarget) {
        throw new Error(t("fileUploadFailed"));
      }
      try {
        const uploadResponse = await fetch(reserved.uploadTarget.contentUrl, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        });
        if (!uploadResponse.ok) {
          const value = await uploadResponse.json().catch(() => null);
          throw value ? apiError(value) : new Error(t("fileUploadFailed"));
        }
        const { data, error: completeError } = await api.POST(
          "/api/blob-upload-sessions/{uploadId}/complete",
          { params: { path: { uploadId: reserved.upload.id } } }
        );
        if (completeError) throw apiError(completeError);
        return data;
      } catch (error) {
        try {
          await api.DELETE("/api/blob-upload-sessions/{uploadId}", {
            params: { path: { uploadId: reserved.upload.id } },
          });
        } catch {
          // The expiry worker is the fallback when best-effort abort cannot run.
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await refreshCreatedNodes();
      await props.onCreated?.();
      toast.success(t("fileUploaded"));
    },
    onError: (mutationError) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : t("fileUploadFailed")
      );
    },
  });

  const placement = props.placement ?? "toolbar";
  const action = props.action ?? "all";
  const pending =
    createGroup.isPending || createResource.isPending || uploadBlob.isPending;

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadBlob.mutate(file);
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
    if (groupDialogOpen) createGroup.mutate({ name: trimmed });
    else {
      createResource.mutate({
        documentMode: selectedDocumentMode,
        name: trimmed,
        unitType: selectedUnitType,
      });
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
        disabled={!props.spaceId || uploadBlob.isPending}
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
            disabled={!props.spaceId || uploadBlob.isPending}
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
