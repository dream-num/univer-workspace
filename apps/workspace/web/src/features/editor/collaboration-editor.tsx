import type { ILanguagePack } from "@univerjs/core";
import {
  CommandType,
  LifecycleStages,
  LocaleType,
  LogLevel,
  UserManagerService,
} from "@univerjs/core";
import {
  SnapshotService,
  UniverCollaborationPlugin,
} from "@univerjs-pro/collaboration";
import {
  CollaborationUIEventId,
  CollaborationUIEventService,
  CollaborationStatus,
  UniverCollaborationClientPlugin,
  type IUniverCollaborationClientConfig,
} from "@univerjs-pro/collaboration-client";
import {
  BrowserCollaborationSocketService,
  DesktopCollaborationStatusDisplayController,
  UniverCollaborationClientUIPlugin,
} from "@univerjs-pro/collaboration-client-ui";
import CollaborationClientEnUS from "@univerjs-pro/collaboration-client/locale/en-US";
import CollaborationClientZhCN from "@univerjs-pro/collaboration-client/locale/zh-CN";
import CollaborationClientUIEnUS from "@univerjs-pro/collaboration-client-ui/locale/en-US";
import CollaborationClientUIZhCN from "@univerjs-pro/collaboration-client-ui/locale/zh-CN";
import { UniverEmbedPlugin } from "@univerjs-pro/embed";
import { UniverEmbedUIPlugin } from "@univerjs-pro/embed-ui";
import { UniverLicensePlugin } from "@univerjs-pro/license";
import {
  createWorktreeCollaborationConfig,
  createWorktreeMergePreviewConfig,
} from "@univerjs-pro/collaboration-worktree-client";
import type {
  FUniver,
  IPreset,
  IPresetPlugin,
} from "@univerjs/presets";
import type { IUser } from "@univerjs/protocol";
import type { Theme } from "@univerjs/themes";
import { createUniver, mergeLocales } from "@univerjs/presets";
import { useEffect, useRef, useState } from "react";
import {
  createWorkspaceReferencedUnitProviderRegistration,
  type WorkspaceReferenceHostContext,
} from "@univerjs/univer-workspace-reference-provider";
import type { AppLanguage } from "../../shared/i18n";
import { useI18n } from "../../shared/i18n";
import { syncUniverTheme, useTheme } from "../../shared/theme";
import { Alert } from "../../shared/ui/alert";
import { Spinner } from "../../shared/ui/spinner";
import { cn } from "../../shared/utils/cn";
import {
  collaborationStatusMessageKey,
  type CollaborationIssue,
} from "./collaboration-status";
import { resolveMergeReview } from "./merge-review";
import { resolveUniverLicense } from "./univer-license";
import {
  withWorkspaceSnapshotServerOverride,
  type WorkspaceHostSnapshotScope,
} from "./workspace-snapshot-server-adapter";

import "@univerjs-pro/collaboration-client-ui/lib/index.css";
import "@univerjs-pro/collaboration-client/facade";
import "@univerjs-pro/embed/facade";
import "@univerjs-pro/embed-ui/lib/index.css";

export interface CollaborationEditorProps {
  readonly unitId: string;
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  };
  readonly collaborationScope?:
    | { readonly kind: "trunk" }
    | {
        readonly kind: "worktree" | "mergePreview";
        readonly worktreeId: string;
      };
  readonly mappedUnitIds?: readonly string[];
  readonly readOnly?: boolean;
}

interface ICollaborationEditorDefinition {
  readonly label: string;
  readonly enableDocumentCollaborationUI?: boolean;
  readonly collaborationProvidedByPreset?: boolean;
  readonly licenseProvidedByPreset?: boolean;
  readonly useCustomCollaborationStatus?: boolean;
  readonly theme: Theme;
  readonly createPresets: (
    container: HTMLElement,
    license: string
  ) => IPreset[];
  readonly locales: Readonly<Record<AppLanguage, ILanguagePack>>;
  readonly collaborationFeaturePlugins?: () => IPresetPlugin[];
  readonly load: (
    univerAPI: FUniver,
    unitId: string
  ) => Promise<unknown | null>;
}

