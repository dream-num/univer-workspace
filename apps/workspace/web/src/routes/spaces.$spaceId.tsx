import { Copy, Settings, Users } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  NodeBrowser,
  spaceNodesQueryOptions,
} from "../features/nodes";
import { requireAuthenticatedSession } from "../features/auth";
import { spacesQueryOptions } from "../features/spaces";
import {
  WorkspaceHeaderSearch,
  WorkspaceLayout,
} from "./-workspace-layout";
import { api } from "../shared/api/client";
import { apiError } from "../shared/api/errors";
import { useI18n } from "../shared/i18n";
import {
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  toast,
} from "../shared/ui";

export const Route = createFileRoute("/spaces/$spaceId")({
  loader: async ({ context, params, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await Promise.all([
      context.queryClient.ensureQueryData(spacesQueryOptions),
      context.queryClient.ensureQueryData(
        spaceNodesQueryOptions(params.spaceId)
      ),
    ]);
  },
  component: SpaceNodePage,
});

function SpaceNodePage() {
  const { spaceId } = Route.useParams();
  const query = useQuery(spaceNodesQueryOptions(spaceId));
  const spaces = useQuery(spacesQueryOptions);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [spaceSettingsOpen, setSpaceSettingsOpen] = useState(false);
  const [name, setName] = useState("");
  const [publicRead, setPublicRead] = useState(false);
  const [error, setError] = useState<string>();
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
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
        queryClient.invalidateQueries({
          queryKey: spacesQueryOptions.queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: spaceNodesQueryOptions(spaceId).queryKey,
        }),
      ]);
      setSpaceSettingsOpen(false);
      toast.success(t("spaceRenamed"));
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  if (!query.data) return null;

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

  const pageActions =
    space?.type === "team" || space?.capabilities.renameSpace ? (
      <>
        {space?.type === "team" ? (
          <Button
            variant="secondary"
            onClick={() =>
              navigate({
                to: "/spaces/$spaceId/members",
                params: { spaceId },
              })
            }
          >
            <Users />
            {t("members")}
          </Button>
        ) : null}
        {space?.capabilities.renameSpace ? (
          <Button
            variant="secondary"
            onClick={() => {
              setName(space.name);
              setPublicRead(space.publicRead);
              setError(undefined);
              setSpaceSettingsOpen(true);
            }}
          >
            <Settings />
            {t("spaceSettings")}
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchNodes")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
      <NodeBrowser
        page={query.data}
        canCreateAtRoot={space?.capabilities.createAtRoot ?? false}
        actions={pageActions}
        searchQuery={searchQuery}
      />
      <Dialog
        open={spaceSettingsOpen}
        onOpenChange={setSpaceSettingsOpen}
        title={t("spaceSettings")}
        footer={
          <>
            <DialogClose
              render={<Button variant="secondary">{t("cancel")}</Button>}
            />
            <Button onClick={submit} disabled={rename.isPending}>
              {t("save")}
            </Button>
          </>
        }
      >
        <form className="grid gap-5" onSubmit={submit}>
          <Field
            label={t("spaceName")}
            htmlFor="space-name"
            error={error}
          >
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
            {space?.type === "team" ? (
              <div className="flex min-w-0 items-center gap-1 text-xs text-subtle-foreground">
                <span className="shrink-0">{t("teamSpaceId")}:</span>
                <code className="truncate text-foreground" title={spaceId}>
                  {spaceId}
                </code>
                <Button
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
              <span className="text-sm font-medium text-foreground">
                {t("publicRead")}
              </span>
              <span className="text-sm text-subtle-foreground">
                {t("publicReadDescription")}
              </span>
            </span>
            <input
              className="mt-0.5 size-4 accent-primary"
              type="checkbox"
              checked={publicRead}
              onChange={(event) => setPublicRead(event.target.checked)}
            />
          </label>
        </form>
      </Dialog>
    </WorkspaceLayout>
  );
}
