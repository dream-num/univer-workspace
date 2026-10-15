import { Trash2, UserPlus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSetMemberRole, useRemoveMember } from "./permissions.commands";
import { useI18n } from "../../shared/i18n";
import { cn } from "../../shared/utils/cn";
import {
  Avatar,
  Button,
  Dialog,
  Empty,
  SearchSelect,
  Select,
  Tooltip,
  toast,
} from "../../shared/ui";
import { teamMembersQueryOptions, userSearchQueryOptions } from "./permissions.queries";
import { RoleBadge } from "./role-badge";

type TeamRole = "admin" | "editor" | "viewer";
type UserSummary = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly avatarUrl?: string | null;
};

export function TeamMemberManager(props: {
  readonly presentation: "standard" | "compact";
  readonly spaceId: string;
  readonly spaceName: string;
  readonly canManage: boolean;
  readonly actorRole: "owner" | "admin" | "editor" | "viewer";
  readonly searchQuery?: string;
}) {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [role, setRole] = useState<TeamRole>("viewer");
  const [adding, setAdding] = useState(false);
  const { t } = useI18n();
  const compact = props.presentation === "compact";
  const members = useQuery(teamMembersQueryOptions(props.spaceId));
  const users = useQuery(userSearchQueryOptions(search));

  const update = useSetMemberRole();
  const updateCallbacks = {
    onSuccess: () => {
      setSelectedUser(null);
      setSearch("");
      setAdding(false);
      toast.success(t("membershipUpdated"));
    },
    onError: showError,
  };
  const remove = useRemoveMember();
  const removeCallbacks = {
    onSuccess: () => {
      toast.success(t("memberRemoved"));
    },
    onError: showError,
  };
  const changeRole = useSetMemberRole();
  const changeRoleCallbacks = {
    onSuccess: () => {
      toast.success(t("roleUpdated"));
    },
    onError: showError,
  };

  function showError(error: unknown) {
    toast.error(error instanceof Error ? error.message : t("membershipUpdateFailed"));
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
  ).filter((option) => props.actorRole === "owner" || option.value !== "admin");

  const existing = new Set((members.data?.members ?? []).map((member) => member.user.id));
  const allMembers = members.data
    ? [
        {
          user: members.data.owner,
          role: "owner" as const,
        },
        ...members.data.members,
      ]
    : [];
  const normalizedSearch = (props.searchQuery ?? "").trim().toLocaleLowerCase();
  const visibleMembers = allMembers.filter((member) => {
    if (!normalizedSearch) return true;
    return [member.user.displayName, member.user.username, member.role].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearch),
    );
  });

  const submit = () => {
    if (!selectedUser) {
      toast.error(t("selectUser"));
      return;
    }
    update.mutate({ spaceId: props.spaceId, userId: selectedUser.id, role }, updateCallbacks);
  };

  const addMemberForm = (
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 basis-56 flex-1">
        <SearchSelect<UserSummary>
          items={(users.data?.users ?? []).filter((user) => !existing.has(user.id))}
          value={selectedUser}
          onValueChange={setSelectedUser}
          onInputValueChange={(value, reason) => {
            if (reason === "item-press") return;
            setSearch(value);
          }}
          itemToStringLabel={(user) => `${user.displayName} (@${user.username})`}
          itemKey={(user) => user.id}
          placeholder={t("searchUsers")}
          aria-label={t("searchUsers")}
          renderItem={(user) => (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar size="xs" src={user.avatarUrl} name={user.displayName} />
              <span className="truncate">{user.displayName}</span>
              <span className="truncate text-xs text-muted-foreground">@{user.username}</span>
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
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        compact ? "rounded-[6px] border border-border" : "h-full",
      )}
    >
      <div
        className={cn(
          "shrink-0 border-b border-border",
          compact
            ? "flex flex-wrap items-center justify-between gap-3 rounded-t-[6px] bg-surface p-4"
            : "px-6 py-4 max-[720px]:px-4",
        )}
      >
        <div>
          {compact ? (
            <h3 className="mb-1 text-sm font-semibold">{t("settingsManageAccess")}</h3>
          ) : null}
          <p className="m-0 text-[13px] text-muted-foreground">{t("spaceMembersDescription")}</p>
        </div>
        {props.canManage ? (
          compact ? (
            <>
              <Button size="sm" className="rounded-[6px]" onClick={() => setAdding(true)}>
                <UserPlus />
                {t("addMember")}
              </Button>
              <Dialog
                open={adding}
                onOpenChange={setAdding}
                title={t("addMember")}
                description={t("spaceMembersDescription")}
              >
                {addMemberForm}
              </Dialog>
            </>
          ) : (
            <div className="mt-3.5">{addMemberForm}</div>
          )
        ) : null}
      </div>

      <div
        className={cn(
          "min-h-0 flex-1",
          compact ? "px-4" : "overflow-y-auto px-6 py-2 max-[720px]:px-4",
        )}
      >
        {compact && visibleMembers.length === 0 ? (
          <Empty className="py-8" title={t("settingsNoCollaborators")} />
        ) : null}
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
                <Avatar src={item.user.avatarUrl} name={item.user.displayName} />
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{item.user.displayName}</span>
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
                          changeRole.isPending && changeRole.variables?.userId === item.user.id
                        }
                        options={roleOptions}
                        onValueChange={(nextRole) =>
                          changeRole.mutate({
                            spaceId: props.spaceId,
                            userId: item.user.id,
                            role: nextRole,
                          }, changeRoleCallbacks)
                        }
                      />
                      <Tooltip content={t("remove")}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t("remove")} ${item.user.displayName}`}
                          className="hover:bg-destructive-soft hover:text-destructive"
                          disabled={remove.isPending && remove.variables?.userId === item.user.id}
                          onClick={() => remove.mutate({ spaceId: props.spaceId, userId: item.user.id }, removeCallbacks)}
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