export function createCollaborationEditor(
  definition: ICollaborationEditorDefinition
) {
  return function CollaborationEditor({
    unitId,
    user,
    collaborationScope = { kind: "trunk" },
    mappedUnitIds,
    readOnly = false,
  }: CollaborationEditorProps) {
    const container = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [collaborationStatus, setCollaborationStatus] =
      useState<CollaborationStatus>(CollaborationStatus.NOT_COLLAB);
    const [collaborationIssue, setCollaborationIssue] =
      useState<CollaborationIssue>(null);
    const { language, t } = useI18n();
    const { resolvedTheme } = useTheme();
    const resolvedThemeRef = useRef(resolvedTheme);
    const univerAPIRef = useRef<FUniver | null>(null);
    const mappedUnitIdsKey = mappedUnitIds?.join("\u0000") ?? "";
    resolvedThemeRef.current = resolvedTheme;

    useEffect(() => {
      if (univerAPIRef.current) {
        syncUniverTheme(univerAPIRef.current, resolvedTheme);
      }
    }, [resolvedTheme]);

    useEffect(() => {
      const element = container.current;
      if (!element) return;
      setLoading(true);
      setError(null);
      setCollaborationIssue(null);
      let disposed = false;
      let mountedUniver: ReturnType<typeof createUniver>["univer"] | null =
        null;
      let statusListener: { dispose(): void } | null = null;
      let collaborationUIEventListener: { unsubscribe(): void } | null = null;
      let readOnlyListener: { dispose(): void } | null = null;
      let readOnlyLifecycleListener: { dispose(): void } | null = null;

      const mount = async () => {
        if (!element.id) {
          element.id = `univer-${definition.label}-${unitId}`;
        }
        const resolvedCollaboration = await resolveCollaborationConfig(
          collaborationScope,
          unitId
        );
        if (disposed) return;
        const collaborationConfig = {
          ...resolvedCollaboration.pluginConfig,
          override: withWorkspaceSnapshotServerOverride(
            resolvedCollaboration.pluginConfig.override,
            {
              hostScope: resolvedCollaboration.hostSnapshotScope,
              origin: window.location.origin,
              resolveMergePreview: loadMergeReviewResolution,
            }
          ),
        };
        const referenceHostContext = createReferenceHostContext(
          collaborationScope,
          mappedUnitIds
        );
        const referenceProvider =
          createWorkspaceReferencedUnitProviderRegistration({
            hostContext: referenceHostContext,
            resolveSnapshotService: () => {
              if (!mountedUniver) {
                throw new Error(
                  "Workspace SnapshotService is not ready."
                );
              }
              return mountedUniver.__getInjector().get(SnapshotService);
            },
          });
        const license = resolveUniverLicense();
        const licensePlugins: IPresetPlugin[] =
          definition.licenseProvidedByPreset
            ? []
            : [
                [
                  UniverLicensePlugin,
                  {
                    license,
                  },
                ],
              ];
        let presets = definition.createPresets(element, license);
        if (licensePlugins.length > 0) {
          // createUniver registers every preset before its top-level plugins.
          // Keep License ahead of Pro feature presets so their dependency
          // registration does not install a second License plugin implicitly.
          presets = [{ plugins: licensePlugins }, ...presets];
        }
        const collaborationPlugins: IPresetPlugin[] =
          definition.collaborationProvidedByPreset
            ? []
            : [
                UniverCollaborationPlugin,
                [
                  UniverCollaborationClientPlugin,
                  {
                    socketService: BrowserCollaborationSocketService,
                    enableOfflineEditing: true,
                    enableAuthServer: true,
                    wsSessionTicketUrl:
                      "/universer-api/user/session-ticket",
                    authzUrl: "/universer-api/authz",
                    loginUrlKey: "/login",
                    sendChangesetTimeout: 200,
                    ...collaborationConfig,
                  },
                ],
                [
                  UniverCollaborationClientUIPlugin,
                  {
                    enableDocumentCollaborationUI:
                      definition.enableDocumentCollaborationUI,
                    override: definition.useCustomCollaborationStatus
                      ? [
                          [
                            DesktopCollaborationStatusDisplayController,
                            null,
                          ],
                        ]
                      : undefined,
                  },
                ],
              ];
        const collaborationFeaturePlugins =
          definition.collaborationFeaturePlugins?.() ?? [];
        if (definition.collaborationProvidedByPreset) {
          presets = configurePresetCollaboration(
            presets,
            collaborationConfig,
            definition
          );
        }
        const univerLocale =
          language === "zh-CN" ? LocaleType.ZH_CN : LocaleType.EN_US;
        const { univer, univerAPI } = createUniver({
          locale: univerLocale,
          locales: {
            [univerLocale]: mergeLocales(
              definition.locales[language],
              language === "zh-CN"
                ? CollaborationClientZhCN
                : CollaborationClientEnUS,
              language === "zh-CN"
                ? CollaborationClientUIZhCN
                : CollaborationClientUIEnUS
            ),
          },
          theme: definition.theme,
          darkMode: resolvedThemeRef.current === "dark",
          logLevel: LogLevel.WARN,
          collaboration: true,
          presets,
          plugins: [
            ...collaborationPlugins,
            ...collaborationFeaturePlugins,
            [
              UniverEmbedPlugin,
              {
                resourceRefUnitProviderRegistrations: [
                  referenceProvider,
                ],
              },
            ],
            UniverEmbedUIPlugin,
          ],
        });
        mountedUniver = univer;
        univerAPIRef.current = univerAPI;
        collaborationUIEventListener = univer
          .__getInjector()
          .get(CollaborationUIEventService)
          .event$.subscribe((event) => {
            if (disposed) return;
            if (event.id === CollaborationUIEventId.PERMISSION_DENIED) {
              setCollaborationIssue("permission");
            } else if (event.id === CollaborationUIEventId.CONFLICT) {
              setCollaborationIssue("conflict");
            }
          });
        if (readOnly) {
          const installReadOnlyGuard = () => {
            if (disposed || readOnlyListener) return;
            readOnlyListener = univerAPI.addEvent(
              univerAPI.Event.BeforeCommandExecute,
              (event) => {
                const command = event as {
                  readonly type: CommandType;
                  readonly options?: {
                    readonly fromCollab?: boolean;
                    readonly fromChangeset?: boolean;
                  };
                  cancel: boolean;
                };
                if (
                  command.type === CommandType.MUTATION &&
                  !command.options?.fromCollab &&
                  !command.options?.fromChangeset
                ) {
                  command.cancel = true;
                }
              }
            );
          };
          if (
            univerAPI.getCurrentLifecycleStage() >=
            LifecycleStages.Steady
          ) {
            installReadOnlyGuard();
          } else {
            readOnlyLifecycleListener = univerAPI.addEvent(
              univerAPI.Event.LifeCycleChanged,
              ({ stage }) => {
                if (stage < LifecycleStages.Steady) return;
                readOnlyLifecycleListener?.dispose();
                readOnlyLifecycleListener = null;
                installReadOnlyGuard();
              }
            );
          }
        }

        const protocolUser: IUser = {
          userID: user.id,
          name: user.displayName,
          avatar: user.avatarUrl ?? "",
          anonymous: false,
          canBindAnonymous: false,
          phone: "",
          email: "",
          createTimestamp: 0,
        };
        univer
          .__getInjector()
          .get(UserManagerService)
          .setCurrentUser(protocolUser);

        const collaboration = univerAPI.getCollaboration();
        statusListener = univerAPI.addEvent(
          univerAPI.Event.CollaborationStatusChanged,
          (event) => {
            if (!disposed && event.unitId === unitId) {
              setCollaborationStatus(event.status);
              if (event.status !== CollaborationStatus.CONFLICT) {
                setCollaborationIssue(null);
              }
            }
          }
        );
        await definition.load(univerAPI, unitId).then((unit) => {
          if (!disposed && !unit) {
            throw new Error(
              `The ${definition.label} could not be loaded.`
            );
          }
          if (!disposed) {
            setCollaborationStatus(
              collaboration.getCollaborationStatus(unitId)
            );
            setLoading(false);
          }
        });
      };

      mount().catch((reason: unknown) => {
        if (disposed) return;
        setLoading(false);
        setError(
          reason instanceof Error
            ? reason.message
            : `The ${definition.label} could not be loaded.`
        );
      });

      return () => {
        disposed = true;
        statusListener?.dispose();
        collaborationUIEventListener?.unsubscribe();
        readOnlyListener?.dispose();
        readOnlyLifecycleListener?.dispose();
        mountedUniver?.dispose();
        univerAPIRef.current = null;
      };
    }, [
      collaborationScope.kind,
      collaborationScope.kind === "trunk"
        ? ""
        : collaborationScope.worktreeId,
      mappedUnitIdsKey,
      language,
      unitId,
      user.avatarUrl,
      user.displayName,
      user.id,
      readOnly,
    ]);

    return (
      <div className="univer-editor-shell">
        {!loading && !error && definition.useCustomCollaborationStatus ? (
          <div
            className={cn(
              "pointer-events-none absolute top-3 right-4 z-10 flex items-center gap-1.5 rounded-full border border-border bg-background/85 py-1 pr-2.5 pl-2 text-xs font-medium shadow-sm backdrop-blur-sm",
              collaborationStatus === CollaborationStatus.SYNCED &&
                "text-success-soft-foreground",
              collaborationStatus === CollaborationStatus.CONFLICT &&
                "text-destructive-soft-foreground",
              collaborationStatus === CollaborationStatus.OFFLINE &&
                "text-warning-soft-foreground",
              collaborationStatus !== CollaborationStatus.SYNCED &&
                collaborationStatus !== CollaborationStatus.CONFLICT &&
                collaborationStatus !== CollaborationStatus.OFFLINE &&
                "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                collaborationStatus === CollaborationStatus.SYNCED &&
                  "bg-success",
                collaborationStatus === CollaborationStatus.CONFLICT &&
                  "bg-destructive",
                collaborationStatus === CollaborationStatus.OFFLINE &&
                  "bg-warning",
                collaborationStatus !== CollaborationStatus.SYNCED &&
                  collaborationStatus !== CollaborationStatus.CONFLICT &&
                  collaborationStatus !== CollaborationStatus.OFFLINE &&
                  "bg-subtle-foreground"
              )}
            />
            {t(
              collaborationStatusMessageKey(
                collaborationStatus,
                collaborationIssue
              )
            )}
          </div>
        ) : null}
        {error ? (
          <Alert
            variant="destructive"
            className="m-6"
            title={t("resourceOpenFailed")}
          >
            {error}
          </Alert>
        ) : null}
        {loading ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/85 backdrop-blur-[1px]">
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <Spinner className="size-5 text-brand-600" />
              {t("loadingType", { type: definition.label })}
            </div>
          </div>
        ) : null}
        <div ref={container} className="univer-editor-container" />
      </div>
    );
  };
}

