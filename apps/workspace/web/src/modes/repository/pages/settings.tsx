import type { SpaceSettingsPageProps } from "../../page.types";
import { useQuery } from "@tanstack/react-query";

import { Copy, Globe, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { RepositorySettingsLayout } from "../repository-settings-layout";
import { isValidSlug, useUpdateSpace, spaceQueryOptions } from "../../../features/spaces";
import { ApiError } from "../../../shared/api/errors";
import { WorkspaceLayout } from "../../workspace-layout";
import { useI18n } from "../../../shared/i18n";
import { Button, ConfirmDialog, Field, Input, Textarea, toast } from "../../../shared/ui";
import type { components } from "../../../../../generated/http/schema.js";

type SpaceProposals = components["schemas"]["SpaceProposals"];

const PROPOSALS = {
  members: ["settingsProposalsMembers", "settingsProposalsMembersDescription"],
  accountable: ["settingsProposalsAccountable", "settingsProposalsAccountableDescription"],
  anyone: ["settingsProposalsAnyone", "settingsProposalsAnyoneDescription"],
} as const satisfies Record<SpaceProposals, readonly [string, string]>;

const SUGGESTED_ACCEPT_AFTER_HOURS = 72;
const MAX_ACCEPT_AFTER_HOURS = 720;
const validHours = (value: string) =>
  /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_ACCEPT_AFTER_HOURS;

export function RepositorySpaceSettingsPage({ spaceId }: SpaceSettingsPageProps) {
  const { t } = useI18n();
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      {...{
        repositoryTab: "settings" as const,
        repositoryBreadcrumbs: [{ label: t("spaceSettings"), settingsSpaceId: spaceId }],
      }}
      headerTitle={t("settingsGeneral")}
    >
      {
        <RepositorySettingsLayout spaceId={spaceId} current="general" title={t("settingsGeneral")}>
          <SpaceGeneralSettings key={spaceId} spaceId={spaceId} />
        </RepositorySettingsLayout>
      }
    </WorkspaceLayout>
  );
}

