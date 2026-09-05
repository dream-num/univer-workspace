import {
  WorkspaceFileBrowser,
  type WorkspaceFileBrowserDataSource,
  type WorkspaceFileGrant,
  type WorkspaceFileNode,
  type WorkspaceFileSpace,
  type WorkspaceFileTreeControls,
  type WorkspaceFileUser,
  type WorkspaceFileLocale,
} from "@univerjs/univer-workspace-file-browser";
import {
  Button,
  ChevronRightIcon,
  ConfirmDialog,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  Tooltip,
  toast,
} from "@univerjs/univer-workspace-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WORKSPACE_ME_PATH,
  WORKSPACE_NODES_PATH,
  WORKSPACE_SPACES_PATH,
  WORKSPACE_TRASH_BATCH_PATH,
  WORKSPACE_TRASH_PATH,
  type WorkspaceDocument,
  type WorkspaceMeView,
  type WorkspaceSpace,
  type WorkspaceTrashBatch,
} from "./workspace-contract.ts";
import type { WorkspaceContentSurface } from "./navigation/workspace-navigation.ts";
import type {
  WorkspaceResourceDescriptor,
  WorkspaceResourceReferenceInsertResult,
} from "./workspace-resource-reference.ts";
import type { UniverLocaleKey } from "./locales.ts";
import css from "./FileSidebar.module.scss";

const PRODUCT_API = "/univer-workspace/api";
const COLLAB_API = "/univer-workspace/collab";
const IMPORTABLE_DOCUMENT_EXTENSION = /\.(?:xls|xlsx|csv|tsv|doc|docx|ppt|pptx)$/iu;

export interface FileSidebarProps {
  readonly onOpenResource: (surface: WorkspaceContentSurface) => void;
  readonly currentSessionId: string | undefined;
  readonly insertResourceReference: (
    sessionId: string | undefined,
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
  ) => WorkspaceResourceReferenceInsertResult;
  readonly t: (key: UniverLocaleKey) => string;
  readonly locale: WorkspaceFileLocale;
}