function configurePresetCollaboration(
  presets: IPreset[],
  collaborationConfig: Awaited<
    ReturnType<typeof resolveCollaborationConfig>
  >["pluginConfig"],
  definition: ICollaborationEditorDefinition
): IPreset[] {
  return presets.map((preset) => ({
    ...preset,
    plugins: preset.plugins.map((plugin): IPresetPlugin => {
      if (!Array.isArray(plugin)) return plugin;
      const [PluginConstructor, pluginConfig] = plugin;
      if (PluginConstructor === UniverCollaborationClientPlugin) {
        return [
          PluginConstructor,
          {
            ...(pluginConfig as object),
            enableOfflineEditing: true,
            enableAuthServer: true,
            wsSessionTicketUrl: "/universer-api/user/session-ticket",
            authzUrl: "/universer-api/authz",
            loginUrlKey: "/login",
            sendChangesetTimeout: 200,
            ...collaborationConfig,
          },
        ];
      }
      if (PluginConstructor === UniverCollaborationClientUIPlugin) {
        return [
          PluginConstructor,
          {
            ...(pluginConfig as object),
            enableDocumentCollaborationUI:
              definition.enableDocumentCollaborationUI,
            override: definition.useCustomCollaborationStatus
              ? [[DesktopCollaborationStatusDisplayController, null]]
              : undefined,
          },
        ];
      }
      return plugin;
    }),
  }));
}

