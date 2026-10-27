import { WorkspaceCollaborationSocketService } from './collaboration-socket.js';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createUniver, LocaleType, mergeLocales, type IPreset, type IPresetPlugin } from '@univerjs/presets';
import { IRenderManagerService } from '@univerjs/engine-render';
import { DocSelectionRenderService } from '@univerjs/docs-ui';
import { UniverUIPlugin, ISidebarService } from '@univerjs/ui';
import { ShowCommentPanelOperation } from '@univerjs/preset-docs-thread-comment';
import { ToggleSheetCommentPanelOperation } from '@univerjs/preset-sheets-thread-comment';
import { UserManagerService, LifecycleStages } from '@univerjs/core';
import { DocStateChangeManagerService } from '@univerjs/docs';
import { CommandType } from '@univerjs/core';
import { UniverDocsDrawingPreset } from '@univerjs/preset-docs-drawing';
import docsDrawingLocale from '@univerjs/preset-docs-drawing/locales/zh-CN';
import sheetsDrawingLocale from '@univerjs/preset-sheets-drawing/locales/zh-CN';
import { UniverDocsThreadCommentPreset } from '@univerjs/preset-docs-thread-comment';
import docCommentLocale from '@univerjs/preset-docs-thread-comment/locales/zh-CN';
import sheetCommentLocale from '@univerjs/preset-sheets-thread-comment/locales/zh-CN';
import { UniverThreadCommentDataSourcePlugin } from '@univerjs-pro/thread-comment-datasource';
import { ThreadCommentPanelService } from '@univerjs/thread-comment-ui';
import { getDocThreadCommentCollaborationPlugins } from './workarounds/doc-thread-comment-delete.js';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import { createSheetEditorPresets, sheetEditorLocales } from '@univerjs/univer-workspace-editor-presets/sheets';
import { createSlideEditorPresets, slideEditorLocales } from '@univerjs/univer-workspace-editor-presets/slides';
import { createBoardEditorPresets, boardEditorLocales } from '@univerjs/univer-workspace-editor-presets/boards';
import { UniverBoardsThreadCommentUIPlugin, OpenBoardCommentPanelOperation } from '@univerjs-pro/boards-thread-comment-ui';
import { UniverBoardsHistoryUIPlugin } from '@univerjs-pro/boards-history-ui';
import boardHistoryLocale from '@univerjs-pro/boards-history-ui/locale/zh-CN';
import { UniverBoardsPrintPlugin } from '@univerjs-pro/boards-print';
import { redTheme } from '@univerjs/themes';

import { UniverSlidesThreadCommentUIPlugin, OpenSlideCommentPanelOperation } from '@univerjs-pro/slides-thread-comment-ui';
import { UniverSlidesHistoryUIPlugin } from '@univerjs-pro/slides-history-ui';
import slideHistoryLocale from '@univerjs-pro/slides-history-ui/locale/zh-CN';
import { UniverSlidesExchangeClientPlugin } from '@univerjs-pro/slides-exchange-client';
import { UniverSlidesPrintPlugin } from '@univerjs-pro/slides-print';
import { UniverExchangeClientPlugin } from '@univerjs-pro/exchange-client';
import { purpleTheme } from '@univerjs/themes';

import { UniverSheetsHistoryUIPlugin } from '@univerjs-pro/sheets-history-ui';
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
  MemberService,
} from '@univerjs-pro/collaboration-client';
import {
  UniverCollaborationClientUIPlugin,
} from '@univerjs-pro/collaboration-client-ui';
import collabLocale from '@univerjs-pro/collaboration-client/locale/zh-CN';
import collabUILocale from '@univerjs-pro/collaboration-client-ui/locale/zh-CN';
import {
  UniverNetworkPlugin,
  IHTTPImplementation,
  HTTPService,
} from '@univerjs/network';
import { subscribeWorkspaceCollaborators } from './workarounds/collaboration-members.js';
import { UnitObject, type IMember } from '@univerjs/protocol';
import '@univerjs-pro/collaboration-client/facade';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import type { Content, State } from './model.js';
import type { Face } from './client.js';
import { editorHTTP } from './editor-http.js';
import { installDocCommentRetention } from './workarounds/doc-comment-retention.js';
import { workspaceLicense } from './license.js';

