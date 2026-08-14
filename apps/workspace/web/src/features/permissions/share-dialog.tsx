import { Copy, Globe2, LockKeyhole, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import {
  Avatar,
  Button,
  Dialog,
  SearchSelect,
  Select,
  Separator,
  Tooltip,
  toast,
} from "../../shared/ui";
import {
  nodeLinkSharingQueryOptions,
  nodeGrantsQueryOptions,
  userSearchQueryOptions,
} from "./permissions.queries";
import { RoleBadge } from "./role-badge";

type ShareRole = "editor" | "viewer";
type UserSummary = { readonly id: string; readonly displayName: string; readonly username: string; readonly avatarUrl?: string | null };

export function ShareDialog(props: {
  readonly node: { readonly id: string; readonly name: string } | null;
  readonly onClose: () => void;
}) {
  const nodeId = props.node?.id ?? "";
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [role, setRole] = useState<ShareRole>("viewer");
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const grants = useQuery({
    ...nodeGrantsQueryOptions(nodeId),
    enabled: Boolean(props.node),
  });
  const linkSharing = useQuery({
    ...nodeLinkSharingQueryOptions(nodeId),
    enabled: Boolean(props.node),
  });
  const users = useQuery(userSearchQueryOptions(search));

  const grant = useMutation({
    mutationFn: async (values: {
      readonly userId: string;
      readonly role: ShareRole;
    }) => {
      const { data, error } = await api.PUT(
        "/api/nodes/{nodeId}/grants/{userId}",
        {
          params: {
            path: { nodeId, userId: values.userId },
          },
          body: { role: values.role },
        }
      );
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: nodeGrantsQueryOptions(nodeId).queryKey,
      });
      setSelectedUser(null);
      setSearch("");
      toast.success(t("accessUpdated"));
    },
    onError: showError,
  });
  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE(
        "/api/nodes/{nodeId}/grants/{userId}",
        {
          params: { path: { nodeId, userId } },
        }
      );
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: nodeGrantsQueryOptions(nodeId).queryKey,
      });
      toast.success(t("accessRemoved"));
    },
    onError: showError,
  });
  const updateLinkSharing = useMutation({
    mutationFn: async (settings: {
      readonly enabled: boolean;
      readonly role: ShareRole;
    }) => {
      const { data, error } = await api.PUT(
        "/api/nodes/{nodeId}/link-sharing",
        {
          params: { path: { nodeId } },
          body: settings,
        }
      );
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: nodeLinkSharingQueryOptions(nodeId).queryKey,
      });
      toast.success(t("linkSharingUpdated"));
    },
    onError: showError,
  });

  function showError(error: unknown) {
    toast.error(
      error instanceof Error ? error.message : t("sharingUpdateFailed")
    );
  }

  const submit = () => {
    if (!selectedUser) {
      toast.error(t("selectUser"));
      return;
    }
    grant.mutate({ userId: selectedUser.id, role });
  };

  const grantList = grants.data?.grants ?? [];
  const linkSharingEnabled = linkSharing.data?.enabled ?? false;
  const linkSharingRole = linkSharing.data?.role ?? "viewer";
  const shareUrl = new URL(
    `/nodes/${encodeURIComponent(nodeId)}`,
    window.location.origin
  ).toString();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("copyLinkFailed"));
    }
  };

  return (
    <Dialog
      open={Boolean(props.node)}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={
        props.node
          ? t("shareNodeTitle", { name: props.node.name })
          : t("shareFallback")
      }
      description={t("shareNodeDescription")}
      width="xl"
    >
      <h3 className="m-0 mb-2 text-sm font-semibold">
        {t("inviteCollaborators")}
      </h3>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-56 flex-1">
          <SearchSelect<UserSummary>
            items={users.data?.users ?? []}
            value={selectedUser}
            onValueChange={setSelectedUser}
            onInputValueChange={(value, reason) => {
              if (reason === "item-press") return;
              setSearch(value);
            }}
            itemToStringLabel={(user) =>
              `${user.displayName} (@${user.username})`
            }
            itemKey={(user) => user.id}
            placeholder={t("searchUsers")}
            aria-label={t("searchUsers")}
            emptyContent={
              search.trim().length < 2 ? t("minTwoChars") : undefined
            }
            renderItem={(user) => (
              <span className="flex min-w-0 items-center gap-2">
                <Avatar size="xs" src={user.avatarUrl} name={user.displayName} />
                <span className="truncate">{user.displayName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  @{user.username}
                </span>
              </span>
            )}
          />
        </div>
        <Select<ShareRole>
          className="w-32"
          aria-label={t("access")}
          value={role}
          onValueChange={setRole}
          options={[
            { label: t("accessViewer"), value: "viewer" },
            { label: t("accessEditor"), value: "editor" },
          ]}
        />
        <Button onClick={submit} disabled={grant.isPending}>
          {t("inviteAction")}
        </Button>
      </div>

      <Separator className="my-5" />
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold">
          {t("peopleWithAccess")}
        </h3>
        <span className="text-xs text-subtle-foreground">
          {t("peopleWithAccessCount", { count: grantList.length })}
        </span>
      </div>
      {grantList.length === 0 && !grants.isPending ? (
        <p className="py-4 text-center text-[13px] text-muted-foreground">
          {t("noDirectShares")}
        </p>
      ) : (
        <ul className="grid">
          {grantList.map((item) => (
            <li
              key={item.user.id}
              className="flex items-center gap-3 border-b border-border py-3 last:border-0"
            >
              <Avatar src={item.user.avatarUrl} name={item.user.displayName} />
              <div className="grid min-w-0 flex-1">
                <span className="truncate text-sm font-medium">
                  {item.user.displayName}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  @{item.user.username}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <RoleBadge role={item.role} />
                {item.effectiveRole !== item.role ? (
                  <span className="text-xs text-muted-foreground">
                    {t("effectiveRole", { role: item.effectiveRole })}
                  </span>
                ) : null}
                <Tooltip content={t("remove")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t("remove")} ${item.user.displayName}`}
                    className="hover:bg-destructive-soft hover:text-destructive"
                    disabled={
                      remove.isPending && remove.variables === item.user.id
                    }
                    onClick={() => remove.mutate(item.user.id)}
                  >
                    <Trash2 />
                  </Button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Separator className="my-5" />
      <h3 className="m-0 mb-2 text-sm font-semibold">
        {t("linkSharing")}
      </h3>
      <div className="overflow-hidden rounded-xl border border-primary/15 bg-primary/5">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Globe2 className="size-5" />
          </span>
          <div className="min-w-48 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                {linkSharingEnabled
                  ? t("linkSharingEnabled")
                  : t("linkSharingDisabled")}
              </span>
              <span
                className={
                  linkSharingEnabled
                    ? "size-1.5 rounded-full bg-success"
                    : "size-1.5 rounded-full bg-subtle-foreground"
                }
              />
            </div>
            <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">
              {linkSharingEnabled
                ? t("linkSharingEnabledDescription")
                : t("linkSharingDisabledDescription")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={linkSharingEnabled}
              aria-label={
                linkSharingEnabled
                  ? t("disableLinkSharing")
                  : t("enableLinkSharing")
              }
              disabled={
                linkSharing.isPending || updateLinkSharing.isPending
              }
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-2.5 text-[13px] font-medium text-secondary-foreground shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
              onClick={() =>
                updateLinkSharing.mutate({
                  enabled: !linkSharingEnabled,
                  role: linkSharingRole,
                })
              }
            >
              <span
                aria-hidden="true"
                className={
                  linkSharingEnabled
                    ? "relative h-5 w-8 rounded-full bg-primary transition-colors"
                    : "relative h-5 w-8 rounded-full bg-muted-foreground/45 transition-colors"
                }
              >
                <span
                  className={
                    linkSharingEnabled
                      ? "absolute top-0.5 left-0.5 size-4 translate-x-3 rounded-full bg-background shadow-sm transition-transform"
                      : "absolute top-0.5 left-0.5 size-4 translate-x-0 rounded-full bg-background shadow-sm transition-transform"
                  }
                />
              </span>
              {linkSharingEnabled
                ? t("linkSharingOn")
                : t("linkSharingOff")}
            </button>
            <Select<ShareRole>
              className="w-28"
              aria-label={t("linkSharingAccess")}
              value={linkSharingRole}
              disabled={
                !linkSharingEnabled ||
                linkSharing.isPending ||
                updateLinkSharing.isPending
              }
              onValueChange={(nextRole) =>
                updateLinkSharing.mutate({
                  enabled: linkSharingEnabled,
                  role: nextRole,
                })
              }
              options={[
                { label: t("accessViewer"), value: "viewer" },
                { label: t("accessEditor"), value: "editor" },
              ]}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-primary/10 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle-foreground">
            {shareUrl}
          </span>
          <Button
            size="sm"
            disabled={!linkSharingEnabled || updateLinkSharing.isPending}
            onClick={() => void copyLink()}
          >
            <Copy />
            {t("copyLink")}
          </Button>
        </div>
      </div>
      <p className="mt-2.5 mb-0 flex items-center gap-1.5 text-[11px] text-subtle-foreground">
        <LockKeyhole className="size-3.5 shrink-0" />
        {t("linkSharingPrivacyNote")}
      </p>
    </Dialog>
  );
}
