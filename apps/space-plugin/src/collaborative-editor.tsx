import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UserManagerService, LifecycleStages } from '@univerjs/core';
import { DocStateChangeManagerService } from '@univerjs/docs';
import { CommandType } from '@univerjs/core';
import { UniverDocsThreadCommentPreset } from '@univerjs/preset-docs-thread-comment';
import { UniverSheetsThreadCommentPreset } from '@univerjs/preset-sheets-thread-comment';
import docCommentLocale from '@univerjs/preset-docs-thread-comment/locales/zh-CN';
import sheetCommentLocale from '@univerjs/preset-sheets-thread-comment/locales/zh-CN';
import { UniverThreadCommentDataSourcePlugin } from '@univerjs-pro/thread-comment-datasource';
import { ThreadCommentPanelService } from '@univerjs/thread-comment-ui';
import { getDocThreadCommentCollaborationPlugins } from './workarounds/doc-thread-comment-delete.js';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import docsLocale from '@univerjs/preset-docs-core/locales/zh-CN';
import sheetsLocale from '@univerjs/preset-sheets-core/locales/zh-CN';
import { UniverCollaborationPlugin } from '@univerjs-pro/collaboration';
import {
  UniverCollaborationClientPlugin,
  CollaborationStatus,
  CollaborationUIEventService,
  CollaborationUIEventId,
  ILocalCacheService,
  CollaborationSessionService,
} from '@univerjs-pro/collaboration-client';
import {
  UniverCollaborationClientUIPlugin,
  BrowserCollaborationSocketService,
} from '@univerjs-pro/collaboration-client-ui';
import collabLocale from '@univerjs-pro/collaboration-client/locale/zh-CN';
import collabUILocale from '@univerjs-pro/collaboration-client-ui/locale/zh-CN';
import {
  UniverNetworkPlugin,
  IHTTPImplementation,
  HTTPService,
} from '@univerjs/network';
import { UnitObject } from '@univerjs/protocol';
import '@univerjs-pro/collaboration-client/facade';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import type { Content, State } from './model.js';
import type { Face } from './client.js';
import { editorHTTP } from './editor-http.js';
import { workspaceLicense } from './license.js';

let closingEditor: Promise<void> = Promise.resolve();

