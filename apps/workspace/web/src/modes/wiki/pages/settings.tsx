import type { SpaceSettingsPageProps } from "../../page.types";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useUpdateSpace, spacesQueryOptions } from "../../../features/spaces";
import { WorkspaceLayout } from "../../../routes/-workspace-layout";
import { useI18n } from "../../../shared/i18n";
import { Button, Field, Input, Textarea, toast } from "../../../shared/ui";

export function WikiSpaceSettingsPage({ spaceId }: SpaceSettingsPageProps) {
  const { t } = useI18n();
  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}

      headerTitle={t("settingsGeneral")}
    >
      {
        <div className="min-h-0 flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-6xl px-6 py-6 max-[720px]:px-4 max-[720px]:py-4">
            <SpaceGeneralSettings key={spaceId} spaceId={spaceId} />
          </div>
        </div>
      }
    </WorkspaceLayout>
  );
}

function SpaceGeneralSettings({ spaceId }: { readonly spaceId: string }) {
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
        void navigate({ to: "/spaces/$spaceId", params: { spaceId } });
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
    update({ name: name.trim(), publicRead, description: description.trim() });
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
      <Field label={t("spaceDescription")} htmlFor="space-description" hint={t("spaceDescriptionHint")}>
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
