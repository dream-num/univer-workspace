import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Copy, Globe, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { requireAuthenticatedSession } from "../features/auth";
import { RepositorySettingsLayout } from "../features/spaces";
import { useUpdateSpace, spacesQueryOptions } from "../features/spaces";
import {
  ResourceUnavailablePage,
  isResourceUnavailableError,
  spaceNodesQueryOptions,
} from "../features/nodes";
import { WorkspaceLayout } from "./-workspace-layout";
import { useI18n } from "../shared/i18n";
import { useTheme } from "../shared/theme";
import { Button, ConfirmDialog, Field, Input, Textarea, toast } from "../shared/ui";

export const Route = createFileRoute("/spaces_/$spaceId/settings")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    try {
      const [spaces] = await Promise.all([
        context.queryClient.ensureQueryData(spacesQueryOptions),
        context.queryClient.ensureQueryData(spaceNodesQueryOptions(params.spaceId)),
      ]);
      if (spaces.spaces.every((space) => space.id !== params.spaceId)) throw notFound();
    } catch (error) {
      if (isResourceUnavailableError(error)) throw notFound();
      throw error;
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: SpaceSettingsPage,
});

function SpaceSettingsPage() {
  const { spaceId } = Route.useParams();
  const { t } = useI18n();
  const { workspaceTheme } = useTheme();
  const repository = workspaceTheme === "repository";
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      {...(repository
        ? {
            repositoryTab: "settings" as const,
            repositoryBreadcrumbs: [{ label: t("spaceSettings"), settingsSpaceId: spaceId }],
          }
        : {})}
      headerTitle={t("settingsGeneral")}
    >
      {repository ? (
        <RepositorySettingsLayout spaceId={spaceId} current="general" title={t("settingsGeneral")}>
          <SpaceGeneralSettings key={spaceId} spaceId={spaceId} repository />
        </RepositorySettingsLayout>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-6xl px-6 py-6 max-[720px]:px-4 max-[720px]:py-4">
            <SpaceGeneralSettings key={spaceId} spaceId={spaceId} />
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}

function SpaceGeneralSettings({
  spaceId,
  repository = false,
}: {
  readonly spaceId: string;
  readonly repository?: boolean;
}) {
  const navigate = useNavigate();
  const spaces = useQuery(spacesQueryOptions);
  const { t } = useI18n();
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  const [name, setName] = useState(space?.name ?? "");
  const [publicRead, setPublicRead] = useState(space?.publicRead ?? false);
  const [description, setDescription] = useState(space?.description ?? "");
  const [error, setError] = useState<string>();
  const rename = useUpdateSpace(spaceId);
  function update(values: Parameters<typeof rename.mutate>[0]) {
    rename.mutate(values, {
      onSuccess: () => {
        toast.success(t("spaceRenamed"));
        if (repository) {
          if (values.name !== undefined) setName(values.name);
          if (values.description !== undefined) setDescription(values.description);
        } else {
          void navigate({ to: "/spaces/$spaceId", params: { spaceId } });
        }
      },
      onError: (mutationError) => toast.error(mutationError.message),
    });
  }
  if (!space) return null;
  const canEdit = space.capabilities.renameSpace;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("enterSpaceName"));
      return;
    }
    update(
      repository
        ? { name: name.trim() }
        : { name: name.trim(), publicRead, description: description.trim() },
    );
  };
  const copySpaceId = async () => {
    try {
      await navigator.clipboard.writeText(spaceId);
      toast.success(t("spaceIdCopied"));
    } catch {
      toast.error(t("copySpaceIdFailed"));
    }
  };
  if (repository) {
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
        <section aria-labelledby="settings-danger-heading">
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
  return (
    <form className="grid max-w-xl gap-6" onSubmit={submit}>
      <Field label={t("spaceName")} htmlFor="space-name" error={error}>
        <Input
          id="space-name"
          maxLength={100}
          value={name}
          disabled={!canEdit}
          invalid={Boolean(error)}
          onChange={(event) => {
            setError(undefined);
            setName(event.target.value);
          }}
        />
        {space.type === "team" ? (
          <div className="flex min-w-0 items-center gap-1 text-xs text-subtle-foreground">
            <span className="shrink-0">{t("teamSpaceId")}:</span>
            <code className="truncate text-foreground" title={spaceId}>
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
      </Field>
      <Field
        label={t("spaceDescription")}
        htmlFor="space-description"
        hint={t("spaceDescriptionHint")}
      >
        <Textarea
          id="space-description"
          maxLength={350}
          rows={3}
          value={description}
          disabled={!canEdit}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border p-4">
        <span className="grid gap-1">
          <span className="text-sm font-medium text-foreground">{t("publicRead")}</span>
          <span className="text-sm text-subtle-foreground">{t("publicReadDescription")}</span>
        </span>
        <input
          className="mt-0.5 size-4 accent-primary"
          type="checkbox"
          checked={publicRead}
          disabled={!canEdit}
          onChange={(event) => setPublicRead(event.target.checked)}
        />
      </label>
      <div className="flex justify-end">
        <Button type="submit" disabled={!canEdit || rename.isPending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