/** Formal, server-loaded trunk editor. Never uses the detached preview data. */
export function CollaborativeEditor({
  file,
  user,
  face,
  onCommentsReady,
}: {
  file: Content;
  user: State['status']['user'];
  face: Face;
  onCommentsReady(binding: { toggle(): void; visible: boolean } | null): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('loading'),
    [error, setError] = useState(''),
    [members, setMembers] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let canceled = false;
    let initialized = false;
    let disconnected = false;
    let recovering = false;
    let startup: Promise<void>;
    let runtime: ReturnType<typeof createUniver> | undefined;
    let transport: ReturnType<typeof editorHTTP> | undefined;
    const disposables: { dispose(): void }[] = [];
    const subscriptions: { unsubscribe(): void }[] = [];
    const abort = new AbortController();
    setStatus('loading');
    setError('');
    setMembers([]);
    setLoaded(false);
    const syncState = (state: CollaborationStatus) => {
      if (canceled || !initialized) return;
      if (state === CollaborationStatus.OFFLINE && !disconnected) {
        disconnected = true;
        runtime?.univer
          .__getInjector()
          .get(DocStateChangeManagerService)
          .flushPendingChanges(file.unitId);
      }
      // Resume with authoritative permissions and a fresh input surface, after
      // the SDK acknowledges its existing queue. This never writes a snapshot.
      if (disconnected && state === CollaborationStatus.SYNCED && !recovering) {
        recovering = true;
        setStatus('loading');
        setAttempt((value) => value + 1);
        return;
      }
      setStatus(
        state === CollaborationStatus.SYNCED
          ? runtime?.univer
              .__getInjector()
              .get(DocStateChangeManagerService)
              .getStateCache(file.unitId).collaboration.length
            ? 'saving'
            : 'saved'
          : state === CollaborationStatus.OFFLINE
            ? 'offline'
            : state === CollaborationStatus.CONFLICT
              ? 'conflict'
              : 'saving',
      );
    };
    const fail = (cause: unknown) => {
      if (!canceled) {
        setStatus('error');
        setError(
          cause instanceof Error ? cause.message : '无法打开协同编辑器。',
        );
      }
    };
    const mount = async () => {
      await closingEditor;
      if (canceled) return;
      if (!user?.id) throw new Error('请重新登录 Workspace。');
      const element = container.current!;
      element.id = `space-editor-${crypto.randomUUID()}`;
      transport = editorHTTP((input, signal) =>
        face.editorRequest(
          file,
          user.id!,
          input,
          AbortSignal.any([signal, abort.signal]),
        ),
      );
      const endpoint = file.endpoint,
        socketURL = new URL('/universer-api/comb/connect', endpoint);
      socketURL.protocol = socketURL.protocol === 'https:' ? 'wss:' : 'ws:';
      const corePreset =
        file.type === 'doc'
          ? UniverDocsCorePreset({ container: element, ribbonType: 'grid' })
          : UniverSheetsCorePreset({
              container: element,
              ribbonType: 'classic',
            });
      // Configure the Network plugin in its existing preset position. Registering
      // a separate preset first gets overwritten by the core preset's entry.
      corePreset.plugins = corePreset.plugins.map((entry) =>
        (Array.isArray(entry) ? entry[0] : entry) === UniverNetworkPlugin
          ? [
              UniverNetworkPlugin,
              { override: [[IHTTPImplementation, { useValue: transport }]] },
            ]
          : entry,
      );
      runtime = createUniver({
        locale: LocaleType.ZH_CN,
        collaboration: true,
        locales: {
          [LocaleType.ZH_CN]: mergeLocales(
            docsLocale,
            sheetsLocale,
            collabLocale,
            collabUILocale,
            docCommentLocale,
            sheetCommentLocale,
          ),
        },
        presets: [
          { plugins: [[UniverLicensePlugin, { license: workspaceLicense }]] },
          corePreset,
          file.type === 'doc' ? UniverDocsThreadCommentPreset() : UniverSheetsThreadCommentPreset(),
        ],
        plugins: [
          UniverCollaborationPlugin,
          [
            UniverCollaborationClientPlugin,
            {
              socketService: BrowserCollaborationSocketService,
              enableOfflineEditing: true,
              // Independent clients must not be locked out when they share a browser profile.
              enableSingleActiveInstanceLock: false,
              enableAuthServer: true,
              sendChangesetTimeout: 200,
              retryConnectingInterval: 1000,
              snapshotServerUrl: '/universer-api/snapshot',
              collabSubmitChangesetUrl: '/universer-api/comb',
              collabWebSocketUrl: socketURL.href,
              wsSessionTicketUrl: '/universer-api/user/session-ticket',
              authzUrl: '/universer-api/authz',
              objectPermissionTypes: [
                UnitObject.Worksheet,
                UnitObject.SelectRange,
                UnitObject.DocumentSection,
                UnitObject.DocumentParagraph,
                UnitObject.DocumentEntity,
              ],
            },
          ],
          [
            UniverCollaborationClientUIPlugin,
            { enableDocumentCollaborationUI: true, enableUrlUnitLoader: false },
          ],
          ...(file.type === 'doc' ? getDocThreadCommentCollaborationPlugins() : [UniverThreadCommentDataSourcePlugin]),
        ],
      });
      const { univer, univerAPI: api } = runtime;
      // Track the full public HTTP pipeline before the SDK's merge interceptor,
      // including auth requests waiting in its batching queue.
      const httpTracking = univer
        .__getInjector()
        .get(HTTPService)
        .registerHTTPInterceptor({
          priority: -100000,
          interceptor: transport.track,
        });
      subscriptions.push({ unsubscribe: () => httpTracking.dispose() });
      univer
        .__getInjector()
        .get(UserManagerService)
        .setCurrentUser({
          userID: user.id,
          name: user.displayName ?? user.username ?? user.id,
          avatar: '',
          anonymous: false,
          canBindAnonymous: false,
          phone: '',
          email: '',
          createTimestamp: 0,
        });
      subscriptions.push(
        univer
          .__getInjector()
          .get(CollaborationUIEventService)
          .event$.subscribe((event) => {
            if (canceled) return;
            if (event.id === CollaborationUIEventId.PERMISSION_DENIED) {
              setStatus('error');
              setError('Workspace 拒绝编辑权限，请检查权限后重新打开。');
            }
            if (event.id === CollaborationUIEventId.CONFLICT) {
              setStatus('conflict');
              setError('同步冲突。请保留此页并等待恢复。');
            }
          }),
      );
      const collaboration = api.getCollaboration();
      disposables.push(
        api.addEvent(api.Event.CollaborationStatusChanged, (event) => {
          if (event.unitId === file.unitId) syncState(event.status);
        }),
      );
      disposables.push(
        collaboration.subscribeCollaborators(file.unitId, (people) => {
          if (!canceled) setMembers(people.map((p) => p.name));
        }),
      );
      const docState = univer.__getInjector().get(DocStateChangeManagerService);
      const flush = async () => {
        await startup;
        docState.flushPendingChanges(file.unitId);
        await collaboration.flush(file.unitId, { timeout: 20000 });
      };
      disposables.push(
        api.addEvent(api.Event.CommandExecuted, (event) => {
          if (
            initialized &&
            !canceled &&
            event.type === CommandType.MUTATION &&
            event.params?.unitId === file.unitId &&
            !event.options?.fromCollab &&
            !event.options?.fromChangeset &&
            !event.options?.onlyLocal
          )
            setStatus('saving');
        }),
      );
      face.bindEditor(file.nodeId, {
        flush,
        isSaved: () =>
          !docState.getStateCache(file.unitId).collaboration.length &&
          initialized &&
          collaboration.getCollaborationStatus(file.unitId) ===
            CollaborationStatus.SYNCED,
      });
      const unit = await (file.type === 'doc'
        ? collaboration.loadDocAsync(file.unitId)
        : collaboration.loadSheetAsync(file.unitId));
      if (!unit) throw new Error('Server 未能加载此文件。');
      await univer
        .__getInjector()
        .get(CollaborationSessionService)
        .requireSession(file.unitId);
      await transport.drain();
      if (canceled) return;
      if (api.getCurrentLifecycleStage() < LifecycleStages.Rendered)
        await new Promise<void>((resolve) => {
          disposables.push(
            api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => {
              if (stage >= LifecycleStages.Rendered) resolve();
            }),
          );
        });
      if (canceled) return;
      api.setCurrent(file.unitId);
      const commentPanel = univer.__getInjector().get(ThreadCommentPanelService);
      subscriptions.push(commentPanel.panelVisible$.subscribe(visible => {
        if (!canceled) onCommentsReady({ visible, toggle: () => commentPanel.setPanelVisible(!commentPanel.panelVisible) });
      }));
      onCommentsReady({ visible: commentPanel.panelVisible, toggle: () => commentPanel.setPanelVisible(!commentPanel.panelVisible) });
      initialized = true;
      setLoaded(true);
      syncState(collaboration.getCollaborationStatus(file.unitId));
    };
    startup = mount();
    void startup.catch(fail);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        runtime &&
        (runtime.univerAPI
          .getCollaboration()
          .getCollaborationStatus(file.unitId) !== CollaborationStatus.SYNCED ||
          runtime.univer
            .__getInjector()
            .get(DocStateChangeManagerService)
            .getStateCache(file.unitId).collaboration.length > 0)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      canceled = true;
      onCommentsReady(null);
      face.bindEditor(file.nodeId, null);
      disposables.forEach((d) => d.dispose());
      const active = runtime;
      // Host panel changes can unmount us without using a Space navigation action.
      // Drain the SDK queue before destruction; preserve its user-scoped offline
      // cache on failure. New mounts await this barrier, so runtimes never overlap.
      if (active)
        closingEditor = (async () => {
          try {
            await startup;
            active.univer
              .__getInjector()
              .get(DocStateChangeManagerService)
              .flushPendingChanges(file.unitId);
            await active.univerAPI
              .getCollaboration()
              .flush(file.unitId, { timeout: 20000 });
          } catch {
            const cached = await active.univer
              .__getInjector()
              .get(ILocalCacheService)
              .exhaustSavingTask()
              .then(
                () => true,
                () => false,
              );
            face.update({
              error: cached
                ? '修改尚未同步。请保持同一 Workspace 账号并重新打开文件，从此浏览器的离线缓存恢复同步。'
                : '修改尚未同步，离线缓存也未能完成。请检查网络后重试。',
            });
          } finally {
            active.univerAPI.disposeUnit(file.unitId);
            await transport?.drain();
            abort.abort();
            window.removeEventListener('beforeunload', beforeUnload);
            subscriptions.forEach((s) => s.unsubscribe());
            active.univer.dispose();
          }
        })();
      else {
        abort.abort();
        window.removeEventListener('beforeunload', beforeUnload);
      }
    };
  }, [file.nodeId, user?.id, attempt]);
  useLayoutEffect(() => {
    // Suspend the actual input surface during a disconnect. The native inert
    // boundary prevents text/IME input before the SDK creates a local mutation.
    // Do not cancel a mutation after the SDK has already changed its input state.
    if (container.current) container.current.inert = status === 'offline';
  }, [status]);
  return (
    <div
      className="sp-viewer"
      data-editor-state={status}
      aria-label={`${file.type} collaborative editor`}
    >
      <div className="sp-editor-status" role="status">
        <span>
          {status === 'saved'
            ? 'Saved'
            : status === 'loading'
              ? '正在打开…'
              : status === 'offline'
                ? '连接已断开 · 正在重连，暂时无法编辑'
                : status === 'conflict'
                  ? '同步冲突'
                  : status === 'error'
                    ? '保存或加载失败'
                    : 'Saving…'}
        </span>
        {members.length > 0 && (
          <span aria-label="Online collaborators">{members.join(' · ')}</span>
        )}
      </div>
      <div className="sp-sdk" ref={container} />
      {status === 'loading' && (
        <div className="sp-viewer-message" role="status">
          <span className="sp-spinner" />
          正在加载编辑器…
        </div>
      )}
      {status === 'offline' && (
        <div
          className="sp-offline-blocker"
          role="status"
          tabIndex={0}
          onPointerDown={(event) => event.currentTarget.focus()}
          onKeyDown={(event) => {
            if (
              event.key.length === 1 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          连接已断开，恢复连接后可继续编辑。
        </div>
      )}
      {error && (
        <div className="sp-editor-error" role="alert">
          {error}
          {status === 'error' && !loaded && (
            <button onClick={() => setAttempt((n) => n + 1)}>重新连接</button>
          )}
        </div>
      )}
    </div>
  );
}