async function resolveCollaborationConfig(
  scope: NonNullable<CollaborationEditorProps["collaborationScope"]>,
  unitId: string
): Promise<{
  readonly pluginConfig: Partial<IUniverCollaborationClientConfig>;
  readonly hostSnapshotScope: WorkspaceHostSnapshotScope;
}> {
  const wsProtocol =
    window.location.protocol === "https:" ? "wss:" : "ws:";
  if (scope.kind === "trunk") {
    return {
      pluginConfig: {
        snapshotServerUrl: "/universer-api/snapshot",
        collabSubmitChangesetUrl: "/universer-api/comb",
        collabWebSocketUrl: `${wsProtocol}//${window.location.host}/universer-api/comb/connect`,
        uploadFileServerUrl: "/universer-api/stream/file/upload",
        signUrlServerUrl: "/universer-api/file/{fileID}/sign-url",
      },
      hostSnapshotScope: { kind: "trunk" },
    };
  }
  if (scope.kind === "worktree") {
    return {
      pluginConfig: {
        ...createWorktreeCollaborationConfig({
          origin: window.location.origin,
          worktreeID: scope.worktreeId,
        }),
        uploadFileServerUrl: `/universer-api/worktrees/${encodeURIComponent(scope.worktreeId)}/stream/file/upload`,
        signUrlServerUrl: `/universer-api/worktrees/${encodeURIComponent(scope.worktreeId)}/file/{fileID}/sign-url`,
      },
      hostSnapshotScope: {
        kind: "worktree",
        worktreeId: scope.worktreeId,
      },
    };
  }
  const resolution = await loadMergeReviewResolution(
    scope.worktreeId,
    unitId
  );
  const worktreePluginConfig = {
    ...createWorktreeCollaborationConfig({
      origin: window.location.origin,
      worktreeID: scope.worktreeId,
    }),
    uploadFileServerUrl: `/universer-api/worktrees/${encodeURIComponent(scope.worktreeId)}/stream/file/upload`,
    signUrlServerUrl: `/universer-api/worktrees/${encodeURIComponent(scope.worktreeId)}/file/{fileID}/sign-url`,
  };
  if (resolution.kind === "worktree") {
    return {
      pluginConfig: worktreePluginConfig,
      hostSnapshotScope: {
        kind: "worktree",
        worktreeId: scope.worktreeId,
      },
    };
  }
  if (resolution.kind === "unavailable") {
    throw new Error(
      resolution.reason === "conflict"
        ? "文档存在合入冲突，暂时无法生成预览。"
        : "暂时无法生成合入预览。"
    );
  }
  return {
    pluginConfig: {
      ...createWorktreeMergePreviewConfig({
        origin: window.location.origin,
        worktreeID: scope.worktreeId,
        preview: resolution.preview,
      }),
      uploadFileServerUrl: `/universer-api/worktrees/${encodeURIComponent(scope.worktreeId)}/stream/file/upload`,
      signUrlServerUrl: `/universer-api/worktrees/${encodeURIComponent(scope.worktreeId)}/file/{fileID}/sign-url`,
    },
    hostSnapshotScope: {
      kind: "mergePreview",
      worktreeId: scope.worktreeId,
      preview: resolution.preview,
    },
  };
}

