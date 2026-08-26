/**
 * The viewer's collaboration-editor core, adapted from the Workspace Browser
 * editor for the DSH client: mounts a Univer instance with collaboration
 * presets and routes every collaboration URL through the same-origin proxy.
 * @module dsh-univer-workspace-plugin/client/collaboration-viewer
 */

import { useEffect, useRef, useState } from "react";
import {
  createUniver,
  mergeLocales,
  type FUniver,
  type IPreset,
  type IPresetPlugin,
} from "@univerjs/presets";
import {
  CommandType,
  LifecycleStages,
  LocaleType,
  LogLevel,
  UserManagerService,
  type ILanguagePack,
} from "@univerjs/core";
import type { IUser } from "@univerjs/protocol";
import type { Theme } from "@univerjs/themes";
import { UniverLicensePlugin } from "@univerjs-pro/license";
import { UniverCollaborationPlugin } from "@univerjs-pro/collaboration";
import {
  UniverCollaborationClientPlugin,
  type IUniverCollaborationClientConfig,
} from "@univerjs-pro/collaboration-client";
import {
  BrowserCollaborationSocketService,
  UniverCollaborationClientUIPlugin,
} from "@univerjs-pro/collaboration-client-ui";
import { UniverEmbedPlugin } from "@univerjs-pro/embed";
import { UniverEmbedUIPlugin } from "@univerjs-pro/embed-ui";

/** The proxy prefix the host-side collab-proxy serves. */
const PROXY_PREFIX = "/univer-workspace/collab";

/** The fixed proxy WebSocket connect path. */
const PROXY_WS_CONNECT = `${PROXY_PREFIX}/connect`;

function proxied(path: string): string {
  return `${PROXY_PREFIX}${path}`;
}

function proxiedWebSocket(workspacePath: string): string {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${window.location.host}${PROXY_WS_CONNECT}?target=${encodeURIComponent(workspacePath)}`;
}

export interface ViewerDefinition {
  readonly label: string;
  readonly theme: Theme;
  readonly locales: Readonly<Record<"zh-CN" | "en-US", ILanguagePack>>;
  readonly createPresets: (container: HTMLElement, license: string) => IPreset[];
  readonly load: (univerAPI: FUniver, unitId: string) => Promise<unknown | null>;
}

export interface CollaborationViewerProps {
  readonly unitId: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
  readonly readOnly: boolean;
  readonly user: { readonly id: string; readonly displayName: string; readonly avatarUrl: string | null };
  readonly license: string;
  readonly locale: "zh-CN" | "en-US";
  readonly definition: ViewerDefinition;
}

function viewerCollaborationConfig(readOnly: boolean): Partial<IUniverCollaborationClientConfig> {
  return {
    socketService: BrowserCollaborationSocketService,
    enableOfflineEditing: true,
    enableAuthServer: true,
    wsSessionTicketUrl: proxied("/universer-api/user/session-ticket"),
    authzUrl: proxied("/universer-api/authz"),
    snapshotServerUrl: proxied("/universer-api/snapshot"),
    collabSubmitChangesetUrl: proxied("/universer-api/comb"),
    collabWebSocketUrl: proxiedWebSocket("/universer-api/comb/connect"),
    uploadFileServerUrl: proxied("/universer-api/stream/file/upload"),
    signUrlServerUrl: proxied("/universer-api/file/{fileID}/sign-url"),
    sendChangesetTimeout: 200,
    enableCollaboration: !readOnly,
  };
}

/** The collaboration editor for the DSH client viewer. */
export function CollaborationViewer({
  unitId,
  readOnly,
  user,
  license,
  locale,
  definition,
}: CollaborationViewerProps) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    element.id = `uws-viewer-${definition.label}-${unitId}`;
    let disposed = false;
    let mounted: ReturnType<typeof createUniver>["univer"] | null = null;
    let readOnlyListener: { dispose(): void } | null = null;

    const mount = async () => {
      const univerLocale = locale === "zh-CN" ? LocaleType.ZH_CN : LocaleType.EN_US;
      const licensePlugins: IPresetPlugin[] = [[UniverLicensePlugin, { license }]];
      const presets = [{ plugins: licensePlugins }, ...definition.createPresets(element, license)];
      const { univer, univerAPI } = createUniver({
        locale: univerLocale,
        locales: { [univerLocale]: mergeLocales(definition.locales[locale]) },
        theme: definition.theme,
        logLevel: LogLevel.WARN,
        collaboration: true,
        presets,
        plugins: [
          UniverCollaborationPlugin,
          [UniverCollaborationClientPlugin, viewerCollaborationConfig(readOnly)],
          [UniverCollaborationClientUIPlugin, { enableDocumentCollaborationUI: false }],
          UniverEmbedPlugin,
          UniverEmbedUIPlugin,
        ],
      });
      mounted = univer;

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
      univer.__getInjector().get(UserManagerService).setCurrentUser(protocolUser);

      if (readOnly) {
        const installReadOnlyGuard = (): void => {
          if (disposed || readOnlyListener) return;
          readOnlyListener = univerAPI.addEvent(
            univerAPI.Event.BeforeCommandExecute,
            (event) => {
              const command = event as {
                readonly type: CommandType;
                readonly options?: { readonly fromCollab?: boolean; readonly fromChangeset?: boolean };
                cancel: boolean;
              };
              if (
                command.type === CommandType.MUTATION &&
                !command.options?.fromCollab &&
                !command.options?.fromChangeset
              ) {
                command.cancel = true;
              }
            },
          );
        };
        if (univerAPI.getCurrentLifecycleStage() >= LifecycleStages.Steady) {
          installReadOnlyGuard();
        } else {
          const listener = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
            if (stage < LifecycleStages.Steady) return;
            listener.dispose();
            installReadOnlyGuard();
          });
        }
      }

      await definition.load(univerAPI, unitId);
    };

    mount().catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      disposed = true;
      readOnlyListener?.dispose();
      mounted?.dispose();
    };
  }, [unitId, readOnly, user.id, user.displayName, user.avatarUrl, license, locale, definition]);

  return (
    <div className="uws-viewer-editor">
      {error !== null ? <div className="uws-viewer-error">{error}</div> : null}
      <div ref={container} className="uws-viewer-container" />
    </div>
  );
}
