import { Trash2, UserPlus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import {
  Avatar,
  Button,
  SearchSelect,
  Select,
  Tooltip,
  toast,
} from "../../shared/ui";
import {
  teamMembersQueryOptions,
  userSearchQueryOptions,
} from "./permissions.queries";
import { RoleBadge } from "./role-badge";

type TeamRole = "admin" | "editor" | "viewer";
type UserSummary = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly avatarUrl?: string | null;
};

export function TeamMemberManager(props: {
  readonly spaceId: string;
  readonly spaceName: string;
  readonly canManage: boolean;
  readonly actorRole: "owner" | "admin" | "editor" | "viewer";
  readonly searchQuery?: string;
}) {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [role, setRole] = useState<TeamRole>("viewer");
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const members = useQuery(teamMembersQueryOptions(props.spaceId));
  const users = useQuery(userSearchQueryOptions(search));

  const update = useMutation({
    mutationFn: async (values: {
      readonly userId: string;
      readonly role: TeamRole;
    }) => {
      const { error } = await api.PUT(
        "/api/team-spaces/{spaceId}/members/{userId}",
        {
          params: {
            path: {
              spaceId: props.spaceId,
              userId: values.userId,
            },
          },
          body: { role: values.role },
        }
      );
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      await invalidate();
      setSelectedUser(null);
      setSearch("");
      toast.success(t("membershipUpdated"));
    },
    onError: showError,
  });
  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE(
        "/api/team-spaces/{spaceId}/members/{userId}",
        {
          params: {
            path: { spaceId: props.spaceId, userId },
          },
        }
      );
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(t("memberRemoved"));
    },
    onError: showError,
  });
  const changeRole = useMutation({
    mutationFn: async (input: {
      readonly userId: string;
      readonly role: TeamRole;
    }) => {
      const { error } = await api.PUT(
        "/api/team-spaces/{spaceId}/members/{userId}",
        {
          params: {
            path: {
              spaceId: props.spaceId,
              userId: input.userId,
            },
          },
          body: { role: input.role },
        }
      );
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(t("roleUpdated"));
    },
    onError: showError,
  });

  async function invalidate() {
    await queryClient.invalidateQueries({
      queryKey: teamMembersQueryOptions(props.spaceId).queryKey,
    });
  }

  function showError(error: unknown) {
    toast.error(
      error instanceof Error ? error.message : t("membershipUpdateFailed")
    );
  }

  const roleOptions: ReadonlyArray<{
    readonly label: string;
    readonly value: TeamRole;
  }> = (
    [
      { label: t("accessAdmin"), value: "admin" },
      { label: t("accessEditor"), value: "editor" },
      { label: t("accessViewer"), value: "viewer" },
    ] as const
  ).filter(
    (option) => props.actorRole === "owner" || option.value !== "admin"
  );

  const existing = new Set(
    (members.data?.members ?? []).map((member) => member.user.id)
  );
  const allMembers = members.data
    ? [
        {
          user: members.data.owner,
          role: "owner" as const,
        },
        ...members.data.members,
      ]
    : [];
  const normalizedSearch = (props.searchQuery ?? "")
    .trim()
    .toLocaleLowerCase();
  const visibleMembers = allMembers.filter((member) => {
    if (!normalizedSearch) return true;
    return [
      member.user.displayName,
      member.user.username,
      member.role,
    ].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearch)
    );
  });

  const submit = () => {
    if (!selectedUser) {
      toast.error(t("selectUser"));
      return;
    }
    update.mutate({ userId: selectedUser.id, role });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-6 py-4 max-[720px]:px-4">
        <p className="m-0 text-[13px] text-muted-foreground">
          {t("spaceMembersDescription")}
        </p>
        {props.canManage ? (
          <div className="mt-3.5 flex flex-wrap items-start gap-2">
            <div className="min-w-56 flex-1">
              <SearchSelect<UserSummary>
                items={(users.data?.users ?? []).filter(
                  (user) => !existing.has(user.id)
                )}
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
                renderItem={(user) => (
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar
                      size="xs"
                      src={user.avatarUrl}
                      name={user.displayName}
                    />
                    <span className="truncate">{user.displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      @{user.username}
                    </span>
                  </span>
                )}
              />
            </div>
            <Select<TeamRole>
              className="w-32"
              aria-label={t("access")}
              value={role}
              onValueChange={setRole}
              options={roleOptions}
            />
            <Button onClick={submit} disabled={update.isPending}>
              <UserPlus />
              {t("addMember")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2 max-[720px]:px-4">
        <ul className="m-0 grid p-0">
          {visibleMembers.map((item) => {
            const locked =
              item.role === "owner" ||
              !props.canManage ||
              (props.actorRole === "admin" && item.role === "admin");
            return (
              <li
                key={item.user.id}
                className="flex items-center gap-3 border-b border-border py-3 last:border-0"
              >
                <Avatar
                  src={item.user.avatarUrl}
                  name={item.user.displayName}
                />
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">
                    {item.user.displayName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    @{item.user.username}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {locked ? (
                    <RoleBadge role={item.role} />
                  ) : (
                    <>
                      <Select<TeamRole>
                        size="sm"
                        className="w-28"
                        aria-label={t("access")}
                        value={item.role}
                        disabled={
                          changeRole.isPending &&
                          changeRole.variables?.userId === item.user.id
                        }
                        options={roleOptions}
                        onValueChange={(nextRole) =>
                          changeRole.mutate({
                            userId: item.user.id,
                            role: nextRole,
                          })
                        }
                      />
                      <Tooltip content={t("remove")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t("remove")} ${item.user.displayName}`}
                          className="hover:bg-destructive-soft hover:text-destructive"
                          disabled={
                            remove.isPending &&
                            remove.variables === item.user.id
                          }
                          onClick={() => remove.mutate(item.user.id)}
                        >
                          <Trash2 />
                        </Button>
                      </Tooltip>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
