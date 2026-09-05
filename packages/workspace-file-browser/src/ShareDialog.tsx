import {
  Avatar,
  Badge,
  Button,
  CopyIcon,
  Dialog,
  GlobeIcon,
  LockIcon,
  SearchSelect,
  Select,
  Separator,
  Tooltip,
  TrashIcon,
  toast,
} from "@univerjs/univer-workspace-ui";
import { useEffect, useState } from "react";
import { browserCopy } from "./copy.js";
import type {
  WorkspaceFileAccessRole,
  WorkspaceFileGrant,
  WorkspaceFileLinkSharing,
  WorkspaceFileLocale,
  WorkspaceFileNode,
  WorkspaceFileShareRole,
  WorkspaceFileSharingDataSource,
  WorkspaceFileUser,
} from "./types.js";
import css from "./ShareDialog.module.scss";

export function ShareDialog(props: {
  readonly node: WorkspaceFileNode | null;
  readonly locale: WorkspaceFileLocale;
  readonly nodeUrl: string;
  readonly dataSource: WorkspaceFileSharingDataSource;
  readonly onClose: () => void;
}) {
  const copy = browserCopy[props.locale];
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<readonly WorkspaceFileUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<WorkspaceFileUser | null>(null);
  const [role, setRole] = useState<WorkspaceFileShareRole>("viewer");
  const [grants, setGrants] = useState<readonly WorkspaceFileGrant[]>([]);
  const [linkSharing, setLinkSharing] = useState<WorkspaceFileLinkSharing>({
    enabled: false,
    role: "viewer",
  });
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const nodeId = props.node?.id;

  const reload = async (id: string) => {
    setLoading(true);
    try {
      const [nextGrants, nextLinkSharing] = await Promise.all([
        props.dataSource.loadGrants(id),
        props.dataSource.loadLinkSharing(id),
      ]);
      setGrants(nextGrants);
      setLinkSharing(nextLinkSharing);
    } catch (reason) {
      toast.error(errorMessage(reason, copy.sharingUpdateFailed));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (nodeId === undefined) return;
    setSearch("");
    setUsers([]);
    setSelectedUser(null);
    void reload(nodeId);
  }, [nodeId]);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setUsers([]);
      return;
    }
    let current = true;
    void props.dataSource.searchUsers(query).then(
      (result) => current && setUsers(result),
      (reason) => current && toast.error(errorMessage(reason, copy.sharingUpdateFailed)),
    );
    return () => {
      current = false;
    };
  }, [copy.sharingUpdateFailed, props.dataSource, search]);

  const mutate = async (operation: () => Promise<void>, success: string) => {
    if (nodeId === undefined) return;
    setPending(true);
    try {
      await operation();
      await reload(nodeId);
      toast.success(success);
    } catch (reason) {
      toast.error(errorMessage(reason, copy.sharingUpdateFailed));
    } finally {
      setPending(false);
    }
  };

  const invite = () => {
    if (nodeId === undefined) return;
    if (selectedUser === null) {
      toast.error(copy.selectUser);
      return;
    }
    void mutate(
      () => props.dataSource.setGrant({ nodeId, userId: selectedUser.id, role }),
      copy.accessUpdated,
    ).then(() => {
      setSelectedUser(null);
      setSearch("");
    });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(props.nodeUrl);
      toast.success(copy.linkCopied);
    } catch {
      toast.error(copy.copyLinkFailed);
    }
  };

  return (
    <Dialog
      open={props.node !== null}
      onOpenChange={(open) => !open && props.onClose()}
      title={props.node ? copy.shareTitle(props.node.name) : copy.share}
      description={copy.shareDescription}
      width="xl"
    >
      <h3 className={css.heading}>{copy.inviteCollaborators}</h3>
      <div className={css.inviteRow}>
        <div className={css.search}>
          <SearchSelect<WorkspaceFileUser>
            items={users}
            value={selectedUser}
            onValueChange={setSelectedUser}
            onInputValueChange={(value, reason) => {
              if (reason !== "item-press") setSearch(value);
            }}
            itemToStringLabel={(user) => `${user.displayName} (@${user.username})`}
            itemKey={(user) => user.id}
            placeholder={copy.searchUsers}
            aria-label={copy.searchUsers}
            emptyContent={search.trim().length < 2 ? copy.minTwoChars : undefined}
            renderItem={(user) => (
              <span className={css.userOption}>
                <Avatar size="xs" src={user.avatarUrl} name={user.displayName} />
                <span className={css.truncate}>{user.displayName}</span>
                <span className={css.username}>@{user.username}</span>
              </span>
            )}
          />
        </div>
        <Select<WorkspaceFileShareRole>
          className={css.roleSelect}
          aria-label={copy.access}
          value={role}
          onValueChange={setRole}
          options={[
            { label: copy.accessViewer, value: "viewer" },
            { label: copy.accessEditor, value: "editor" },
          ]}
        />
        <Button onClick={invite} disabled={pending}>
          {copy.invite}
        </Button>
      </div>

      <Separator className={css.separator} />
      <div className={css.sectionHeading}>
        <h3 className={css.heading}>{copy.peopleWithAccess}</h3>
        <span>{copy.peopleCount(grants.length)}</span>
      </div>
      {grants.length === 0 && !loading ? (
        <p className={css.empty}>{copy.noDirectShares}</p>
      ) : (
        <ul className={css.grantList}>
          {grants.map((grant) => (
            <li key={grant.user.id} className={css.grantRow}>
              <Avatar src={grant.user.avatarUrl} name={grant.user.displayName} />
              <div className={css.userIdentity}>
                <span className={css.userName}>{grant.user.displayName}</span>
                <span className={css.username}>@{grant.user.username}</span>
              </div>
              <div className={css.grantActions}>
                <RoleBadge locale={props.locale} role={grant.role} />
                {grant.effectiveRole !== grant.role ? (
                  <span className={css.effectiveRole}>
                    {copy.effectiveRole(roleLabel(props.locale, grant.effectiveRole))}
                  </span>
                ) : null}
                <Tooltip content={copy.remove}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${copy.remove} ${grant.user.displayName}`}
                    className={css.removeButton}
                    disabled={pending}
                    onClick={() =>
                      void mutate(
                        () =>
                          props.dataSource.removeGrant({ nodeId: nodeId!, userId: grant.user.id }),
                        copy.accessRemoved,
                      )
                    }
                  >
                    <TrashIcon />
                  </Button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Separator className={css.separator} />
      <h3 className={css.heading}>{copy.linkSharing}</h3>
      <div className={css.linkCard}>
        <div className={css.linkSettings}>
          <span className={css.globe}>
            <GlobeIcon />
          </span>
          <div className={css.linkSummary}>
            <div className={css.linkTitle}>
              <span>
                {linkSharing.enabled ? copy.linkSharingEnabled : copy.linkSharingDisabled}
              </span>
              <span className={linkSharing.enabled ? css.statusOn : css.statusOff} />
            </div>
            <p>
              {linkSharing.enabled
                ? copy.linkSharingEnabledDescription
                : copy.linkSharingDisabledDescription}
            </p>
          </div>
          <div className={css.linkControls}>
            <button
              type="button"
              role="switch"
              aria-checked={linkSharing.enabled}
              aria-label={linkSharing.enabled ? copy.disableLinkSharing : copy.enableLinkSharing}
              disabled={loading || pending}
              className={css.switchButton}
              onClick={() =>
                void mutate(
                  () =>
                    props.dataSource.setLinkSharing({
                      nodeId: nodeId!,
                      enabled: !linkSharing.enabled,
                      role: linkSharing.role,
                    }),
                  copy.linkSharingUpdated,
                )
              }
            >
              <span className={linkSharing.enabled ? css.switchOn : css.switchOff}>
                <span />
              </span>
              {linkSharing.enabled ? copy.linkSharingOn : copy.linkSharingOff}
            </button>
            <Select<WorkspaceFileShareRole>
              className={css.linkRoleSelect}
              aria-label={copy.linkSharingAccess}
              value={linkSharing.role}
              disabled={!linkSharing.enabled || loading || pending}
              onValueChange={(nextRole) =>
                void mutate(
                  () =>
                    props.dataSource.setLinkSharing({
                      nodeId: nodeId!,
                      enabled: linkSharing.enabled,
                      role: nextRole,
                    }),
                  copy.linkSharingUpdated,
                )
              }
              options={[
                { label: copy.accessViewer, value: "viewer" },
                { label: copy.accessEditor, value: "editor" },
              ]}
            />
          </div>
        </div>
        <div className={css.linkFooter}>
          <span className={css.url}>{props.nodeUrl}</span>
          <Button
            size="sm"
            disabled={!linkSharing.enabled || pending}
            onClick={() => void copyLink()}
          >
            <CopyIcon />
            {copy.copyLink}
          </Button>
        </div>
      </div>
      <p className={css.privacy}>
        <LockIcon />
        {copy.privacyNote}
      </p>
    </Dialog>
  );
}

function RoleBadge(props: {
  readonly locale: WorkspaceFileLocale;
  readonly role: WorkspaceFileAccessRole;
}) {
  const variants = {
    owner: "warning",
    admin: "violet",
    editor: "brand",
    viewer: "default",
  } as const;
  return <Badge variant={variants[props.role]}>{roleLabel(props.locale, props.role)}</Badge>;
}

function roleLabel(locale: WorkspaceFileLocale, role: WorkspaceFileAccessRole): string {
  const copy = browserCopy[locale];
  if (role === "owner") return copy.accessOwner;
  if (role === "admin") return copy.accessAdmin;
  if (role === "editor") return copy.accessEditor;
  return copy.accessViewer;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