function SpaceGeneralSettings({ spaceId }: { readonly spaceId: string }) {
  const spaces = useQuery(spaceQueryOptions(spaceId));
  const { t } = useI18n();
  const space = spaces.data;
  const [name, setName] = useState(space?.name ?? "");
  const [description, setDescription] = useState(space?.description ?? "");
  const [error, setError] = useState<string>();
  const [slug, setSlug] = useState(space?.slug ?? "");
  const [slugError, setSlugError] = useState<string>();
  const [hours, setHours] = useState(String(space?.acceptAfterHours ?? SUGGESTED_ACCEPT_AFTER_HOURS));
  const rename = useUpdateSpace(spaceId);
  function update(values: Parameters<typeof rename.mutate>[0]) {
    rename.mutate(values, {
      onSuccess: () => {
        toast.success(t("spaceRenamed"));
        if (values.name !== undefined) setName(values.name);
        if (values.description !== undefined) setDescription(values.description);
        if (values.slug !== undefined) setSlug(values.slug);
        if (values.acceptAfterHours) setHours(String(values.acceptAfterHours));
      },
      onError: (mutationError) => {
        if (mutationError instanceof ApiError && mutationError.field === "slug") {
          setSlugError(
            mutationError.code === "SPACE_SLUG_TAKEN" ? t("spaceSlugTaken") : mutationError.message,
          );
        } else toast.error(mutationError.message);
      },
    });
  }
  if (!space) return null;
  const canEdit = space.capabilities.renameSpace;
  const backlogHours = space.acceptAfterHours === null
    ? SUGGESTED_ACCEPT_AFTER_HOURS
    : validHours(hours) && Number(hours) < space.acceptAfterHours ? Number(hours) : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("enterSpaceName"));
      return;
    }
    update({ name: name.trim() });
  };
  const copySpaceId = async () => {
    try {
      await navigator.clipboard.writeText(spaceId);
      toast.success(t("spaceIdCopied"));
    } catch {
      toast.error(t("copySpaceIdFailed"));
    }
  };
  const copyFullName = async () => {
    try {
      await navigator.clipboard.writeText(space.fullName ?? "");
      toast.success(t("fullNameCopied"));
    } catch {
      toast.error(t("copyFullNameFailed"));
    }
  };
  const submitSlug = (event: FormEvent) => {
    event.preventDefault();
    const next = slug.trim();
    if (!isValidSlug(next)) {
      setSlugError(t("spaceSlugInvalid"));
      return;
    }
    update({ slug: next });
  };
  const VisibilityIcon = space.publicRead ? Globe : LockKeyhole;
  return (
    <div className="grid grid-cols-1 gap-8 pb-8" aria-busy={rename.isPending}>
      {!canEdit ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("settingsReadOnly")}
        </p>
      ) : null}
      <form onSubmit={submit} aria-label={t("spaceName")}>
        <Field label={t("spaceName")} htmlFor="space-name" error={error}>
          <div className="flex flex-wrap items-start gap-1.5">
            <Input
              id="space-name"
              className="h-8 max-w-[250px] rounded-[6px] px-3"
              maxLength={100}
              value={name}
              disabled={!canEdit || rename.isPending}
              invalid={Boolean(error)}
              onChange={(event) => {
                setError(undefined);
                setName(event.target.value);
              }}
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="rounded-[6px] bg-secondary text-sm"
              disabled={!canEdit || rename.isPending || name.trim() === space.name}
            >
              {t("rename")}
            </Button>
          </div>
        </Field>
        {space.type === "team" ? (
          <div className="mt-2 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="shrink-0">{t("teamSpaceId")}:</span>
            <code className="truncate" title={spaceId}>
              {spaceId}
            </code>
            <Button
              type="button"
              aria-label={t("copySpaceId")}
              title={t("copySpaceId")}
              size="icon-sm"
              variant="ghost"
              onClick={() => void copySpaceId()}
            >
              <Copy />
            </Button>
          </div>
        ) : null}
      </form>
      {space.type === "team" ? (
        <form onSubmit={submitSlug} aria-label={t("spaceSlug")}>
          <Field
            label={t("spaceSlug")}
            htmlFor="space-slug"
            error={slugError}
            hint={t("spaceSlugHint")}
          >
            <div className="flex flex-wrap items-start gap-1.5">
              <Input
                id="space-slug"
                className="h-8 max-w-[250px] rounded-[6px] px-3"
                maxLength={100}
                value={slug}
                placeholder={t("spaceSlugNotSet")}
                autoCapitalize="none"
                spellCheck={false}
                disabled={!canEdit || rename.isPending}
                invalid={Boolean(slugError)}
                onChange={(event) => {
                  setSlugError(undefined);
                  setSlug(event.target.value);
                }}
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                className="rounded-[6px] bg-secondary text-sm"
                disabled={!canEdit || rename.isPending || slug.trim() === (space.slug ?? "")}
              >
                {t("save")}
              </Button>
            </div>
          </Field>
          <div className="mt-2 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="shrink-0">{t("spaceFullName")}:</span>
            {space.fullName ? (
              <>
                <code className="truncate" title={space.fullName}>
                  {space.fullName}
                </code>
                <Button
                  type="button"
                  aria-label={t("copyFullName")}
                  title={t("copyFullName")}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void copyFullName()}
                >
                  <Copy />
                </Button>
              </>
            ) : (
              <span>{t("spaceSlugNotSet")}</span>
            )}
          </div>
        </form>
      ) : null}
      <form
        className="grid gap-3"
        aria-label={t("spaceDescription")}
        onSubmit={(event) => {
          event.preventDefault();
          update({ description: description.trim() });
        }}
      >
        <Field label={t("spaceDescription")} htmlFor="space-description">
          <Textarea
            id="space-description"
            className="max-w-xl rounded-[6px]"
            maxLength={350}
            rows={3}
            value={description}
            aria-describedby="space-description-hint"
            disabled={!canEdit || rename.isPending}
            onChange={(event) => setDescription(event.target.value)}
          />
          <p id="space-description-hint" className="text-xs text-muted-foreground">
            {t("spaceDescriptionHint")}
          </p>
        </Field>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          className="justify-self-start rounded-[6px] bg-secondary text-sm"
          disabled={!canEdit || rename.isPending || description.trim() === space.description}
        >
          {t("save")}
        </Button>
      </form>
      {space.type === "team" ? (
        <fieldset
          className="grid gap-2"
          aria-describedby="space-proposals-hint"
          disabled={!canEdit || !space.publicRead || rename.isPending}
        >
          <legend className="mb-1.5 text-[13px] font-medium text-foreground">{t("settingsProposals")}</legend>
          {Object.entries(PROPOSALS).map(([value, [label, description]]) => (
            <label key={value} className="flex max-w-xl items-start gap-2 text-sm has-disabled:opacity-60">
              <input
                type="radio"
                name="space-proposals"
                value={value}
                checked={space.proposals === value}
                onChange={() => update({ proposals: value as SpaceProposals })}
                aria-describedby={`space-proposals-${value}`}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span className="grid gap-0.5">
                <span>{t(label)}</span>
                <span id={`space-proposals-${value}`} className="text-xs text-muted-foreground">
                  {t(description)}
                </span>
              </span>
            </label>
          ))}
          <p id="space-proposals-hint" className="text-[13px] text-muted-foreground">
            {t(space.publicRead ? "settingsProposalsHint" : "settingsProposalsNeedsPublic")}
          </p>
        </fieldset>
      ) : null}
      {space.type === "team" ? (
        <form
          className="grid gap-2"
          aria-label={t("settingsAcceptDeadline")}
          onSubmit={(event) => {
            event.preventDefault();
            update({ acceptAfterHours: Number(hours) });
          }}
        >
          <fieldset className="grid gap-2" aria-describedby="space-accept-deadline-backlog space-accept-deadline-hint" disabled={!canEdit || rename.isPending}>
            <legend className="mb-1.5 text-[13px] font-medium text-foreground">{t("settingsAcceptDeadline")}</legend>
            <label className="flex max-w-xl items-start gap-2 text-sm has-disabled:opacity-60">
              <input
                type="checkbox"
                checked={space.acceptAfterHours !== null}
                onChange={(event) =>
                  update({ acceptAfterHours: event.target.checked ? SUGGESTED_ACCEPT_AFTER_HOURS : null })
                }
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span>{t("settingsAcceptDeadlineOn")}</span>
            </label>
            {space.acceptAfterHours !== null ? (
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <Input
                  id="space-accept-after-hours"
                  aria-label={t("settingsAcceptDeadlineHours")}
                  className="h-8 w-24 rounded-[6px] px-3"
                  type="number"
                  min={1}
                  max={MAX_ACCEPT_AFTER_HOURS}
                  step={1}
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                />
                <span>{t("settingsAcceptDeadlineHours")}</span>
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  className="rounded-[6px] bg-secondary text-sm"
                  disabled={!validHours(hours) || Number(hours) === space.acceptAfterHours}
                >
                  {t("save")}
                </Button>
              </div>
            ) : null}
            {canEdit && backlogHours !== null ? (
              <p id="space-accept-deadline-backlog" className="text-[13px] font-medium text-foreground">
                {t(space.acceptAfterHours === null ? "settingsAcceptDeadlineBacklogOn" : "settingsAcceptDeadlineBacklogLower", {
                  hours: backlogHours,
                })}
              </p>
            ) : null}
            <p id="space-accept-deadline-hint" className="text-[13px] text-muted-foreground">
              {t("settingsAcceptDeadlineHint")}
            </p>
          </fieldset>
        </form>
      ) : null}
      <section className="rd-danger-zone" aria-labelledby="settings-danger-heading">
        <h3 id="settings-danger-heading" className="mb-2 text-2xl leading-9 font-normal">
          {t("settingsDangerZone")}
        </h3>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[6px] border border-destructive/25 p-4">
          <div className="min-w-0 flex-1 basis-64">
            <h4 className="text-sm font-semibold">{t("settingsVisibility")}</h4>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <VisibilityIcon aria-hidden="true" className="size-4 shrink-0" />
              {t(space.publicRead ? "settingsVisibilityPublic" : "settingsVisibilityPrivate")}
            </p>
          </div>
          <ConfirmDialog
            title={t("settingsVisibility")}
            description={t(space.publicRead ? "settingsPrivateWarning" : "publicReadDescription")}
            confirmText={t(space.publicRead ? "settingsMakePrivate" : "settingsMakePublic")}
            cancelText={t("cancel")}
            danger
            disabled={!canEdit || rename.isPending}
            onConfirm={() => update({ publicRead: !space.publicRead })}
            trigger={
              <Button
                size="sm"
                variant="secondary"
                className="rounded-[6px] bg-secondary text-sm text-destructive hover:bg-destructive-soft hover:text-destructive"
              >
                {t("settingsChangeVisibility")}
              </Button>
            }
          />
        </div>
      </section>
    </div>
  );
}