async function loadMergeReviewResolution(
  worktreeId: string,
  unitId: string
): Promise<ReturnType<typeof resolveMergeReview>> {
  const response = await fetch(
    `/universer-api/worktrees/${encodeURIComponent(worktreeId)}/units/${encodeURIComponent(unitId)}/merge-preview`,
    { credentials: "include" }
  );
  if (!response.ok) {
    throw new Error("The merge preview could not be prepared.");
  }
  const body = (await response.json()) as {
    readonly evaluation?: Parameters<typeof resolveMergeReview>[0];
  };
  return resolveMergeReview(body.evaluation);
}

function createReferenceHostContext(
  scope: NonNullable<CollaborationEditorProps["collaborationScope"]>,
  mappedUnitIds: readonly string[] | undefined
): WorkspaceReferenceHostContext {
  if (scope.kind === "trunk") return { view: { kind: "trunk" } };
  if (!mappedUnitIds) {
    throw new Error(
      "Workspace Worktree Unit mapping is required for cross-Unit references."
    );
  }
  return scope.kind === "worktree"
    ? {
        view: { kind: "worktree", worktreeId: scope.worktreeId },
        mappedUnitIds,
      }
    : {
        view: { kind: "mergePreview", worktreeId: scope.worktreeId },
        mappedUnitIds,
      };
}
