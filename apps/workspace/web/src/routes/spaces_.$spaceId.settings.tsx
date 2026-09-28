import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { requireAuthenticatedSession, sessionQueryOptions } from "../features/auth";
import { RepositoryTabs, SpaceSettingsNav } from "../features/spaces";
import { spacesQueryKey, spacesQueryOptions } from "../features/spaces";
import {
  ResourceUnavailablePage,
  isResourceUnavailableError,
  spaceNodesQueryOptions,
} from "../features/nodes";
import { WorkspaceLayout } from "./-workspace-layout";
import { api } from "../shared/api/client";
import { apiError } from "../shared/api/errors";
import { useI18n } from "../shared/i18n";
import { Button, Field, Input, toast } from "../shared/ui";

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
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      repositoryTab="settings"
      repositoryBreadcrumbs={[{ label: t("spaceSettings") }]}
      headerTitle={t("settingsGeneral")}
    >
      <RepositoryTabs spaceId={spaceId} active="settings" />
      <div className="min-h-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto flex max-w-6xl gap-8 px-6 py-6 max-[720px]:flex-col max-[720px]:gap-4 max-[720px]:px-4 max-[720px]:py-4">
          <SpaceSettingsNav spaceId={spaceId} current="general" />
          <div className="min-w-0 flex-1">
            <SpaceGeneralSettings spaceId={spaceId} />
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}

function SpaceGeneralSettings({ spaceId }: { readonly spaceId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const spaces = useQuery(spacesQueryOptions);
  const { t } = useI18n();
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  const [name, setName] = useState(space?.name ?? "");
  const [publicRead, setPublicRead] = useState(space?.publicRead ?? false);
  const [error, setError] = useState<string>();
  const rename = useMutation({
    mutationFn: async (values: { readonly name: string; readonly publicRead: boolean }) => {
      const { error: apiErr } = await api.PATCH("/api/spaces/{spaceId}", {
        params: { path: { spaceId } },
        body: values,
      });
      if (apiErr) throw apiError(apiErr);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: spacesQueryKey }),
        queryClient.invalidateQueries({ queryKey: spaceNodesQueryOptions(spaceId).queryKey }),
      ]);
      toast.success(t("spaceRenamed"));
      void navigate({ to: "/spaces/$spaceId", params: { spaceId } });
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  if (!space) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("enterSpaceName"));
      return;
    }
    rename.mutate({ name: name.trim(), publicRead });
  };
  const copySpaceId = async () => {
    try {
      await navigator.clipboard.writeText(spaceId);
      toast.success(t("spaceIdCopied"));
    } catch {
      toast.error(t("copySpaceIdFailed"));
    }
  };
  return (
    <form className="grid max-w-xl gap-6" onSubmit={submit}>
      <Field label={t("spaceName")} htmlFor="space-name" error={error}>
        <Input
          id="space-name"
          maxLength={100}
          value={name}
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
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border p-4">
        <span className="grid gap-1">
          <span className="text-sm font-medium text-foreground">{t("publicRead")}</span>
          <span className="text-sm text-subtle-foreground">{t("publicReadDescription")}</span>
        </span>
        <input
          className="mt-0.5 size-4 accent-primary"
          type="checkbox"
          checked={publicRead}
          onChange={(event) => setPublicRead(event.target.checked)}
        />
      </label>
      <div className="flex justify-end">
        <Button type="submit" disabled={rename.isPending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
