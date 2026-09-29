import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { Button, ConfirmDialog, Dialog, Empty, Field, Input, Spinner, toast } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { IssueLabelChip, IssueLabelSwatch, ISSUE_LABEL_COLORS } from "./issue-label";
import { issueLabelsQueryOptions, issuesQueryKey } from "./issues.queries";

type Label = components["schemas"]["IssueLabelUsage"];

const COLOR_NAMES: Readonly<Record<string, MessageKey>> = {
  gray: "issueColorGray",
  blue: "issueColorBlue",
  green: "issueColorGreen",
  yellow: "issueColorYellow",
  orange: "issueColorOrange",
  red: "issueColorRed",
  purple: "issueColorPurple",
  pink: "issueColorPink",
};

export function IssueLabelsManager({
  spaceId,
  canManage,
}: {
  readonly spaceId: string;
  readonly canManage: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const labels = useQuery(issueLabelsQueryOptions(spaceId));
  const [editing, setEditing] = useState<Label | "new" | null>(null);
  const [deleting, setDeleting] = useState<Label | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: issuesQueryKey });
  };
  const remove = useMutation({
    mutationFn: async (label: Label) => {
      const { error } = await api.DELETE("/api/issue-labels/{labelId}", {
        params: { path: { labelId: label.id } },
      });
      if (error) throw apiError(error);
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="m-0 text-base font-semibold">
          {t("issueLabels")}
          <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
            {labels.data?.length ?? 0}
          </span>
        </h2>
        {canManage ? (
          <Button onClick={() => setEditing("new")}>
            <Plus />
            {t("issueLabelNew")}
          </Button>
        ) : null}
      </div>
      {labels.isPending ? (
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      ) : labels.error ? (
        <Empty title={t("issueLoadFailed")} description={labels.error.message} />
      ) : labels.data.length === 0 ? (
        <Empty title={t("issueLabelsEmpty")} description={canManage ? t("issueLabelsEmptyManage") : undefined} />
      ) : (
        <ul className="m-0 list-none p-0">
          {labels.data.map((label) => (
            <li
              key={label.id}
              className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <IssueLabelChip name={label.name} color={label.color} className="max-w-56" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{label.description}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("issueLabelOpenCount", { count: label.openIssueCount })}
              </span>
              {canManage ? (
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("issueLabelEdit", { name: label.name })}
                    onClick={() => setEditing(label)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="destructive-ghost"
                    size="icon-sm"
                    aria-label={t("issueLabelDelete", { name: label.name })}
                    onClick={() => setDeleting(label)}
                  >
                    <Trash2 />
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <LabelDialog
        spaceId={spaceId}
        label={editing}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("issueLabelDeleteTitle", { name: deleting?.name ?? "" })}
        description={t("issueLabelDeleteDescription", { count: deleting?.openIssueCount ?? 0 })}
        confirmText={t("remove")}
        cancelText={t("cancel")}
        danger
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
      />
    </section>
  );
}

function LabelDialog({
  spaceId,
  label,
  onClose,
  onSaved,
}: {
  readonly spaceId: string;
  readonly label: Label | "new" | null;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  // Remount per target so the form starts from that label's values.
  return label === null ? null : (
    <LabelForm key={label === "new" ? "new" : label.id} spaceId={spaceId} label={label} onClose={onClose} onSaved={onSaved} />
  );
}

function LabelForm({
  spaceId,
  label,
  onClose,
  onSaved,
}: {
  readonly spaceId: string;
  readonly label: Label | "new";
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const existing = label === "new" ? null : label;
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState(existing?.color ?? "blue");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), color: color as components["schemas"]["IssueLabelColor"], description };
      const { error: apiErr } = existing
        ? await api.PATCH("/api/issue-labels/{labelId}", { params: { path: { labelId: existing.id } }, body })
        : await api.POST("/api/spaces/{spaceId}/issue-labels", { params: { path: { spaceId } }, body });
      if (apiErr) throw apiError(apiErr);
    },
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: (mutationError) => setError(mutationError.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={existing ? t("issueLabelEditTitle") : t("issueLabelNew")}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
            {t("save")}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) save.mutate();
        }}
      >
        <div className="rounded-md bg-surface p-3">
          <IssueLabelChip name={name.trim() || t("issueLabelPreviewName")} color={color} />
        </div>
        <Field label={t("issueLabelName")} htmlFor="issue-label-name" error={error}>
          <Input
            id="issue-label-name"
            maxLength={50}
            autoFocus
            invalid={Boolean(error)}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(undefined);
            }}
          />
        </Field>
        <Field label={t("issueLabelDescription")} htmlFor="issue-label-description">
          <Input
            id="issue-label-description"
            maxLength={200}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 text-[13px] font-medium">{t("issueLabelColor")}</legend>
          <div className="flex flex-wrap gap-2">
            {ISSUE_LABEL_COLORS.map((key) => (
              <label
                key={key}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm",
                  color === key ? "border-ring ring-2 ring-ring/25" : "border-border hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name="issue-label-color"
                  className="sr-only"
                  checked={color === key}
                  onChange={() => setColor(key)}
                />
                <IssueLabelSwatch color={key} />
                {t(COLOR_NAMES[key] ?? "issueColorGray")}
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