let closingEditor: Promise<void> = Promise.resolve();

/** Formal, server-loaded trunk editor. Never uses the detached preview data. */
export function CollaborativeEditor({
  file,
  user,
  face,
  onCommentsReady,
  onCollaborators,
}: {
  file: Content;
  user: State['status']['user'];
  face: Face;
  onCollaborators(members: readonly IMember[]): void;
  onCommentsReady(binding: { toggle(): void; visible: boolean } | null): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('loading'),
    [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let canceled = false;
    let initialized = false;
    let disconnected = false;
    let recovering = false;
    let accessDenied = false;
    let lastMembers: readonly IMember[] = [];
    let accessCheckRunning = false;
    let startup: Promise<void>;
    let runtime: ReturnType<typeof createUniver> | undefined;
    let transport: ReturnType<typeof editorHTTP> | undefined;
    const disposables: { dispose(): void }[] = [];
    const subscriptions: { unsubscribe(): void }[] = [];
    const abort = new AbortController();
    setStatus('loading');
    setError('');
    onCollaborators([]);
    setLoaded(false);
    const syncState = (state: CollaborationStatus) => {
      if (canceled || !initialized || accessDenied) return;
      onCollaborators(state === CollaborationStatus.OFFLINE ? [] : lastMembers);
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
      const collaborationConfig = {
        socketService: WorkspaceCollaborationSocketService,
        enableOfflineEditing: true,
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
          UnitObject.SlidePage, UnitObject.SlideElement, UnitObject.SlideMaster,
          UnitObject.BoardElement, UnitObject.BaseTable, UnitObject.BaseField,
          UnitObject.BaseRecord, UnitObject.BaseView, UnitObject.BaseDashboard,
        ],
      };
      const editorPresets: IPreset[] = file.type === 'doc'
        ? [UniverDocsCorePreset({ container: element, ribbonType: 'grid' }),
            UniverDocsDrawingPreset({ collaboration: true }), UniverDocsThreadCommentPreset()]
        : file.type === 'sheet'
          ? createSheetEditorPresets({ container: element, license: workspaceLicense, universerEndpoint: endpoint })
          : file.type === 'slide' ? createSlideEditorPresets(element)
            : file.type === 'board' ? createBoardEditorPresets(element) : [];
      // Preserve Browser's original plugin order, replacing only the Host transport
      // and credential-bound collaboration endpoints at their existing positions.
      const presets: IPreset[] = editorPresets.map((preset) => ({ ...preset, plugins: preset.plugins.map((entry): IPresetPlugin => {
        const plugin = Array.isArray(entry) ? entry[0] : entry;
        const config = Array.isArray(entry) ? entry[1] : {};
        if (plugin === UniverNetworkPlugin) return [UniverNetworkPlugin, { ...config, override: [[IHTTPImplementation, { useValue: transport }]] }];
        if (plugin === UniverCollaborationClientPlugin) return [UniverCollaborationClientPlugin, { ...config, ...collaborationConfig }];
        if (plugin === UniverCollaborationClientUIPlugin) return [UniverCollaborationClientUIPlugin, { ...config, enableDocumentCollaborationUI: true, enableUrlUnitLoader: false }];
        if (plugin === UniverSheetsHistoryUIPlugin) return [UniverSheetsHistoryUIPlugin, { ...config, historyServerUrl: '/universer-api/history', univerContainerId: element.id }];
        if (plugin === UniverUIPlugin) return [UniverUIPlugin, { ...config,
          avatarFallback: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="16" fill="#ededed"/><circle cx="16" cy="12" r="5" fill="#888"/><path d="M6 29a10 10 0 0 1 20 0" fill="#888"/></svg>'),
        }];
        return entry;
      }) }));
      const collaborationPlugins: IPresetPlugin[] = file.type === 'sheet'
        ? [UniverThreadCommentDataSourcePlugin]
        : [UniverCollaborationPlugin,
            [UniverCollaborationClientPlugin, collaborationConfig],
            [UniverCollaborationClientUIPlugin, { enableDocumentCollaborationUI: true, enableUrlUnitLoader: false }],
            ...(file.type === 'doc' ? getDocThreadCommentCollaborationPlugins()
              : file.type === 'board' ? [UniverBoardsThreadCommentUIPlugin, UniverThreadCommentDataSourcePlugin,
                  [UniverBoardsHistoryUIPlugin, { historyServerUrl: '/universer-api/history', univerContainerId: element.id }],
                  UniverBoardsPrintPlugin] as IPresetPlugin[]
                : [UniverSlidesThreadCommentUIPlugin, UniverThreadCommentDataSourcePlugin,
                    [UniverSlidesHistoryUIPlugin, { historyServerUrl: '/universer-api/history', univerContainerId: element.id }],
                    [UniverExchangeClientPlugin, {
                      uploadFileServerUrl: '/universer-api/stream/file/upload',
                      getTaskServerUrl: '/universer-api/exchange/task/{taskID}',
                      signUrlServerUrl: '/universer-api/file/{fileID}/sign-url',
                      importServerUrl: '/universer-api/exchange/{type}/import',
                      exportServerUrl: '/universer-api/exchange/{type}/export', downloadEndpointUrl: '/',
                    }], UniverSlidesExchangeClientPlugin, UniverSlidesPrintPlugin] as IPresetPlugin[]),
          ];
      const licensePreset: IPreset = { plugins: [[UniverLicensePlugin, { license: workspaceLicense }]] };
      runtime = createUniver({
        locale: LocaleType.ZH_CN,
        collaboration: true,
        ...(file.type === 'slide' ? { theme: purpleTheme } : file.type === 'board' ? { theme: redTheme } : {}),
        locales: {
          [LocaleType.ZH_CN]: mergeLocales(
            docsLocale,
            sheetsLocale,
            sheetEditorLocales['zh-CN'],
            ...(file.type === 'slide' ? [slideEditorLocales['zh-CN'], slideHistoryLocale] : file.type === 'board' ? [boardEditorLocales['zh-CN'], boardHistoryLocale] : []),
            collabLocale,
            collabUILocale,
            docCommentLocale,
            docsDrawingLocale,
            sheetsDrawingLocale,
            sheetCommentLocale,
          ),
        },
        presets: [
          ...(file.type !== 'sheet' ? [licensePreset] : []),
          ...(['slide', 'board'].includes(file.type) ? [{ plugins: [[UniverNetworkPlugin, { override: [[IHTTPImplementation, { useValue: transport }]] }]] } as IPreset] : []),
          ...presets,
        ],
        plugins: collaborationPlugins,
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
          avatar: user.avatarUrl ?? '',
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
              accessDenied = true;
              setStatus('denied');
              setError(
                'Workspace 拒绝编辑权限。请重新打开文件以检查当前访问权限。',
              );
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
      const docState = univer.__getInjector().get(DocStateChangeManagerService);
      const flush = async () => {
        await startup;
        await transport!.drain();
        docState.flushPendingChanges(file.unitId);
        await collaboration.flush(file.unitId, { timeout: 20000 });
        // A committed Comment body can schedule its anchor mutation afterwards.
        await transport!.drain();
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
          transport!.isIdle() &&
          collaboration.getCollaborationStatus(file.unitId) ===
            CollaborationStatus.SYNCED,
      });
      const unit = await (file.type === 'doc'
        ? collaboration.loadDocAsync(file.unitId)
        : file.type === 'sheet' ? collaboration.loadSheetAsync(file.unitId)
          : file.type === 'slide' ? collaboration.loadSlideAsync(file.unitId)
            : file.type === 'board' ? collaboration.loadBoardAsync(file.unitId)
              : Promise.reject(new Error('Unsupported collaborative editor.')));
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
      disposables.push(
        subscribeWorkspaceCollaborators(
          univer.__getInjector().get(MemberService),
          file.unitId,
          (people) => {
            lastMembers = people;
            if (!canceled)
              onCollaborators(
                collaboration.getCollaborationStatus(file.unitId) ===
                  CollaborationStatus.OFFLINE || accessDenied
                  ? []
                  : people,
              );
          },
        ),
      );
      // Product ACL writes are outside the collaboration document. Recheck the
      // authoritative Resource capability on focus and at a bounded interval.
      const checkAccess = async () => {
        if (canceled || accessCheckRunning || accessDenied) return;
        accessCheckRunning = true;
        try {
          const metadata = await face.metadata(file.nodeId);
          if (
            !canceled &&
            metadata.node.resource?.capabilities.editContent !==
              file.node?.resource?.capabilities.editContent
          ) {
            accessDenied = true;
            setStatus('denied');
            setError('文件权限已更改。请重新打开文件以使用当前权限。');
          }
        } catch (cause) {
          if (
            !canceled &&
            cause instanceof Error &&
            /not found|forbidden|access denied|permission/i.test(cause.message)
          ) {
            accessDenied = true;
            onCollaborators([]);
            setStatus('denied');
            setError('你已无权访问此文件。请联系 Space 所有者。');
          }
        } finally {
          accessCheckRunning = false;
        }
      };
      const timer = window.setInterval(() => {
        void checkAccess();
      }, 5000);
      window.addEventListener('focus', checkAccess);
      disposables.push({
        dispose() {
          clearInterval(timer);
          window.removeEventListener('focus', checkAccess);
        },
      });
      const retention =
        file.type === 'doc'
          ? installDocCommentRetention(univer.__getInjector(), file.unitId)
          : undefined;
      if (retention) {
        disposables.push(retention);
        await retention.refresh();
      }
      const commentPanel = univer
        .__getInjector()
        .get(ThreadCommentPanelService);
      const toggleComments = () => {
        if (!commentPanel.panelVisible)
          void retention?.refresh().catch((cause) => setError(cause.message));
        if (file.type === 'sheet') {
          void api.executeCommand(ToggleSheetCommentPanelOperation.id);
        } else if (file.type === 'slide' && !commentPanel.panelVisible) {
          void api.executeCommand(OpenSlideCommentPanelOperation.id);
        } else if (file.type === 'board' && !commentPanel.panelVisible) {
          void api.executeCommand(OpenBoardCommentPanelOperation.id);
        } else if (commentPanel.panelVisible) {
          univer.__getInjector().get(ISidebarService).close();
          commentPanel.setPanelVisible(false);
        } else {
          api.setCurrent(file.unitId);
          void api.executeCommand(ShowCommentPanelOperation.id);
        }
      };
      let commentsWereVisible = commentPanel.panelVisible;
      subscriptions.push(
        commentPanel.panelVisible$.subscribe((visible) => {
          if (canceled) return;
          if (!visible && commentsWereVisible && file.type === 'doc') {
            // RichTextEditor uses its own internal Doc and reserves the host
            // range. Restore the existing document input when the panel closes.
            api.setCurrent(file.unitId);
            const selection = univer
              .__getInjector()
              .get(IRenderManagerService)
              .getRenderUnitById(file.unitId)
              ?.with(DocSelectionRenderService);
            selection?.setReserveRangesStatus(false);
            queueMicrotask(() => {
              if (!canceled && !commentPanel.panelVisible) selection?.focus();
            });
          }
          commentsWereVisible = visible;
          onCommentsReady({ visible, toggle: toggleComments });
        }),
      );
      onCommentsReady({
        visible: commentPanel.panelVisible,
        toggle: toggleComments,
      });
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
      onCollaborators([]);
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
    if (container.current)
      container.current.inert = status === 'offline' || status === 'denied';
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
                  : status === 'denied'
                    ? '访问权限已更改'
                    : status === 'error'
                      ? '保存或加载失败'
                      : 'Saving…'}
        </span>
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