export function FileSidebar({
  onOpenResource,
  currentSessionId,
  insertResourceReference,
  t,
  locale,
}: FileSidebarProps) {
  const [view, setView] = useState<"files" | "trash">("files");
  const [spaces, setSpaces] = useState<readonly WorkspaceSpace[]>([]);
  const [workspaceOrigin, setWorkspaceOrigin] = useState("");
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [trash, setTrash] = useState<readonly WorkspaceTrashBatch[]>([]);
  const [error, setError] = useState<string>();
  const [authRequired, setAuthRequired] = useState(false);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [trashLoading, setTrashLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [removeBatch, setRemoveBatch] = useState<WorkspaceTrashBatch>();

  const reportError = useCallback((reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    setAuthRequired(message === "workspace_connection_required");
    setError(message === "workspace_connection_required" ? undefined : message);
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshEpoch((value) => value + 1);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    void Promise.allSettled([
      fetch(WORKSPACE_SPACES_PATH, { credentials: "same-origin", signal: abort.signal }).then(
        (response) => readJson<{ spaces: WorkspaceSpace[] }>(response),
      ),
      fetch(WORKSPACE_ME_PATH, { credentials: "same-origin", signal: abort.signal }).then(
        (response) => readJson<WorkspaceMeView>(response),
      ),
    ]).then(([spaceResult, meResult]) => {
      if (abort.signal.aborted) return;

      let hasFailure = false;
      if (spaceResult.status === "fulfilled") {
        const spaceList = spaceResult.value;
        setSpaces(spaceList.spaces);
        setError(undefined);
        setSelectedSpaceId((current) =>
          current !== undefined && spaceList.spaces.some((space) => space.spaceId === current)
            ? current
            : spaceList.spaces[0]?.spaceId,
        );
      } else {
        hasFailure = true;
        reportError(spaceResult.reason);
      }

      if (meResult.status === "fulfilled") {
        setWorkspaceOrigin(meResult.value.workspaceOrigin);
        setAuthRequired(false);
      } else {
        hasFailure = true;
        const message =
          meResult.reason instanceof Error ? meResult.reason.message : String(meResult.reason);
        setAuthRequired(message === "workspace_connection_required");
        if (spaceResult.status !== "fulfilled") {
          setError(message === "workspace_connection_required" ? undefined : message);
        }
      }

      if (!hasFailure) {
        setError(undefined);
      }
    }).finally(() => {
      if (!abort.signal.aborted) setRefreshing(false);
    });
    return () => {
      abort.abort();
    };
  }, [refreshEpoch, reportError]);

  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener("uwh:files-refresh", onRefresh);
    return () => window.removeEventListener("uwh:files-refresh", onRefresh);
  }, [refresh]);

  const activeSpace = spaces.find((space) => space.spaceId === selectedSpaceId);
  const canViewTrash = activeSpace?.capabilities?.viewTrash === true;
  useEffect(() => {
    if (view === "trash" && !canViewTrash) setView("files");
  }, [canViewTrash, view]);

  useEffect(() => {
    if (view !== "trash" || selectedSpaceId === undefined) return;
    const abort = new AbortController();
    setTrashLoading(true);
    setError(undefined);
    void fetch(`${WORKSPACE_TRASH_PATH}/${encodeURIComponent(selectedSpaceId)}/trash`, {
      credentials: "same-origin",
      signal: abort.signal,
    })
      .then((response) => readJson<{ items?: WorkspaceTrashBatch[] }>(response))
      .then((result) => setTrash(result.items ?? []))
      .catch((reason) => {
        if (!abort.signal.aborted) reportError(reason);
      })
      .finally(() => {
        if (!abort.signal.aborted) setTrashLoading(false);
      });
    return () => abort.abort();
  }, [refreshEpoch, reportError, selectedSpaceId, view]);

  const dataSource = useMemo<WorkspaceFileBrowserDataSource>(
    () => ({
      async loadChildren({ spaceId, parentNodeId, signal }) {
        const query = new URLSearchParams();
        if (parentNodeId !== null) query.set("parentNodeId", parentNodeId);
        const suffix = query.size === 0 ? "" : `?${query.toString()}`;
        const result = await fetchJson<{ documents: WorkspaceDocument[] }>(
          `${WORKSPACE_NODES_PATH}/${encodeURIComponent(spaceId)}/nodes${suffix}`,
          { credentials: "same-origin", signal },
        );
        return result.documents.map((document) => toWorkspaceFileNode(spaceId, document));
      },
      async createTeamSpace(input) {
        const space = await fetchJson<RemoteSpaceView>(`${PRODUCT_API}/team-spaces`, {
          method: "POST",
          credentials: "same-origin",
          headers: jsonHeaders(),
          body: JSON.stringify(input),
        });
        refresh();
        return toWorkspaceFileSpaceView(space);
      },
      async createNode(input) {
        const initialData =
          input.kind === "doc"
            ? await createDocumentInitialData(input.documentMode, input.name)
            : undefined;
        await fetchJson(`${WORKSPACE_NODES_PATH}/${encodeURIComponent(input.spaceId)}/nodes`, {
          method: "POST",
          credentials: "same-origin",
          headers: jsonHeaders(),
          body: JSON.stringify({
            name: input.name,
            unitType: input.kind,
            parentNodeId: input.parentNodeId,
            ...(initialData === undefined ? {} : { initialData }),
          }),
        });
      },
      async uploadFile(input) {
        if (IMPORTABLE_DOCUMENT_EXTENSION.test(input.file.name)) {
          await importDocument(input.spaceId, input.parentNodeId, input.file);
        } else {
          await uploadBlob(input.spaceId, input.parentNodeId, input.file);
        }
      },
      async renameNode({ node, name }) {
        await fetchJson(`${PRODUCT_API}/nodes/${encodeURIComponent(node.id)}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: jsonHeaders(),
          body: JSON.stringify({ name }),
        });
      },
      async moveNode({ nodeId, parentNodeId }) {
        await fetchJson(`${PRODUCT_API}/nodes/${encodeURIComponent(nodeId)}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: jsonHeaders(),
          body: JSON.stringify({ parentNodeId }),
        });
      },
      async trashNode({ node }) {
        await fetchJson(`${PRODUCT_API}/nodes/${encodeURIComponent(node.id)}/trash`, {
          method: "POST",
          credentials: "same-origin",
        });
        refresh();
      },
      nodeUrl(node) {
        return new URL(`/nodes/${encodeURIComponent(node.id)}`, workspaceOrigin).toString();
      },
      sharing: {
        async loadGrants(nodeId) {
          const result = await fetchJson<{ grants: WorkspaceFileGrant[] }>(
            `${PRODUCT_API}/nodes/${encodeURIComponent(nodeId)}/grants`,
          );
          return result.grants;
        },
        async searchUsers(query) {
          const result = await fetchJson<{ users: WorkspaceFileUser[] }>(
            `${PRODUCT_API}/users/search?query=${encodeURIComponent(query)}`,
          );
          return result.users;
        },
        async loadLinkSharing(nodeId) {
          return await fetchJson(`${PRODUCT_API}/nodes/${encodeURIComponent(nodeId)}/link-sharing`);
        },
        async setGrant({ nodeId, userId, role }) {
          await fetchJson(
            `${PRODUCT_API}/nodes/${encodeURIComponent(nodeId)}/grants/${encodeURIComponent(userId)}`,
            {
              method: "PUT",
              credentials: "same-origin",
              headers: jsonHeaders(),
              body: JSON.stringify({ role }),
            },
          );
        },
        async removeGrant({ nodeId, userId }) {
          await fetchJson(
            `${PRODUCT_API}/nodes/${encodeURIComponent(nodeId)}/grants/${encodeURIComponent(userId)}`,
            { method: "DELETE", credentials: "same-origin" },
          );
        },
        async setLinkSharing({ nodeId, enabled, role }) {
          await fetchJson(`${PRODUCT_API}/nodes/${encodeURIComponent(nodeId)}/link-sharing`, {
            method: "PUT",
            credentials: "same-origin",
            headers: jsonHeaders(),
            body: JSON.stringify({ enabled, role }),
          });
        },
      },
    }),
    [refresh, workspaceOrigin],
  );

  const treeSpaces = useMemo(() => spaces.map(toWorkspaceFileSpace), [spaces]);
  const storageScope = useMemo(
    () =>
      spaces
        .map((space) => space.spaceId)
        .sort()
        .join(":"),
    [spaces],
  );

  const mutateTrash = async (batch: WorkspaceTrashBatch, action: "restore" | "remove") => {
    const path =
      action === "restore"
        ? `${WORKSPACE_TRASH_BATCH_PATH}/${encodeURIComponent(batch.id)}/restore`
        : `${WORKSPACE_TRASH_BATCH_PATH}/${encodeURIComponent(batch.id)}`;
    try {
      await fetchJson(path, {
        method: action === "restore" ? "POST" : "DELETE",
        credentials: "same-origin",
      });
      setRemoveBatch(undefined);
      refresh();
      toast.success(action === "restore" ? t("file.restoreSuccess") : t("file.deleteSuccess"));
    } catch (reason) {
      reportError(reason);
    }
  };

  return (
    <section className={css.sidebar} aria-label={`Workspace ${t("file.title")}`}>
      <header className={css.header}>
        <div className={css.headerTitle}>
          {view === "trash" ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("file.back")}
              onClick={() => setView("files")}
            >
              <ChevronRightIcon className={css.backIcon} />
            </Button>
          ) : null}
          <span>
            {view === "files"
              ? t("file.title")
              : `${activeSpace?.name ?? "Workspace"} · ${t("file.trashTitle")}`}
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t("file.refresh")} aria-busy={refreshing}
          disabled={refreshing} onClick={refresh}>
          <RefreshIcon />
        </Button>
      </header>

      {authRequired ? (
        <div className={css.authNotice} role="status">
          <strong>{t("file.authTitle")}</strong>
          <span>{t("file.authBody")}</span>
        </div>
      ) : null}
      {error !== undefined ? (
        <div className={css.error} role="alert">
          {error}
        </div>
      ) : null}

      {view === "files" ? (
        <div className={css.treeViewport}>
          <WorkspaceFileBrowser
            spaces={treeSpaces}
            dataSource={dataSource}
            storageScope={storageScope}
            locale={locale}
            {...(selectedSpaceId === undefined ? {} : { selectedSpaceId })}
            {...(selectedNodeId === undefined ? {} : { selectedNodeId })}
            onOpenSpace={(space) => {
              setSelectedSpaceId(space.id);
              setSelectedNodeId(undefined);
            }}
            onOpenNode={(node) => {
              setSelectedSpaceId(node.spaceId);
              setSelectedNodeId(node.id);
              const contentSurface = resourceSurfaceOf(
                node,
                workspaceOrigin,
                spaces.find((space) => space.spaceId === node.spaceId)?.name,
              );
              if (contentSurface !== undefined) onOpenResource(contentSurface);
            }}
            renderNodeActions={(node: WorkspaceFileNode, _controls: WorkspaceFileTreeControls) => {
              const resource = node.resource;
              if (resource?.kind !== "univer") return null;
              return (
                <>
                  <Tooltip content={t("resource.addToMessage")}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("resource.addToMessage")}
                      onClick={(event) => {
                        event.stopPropagation();
                        insertResourceReference(currentSessionId, {
                          resourceId: resource.id,
                          name: node.name,
                        });
                      }}
                    >
                      <PlusIcon />
                    </Button>
                  </Tooltip>
                </>
              );
            }}
          />
        </div>
      ) : (
        <ul className={css.trash}>
          {trashLoading ? <li className={css.status}>{t("file.loading")}</li> : null}
          {!trashLoading && trash.length === 0 ? (
            <li className={css.status}>{t("file.emptyTrash")}</li>
          ) : null}
          {trash.map((batch) => (
            <li key={batch.id} className={css.trashRow}>
              <span>{batch.root?.name ?? batch.id}</span>
              <span className={css.trashActions}>
                {batch.capabilities?.restore === true ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void mutateTrash(batch, "restore")}
                  >
                    {t("file.restore")}
                  </Button>
                ) : null}
                {batch.capabilities?.removePermanently === true ? (
                  <Button
                    variant="destructive-ghost"
                    size="sm"
                    onClick={() => setRemoveBatch(batch)}
                  >
                    {t("file.deletePermanently")}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {view === "files" && canViewTrash ? (
        <div className={css.footerNavigation}>
          <button type="button" className={css.navigationRow} onClick={() => setView("trash")}>
            <TrashIcon />
            <span>{t("file.trash")}</span>
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={removeBatch !== undefined}
        onOpenChange={(open) => !open && setRemoveBatch(undefined)}
        title={t("file.deleteTitle").replace(
          "{name}",
          removeBatch?.root?.name ?? t("file.itemFallback"),
        )}
        description={t("file.deleteDescription")}
        confirmText={t("file.deletePermanently")}
        cancelText={t("file.cancel")}
        danger
        onConfirm={() => removeBatch && void mutateTrash(removeBatch, "remove")}
      />
    </section>
  );
}

interface RemoteSpaceView {
  readonly id: string;
  readonly type: "personal" | "team";
  readonly name: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  readonly capabilities: WorkspaceFileSpace["capabilities"];
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const value = text.trim() === "" ? undefined : (JSON.parse(text) as unknown);
  if (response.status === 401) throw new Error("workspace_connection_required");
  if (!response.ok) {
    const message =
      value !== null && typeof value === "object" && "error" in value
        ? String((value as { error: unknown }).error)
        : `Workspace request failed (${response.status})`;
    throw new Error(message);
  }
  return value as T;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  return await readJson<T>(await fetch(path, { credentials: "same-origin", ...init }));
}

function jsonHeaders(): HeadersInit {
  return { "content-type": "application/json" };
}

async function createDocumentInitialData(mode: "modern" | "classic", title: string) {
  const { DocumentFlavor, LocaleType, getDocsEmptySnapshot } = await import("@univerjs/core");
  return getDocsEmptySnapshot(
    "workspace-new-document",
    LocaleType.ZH_CN,
    title,
    mode === "classic" ? DocumentFlavor.TRADITIONAL : DocumentFlavor.MODERN,
  );
}

async function uploadBlob(spaceId: string, parentNodeId: string | null, file: File) {
  const reserved = await fetchJson<{
    readonly upload: { readonly id: string };
  }>(`${PRODUCT_API}/blob-upload-sessions`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      spaceId,
      parentNodeId,
      name: file.name,
      originalFilename: file.name,
      byteSize: file.size,
      ...(file.type ? { declaredMediaType: file.type } : {}),
    }),
  });
  const uploadId = encodeURIComponent(reserved.upload.id);
  try {
    await fetchJson(`${PRODUCT_API}/blob-upload-sessions/${uploadId}/content`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    await fetchJson(`${PRODUCT_API}/blob-upload-sessions/${uploadId}/complete`, {
      method: "POST",
      credentials: "same-origin",
    });
  } catch (reason) {
    await fetch(`${PRODUCT_API}/blob-upload-sessions/${uploadId}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    throw reason;
  }
}

async function importDocument(spaceId: string, parentNodeId: string | null, file: File) {
  const form = new FormData();
  form.append("file", file);
  const uploaded = await fetchJson<{ readonly FileId?: string }>(
    `${COLLAB_API}/universer-api/stream/file/upload?size=${encodeURIComponent(file.size)}&source=1&flate=false`,
    { method: "POST", credentials: "same-origin", body: form },
  );
  if (!uploaded.FileId) throw new Error("file_import_failed");
  const started = await fetchJson<{ readonly taskID?: string }>(
    `${COLLAB_API}/universer-api/exchange/import`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: jsonHeaders(),
      body: JSON.stringify({
        fileID: uploaded.FileId,
        outputType: 1,
        spaceId,
        parentNodeId,
      }),
    },
  );
  if (!started.taskID) throw new Error("file_import_failed");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const task = await fetchJson<{
      readonly status?: string;
      readonly error?: { readonly message?: string };
    }>(`${COLLAB_API}/universer-api/exchange/task/${encodeURIComponent(started.taskID)}`);
    if (task.status === "done") return;
    if (task.status === "failed") throw new Error(task.error?.message ?? "file_import_failed");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("file_import_failed");
}

function toWorkspaceFileSpaceView(space: RemoteSpaceView): WorkspaceFileSpace {
  return {
    id: space.id,
    type: space.type,
    name: space.name,
    accessRole: space.accessRole,
    capabilities: space.capabilities,
  };
}

function toWorkspaceFileSpace(space: WorkspaceSpace): WorkspaceFileSpace {
  return {
    id: space.spaceId,
    type: space.type,
    name: space.name,
    accessRole: space.accessRole,
    capabilities: {
      browseRoot: space.capabilities?.browseRoot === true,
      createAtRoot: space.capabilities?.createAtRoot === true,
      renameSpace: space.capabilities?.renameSpace === true,
      manageMembers: space.capabilities?.manageMembers === true,
      viewTrash: space.capabilities?.viewTrash === true,
    },
  };
}

function toWorkspaceFileNode(spaceId: string, document: WorkspaceDocument): WorkspaceFileNode {
  return {
    id: document.nodeId,
    spaceId,
    parentNodeId: document.parentNodeId,
    name: document.name,
    resource:
      document.resourceId === null || document.resourceKind === null
        ? null
        : document.resourceKind === "univer"
          ? {
              id: document.resourceId,
              kind: "univer",
              ...(document.unitType === null ? {} : { unitType: document.unitType }),
            }
          : {
              id: document.resourceId,
              kind: "blob",
              ...(document.mediaType === undefined ? {} : { mediaType: document.mediaType }),
              ...(document.byteSize === undefined ? {} : { byteSize: document.byteSize }),
            },
    hasChildren: document.hasChildren,
    accessRole: document.accessRole,
    capabilities: {
      browseChildren: document.nodeCapabilities?.browseChildren === true,
      createChildren: document.nodeCapabilities?.createChildren === true,
      rename: document.nodeCapabilities?.rename === true,
      move: document.nodeCapabilities?.move === true,
      trash: document.nodeCapabilities?.trash === true,
      share: document.nodeCapabilities?.share === true,
    },
  };
}

function resourceSurfaceOf(
  node: WorkspaceFileNode,
  workspaceOrigin: string,
  spaceName: string | undefined,
): WorkspaceContentSurface | undefined {
  if (workspaceOrigin === "" || node.resource === undefined || node.resource === null)
    return undefined;
  if (node.resource.kind === "blob") {
    return {
      kind: "blob",
      workspaceOrigin,
      resourceId: node.resource.id,
      name: node.name,
      mediaType: node.resource.mediaType ?? "application/octet-stream",
      byteSize: node.resource.byteSize ?? null,
    };
  }
  if (node.resource.kind !== "univer") return undefined;
  return {
    kind: "resource",
    workspaceOrigin,
    docKey: `res:${node.resource.id}`,
    resourceId: node.resource.id,
    name: node.name,
    unitType: node.resource.unitType ?? null,
    ...(spaceName === undefined ? {} : { spaceName }),
  };
}
