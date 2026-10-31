import { WorkspaceCollaborationSocketService } from './collaboration-socket.js';
import React, { useEffect, useRef, useState } from 'react';
import { createUniver, LocaleType, mergeLocales, type IPreset, type IPresetPlugin } from '@univerjs/presets';
import { IRenderManagerService } from '@univerjs/engine-render';
import { DocSelectionRenderService } from '@univerjs/docs-ui';
import { UniverUIPlugin, ISidebarService } from '@univerjs/ui';
import { ShowCommentPanelOperation } from '@univerjs/preset-docs-thread-comment';
import { ToggleSheetCommentPanelOperation } from '@univerjs/preset-sheets-thread-comment';
import { UserManagerService, LifecycleStages, type UniverInstanceType } from '@univerjs/core';
import { DocStateChangeManagerService, DocSelectionManagerService } from '@univerjs/docs';
import { CommandType } from '@univerjs/core';
import docsDrawingLocale from '@univerjs/preset-docs-drawing/locales/zh-CN';
import sheetsDrawingLocale from '@univerjs/preset-sheets-drawing/locales/zh-CN';
import docCommentLocale from '@univerjs/preset-docs-thread-comment/locales/zh-CN';
import sheetCommentLocale from '@univerjs/preset-sheets-thread-comment/locales/zh-CN';
import { UniverThreadCommentDataSourcePlugin } from '@univerjs-pro/thread-comment-datasource';
import { ThreadCommentPanelService } from '@univerjs/thread-comment-ui';
import { getDocThreadCommentCollaborationPlugins } from './workarounds/doc-thread-comment-delete.js';
import { createSheetEditorPresets, sheetEditorLocales } from '@univerjs/univer-workspace-editor-presets/sheets';
import { createDocEditorPresets, docEditorLocales } from '@univerjs/univer-workspace-editor-presets/docs';
import { UniverDocsHistoryUIPlugin } from '@univerjs-pro/docs-history-ui';
import docHistoryLocale from '@univerjs-pro/docs-history-ui/locale/zh-CN';
import { UniverDocsExchangeClientPlugin } from '@univerjs-pro/docs-exchange-client';
import { UniverDocsPrintPlugin } from '@univerjs-pro/docs-print';

import { createSlideEditorPresets, slideEditorLocales } from '@univerjs/univer-workspace-editor-presets/slides';
import { createBoardEditorPresets, boardEditorLocales } from '@univerjs/univer-workspace-editor-presets/boards';
import { createBaseEditorPresets, baseEditorLocales } from '@univerjs/univer-workspace-editor-presets/bases';
import { UniverBasesThreadCommentUIPlugin } from '@univerjs-pro/bases-thread-comment-ui';
import { UniverBasesHistoryUIPlugin } from '@univerjs-pro/bases-history-ui';
import baseHistoryLocale from '@univerjs-pro/bases-history-ui/locale/zh-CN';
import { UniverBasesExchangeClientPlugin } from '@univerjs-pro/bases-exchange-client';
import { yellowTheme } from '@univerjs/themes';

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
import { SnapshotService, UniverCollaborationPlugin } from '@univerjs-pro/collaboration';
import { UniverEmbedPlugin } from '@univerjs-pro/embed';
import { UniverEmbedUIPlugin } from '@univerjs-pro/embed-ui';
import embedLocale from '@univerjs-pro/embed-ui/locale/zh-CN';
import { UniverChartEmbedPlugin } from '@univerjs-pro/chart-embed';
import { createWorkspaceReferencedUnitProviderRegistration, withLiveSheetReferences } from '@univerjs/univer-workspace-reference-provider';
import { createEmbedProductRuntime } from '@univerjs/univer-workspace-editor-presets/embed-product-runtime';
import { isReferencedSourceBlockedMutation } from '@univerjs/univer-workspace-editor-presets/read-only-guard';
import '@univerjs-pro/embed/facade';
import {
  UniverCollaborationClientPlugin,
  CollaborationStatus,
  CollaborationController,
  CollaborationUIEventService,
  CollaborationUIEventId,
  ILocalCacheService,
  CollaborationSessionService,
  SessionStatus,
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
import type { OpenFile, State } from './model.js';
import type { Face } from './client.js';
import { editorHTTP } from './editor-http.js';
import { installDocCommentRetention } from './workarounds/doc-comment-retention.js';
import { workspaceLicense } from './license.js';
import { captureDocTarget } from './doc-focus.js';
import { SelectionEditing } from './selection-editing.js';
import { SelectionEditingNotice } from './components/selection-editing.js';
import { disposeEditorResources } from './editor-lifecycle.js';
import { EditorInputGate } from './editor-input-gate.js';

let closingEditor: Promise<void> = Promise.resolve();

/** Formal, server-loaded trunk editor. Never uses the detached preview data. */
export function CollaborativeEditor({
  file,
  user,
  face,
  onCommentsReady,
  onCollaborators,
}: {
  file: OpenFile;
  user: State['status']['user'];
  face: Face;
  onCollaborators(members: readonly IMember[]): void;
  onCommentsReady(binding: { toggle(): void; visible: boolean } | null): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [selectionEditing, setSelectionEditing] = useState<SelectionEditing | null>(null);
  const loadId = face.store.getSnapshot().contentLoadId;
  const [status, setStatus] = useState('loading'),
    [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const inputGate = new EditorInputGate(container.current!);
    let releaseEditor = () => {};
    let canceled = false;
    let initialized = false;
    let cancelingLoad = false;
    let disconnected = false;
    let hasBeenSynced = false;
    let sessionStatus = SessionStatus.IDLE;
    let locallyChanged = false;
    let recovering = false;
    let accessDenied = false;
    let lastMembers: readonly IMember[] = [];
    let accessCheckRunning = false;
    let startup: Promise<void>;
    let runtime: ReturnType<typeof createUniver> | undefined;
    let focusChannel = '';
    let selectionEditingBinding: SelectionEditing | undefined;
    let transport: ReturnType<typeof editorHTTP> | undefined;
    let docState: DocStateChangeManagerService | undefined;
    let editorWorker: Worker | undefined;
    let embedProducts: ReturnType<typeof createEmbedProductRuntime> | undefined;
    const referencedUnitIds = new Set<string>();
    const disposables: { dispose(): void }[] = [];
    const subscriptions: { unsubscribe(): void }[] = [];
    const abort = new AbortController();
    const matchesView = () => {
      const current = face.store.getSnapshot();
      return !current.opening && current.content?.nodeId === file.nodeId && current.contentLoadId === loadId;
    };
    const ownsView = () => !canceled && !abort.signal.aborted && matchesView();
    const publishStatus = (value: string) => {
      if (!ownsView()) return;
      inputGate.setConnectionBlocked(value === 'loading' || value === 'offline' || value === 'denied');
      setStatus(value);
    };
    const publishError = (value: string) => { if (ownsView()) setError(value); };
    const publishLoaded = (value: boolean) => { if (ownsView()) setLoaded(value); };
    const publishMembers = (value: readonly IMember[]) => { if (ownsView()) onCollaborators(value); };
    const publishComments = (value: { toggle(): void; visible: boolean } | null) => { if (ownsView()) onCommentsReady(value); };
    publishStatus('loading');
    publishError('');
    publishMembers([]);
    publishLoaded(false);
    const syncState = (state: CollaborationStatus) => {
      if (canceled || !initialized || accessDenied) return;
      const synced = state === CollaborationStatus.SYNCED && sessionStatus === SessionStatus.ONLINE;
      const offline = sessionStatus === SessionStatus.OFFLINE || disconnected && !synced;
      if (synced) { hasBeenSynced = true; locallyChanged = false; }
      if (!ownsView()) return;
      publishMembers(sessionStatus === SessionStatus.ONLINE ? lastMembers : []);
      if (offline && hasBeenSynced && !disconnected) {
        disconnected = true;
        docState?.flushPendingChanges(file.unitId);
      }
      // Resume with authoritative permissions and a fresh input surface, after
      // the SDK acknowledges its existing queue. This never writes a snapshot.
      if (disconnected && synced && !recovering) {
        recovering = true;
        publishStatus('loading');
        if (ownsView()) setAttempt((value) => value + 1);
        return;
      }
      let next = 'saving';
      if (offline) next = 'offline';
      else if (state === CollaborationStatus.CONFLICT) next = 'conflict';
      else if (synced) next = (docState?.getStateCache(file.unitId).collaboration.length ?? 0) ? 'saving' : 'saved';
      else if (!hasBeenSynced) next = 'loading';
      publishStatus(next);
    };
    const fail = (cause: unknown) => {
      if (!canceled) {
        publishStatus('error');
        publishError(
          cause instanceof Error ? cause.message : '无法打开协同编辑器。',
        );
      }
    };
    const needsFlush = async () => {
      if (locallyChanged || (docState?.getStateCache(file.unitId).collaboration.length ?? 0) > 0) return true;
      if (hasBeenSynced) return false;
      // An initially offline document may have an older queued edit. Check the
      // SDK's durable cache before allowing a clean, never-connected view to close.
      if (!runtime) return true;
      const cache = runtime.univer.__getInjector().get(ILocalCacheService);
      await cache.exhaustSavingTask();
      const saved = await cache.loadOfflineData(file.unitId, user?.id);
      return !!saved?.awaitingChangeset || !!saved?.mutations.length;
    };
    const mount = async () => {
      await closingEditor;
      if (canceled || abort.signal.aborted) return;
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
        (input, signal) => face.editorUpload(file, user.id!, input, AbortSignal.any([signal, abort.signal])),
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
        uploadFileServerUrl: '/universer-api/stream/file/upload',
        signUrlServerUrl: '/universer-api/file/{fileID}/sign-url',
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
      if (file.type === 'base') editorWorker = new Worker('/api/space/base-worker', { type: 'module' });
      const editorPresets: IPreset[] = file.type === 'doc'
        ? createDocEditorPresets(element)
        : file.type === 'sheet'
          ? createSheetEditorPresets({ container: element, license: workspaceLicense, universerEndpoint: endpoint })
          : file.type === 'slide' ? createSlideEditorPresets(element)
            : file.type === 'board' ? createBoardEditorPresets(element)
              : file.type === 'base' ? createBaseEditorPresets(element, editorWorker!) : [];
      // Preserve Browser's original plugin order, replacing only the Host transport
      // and credential-bound collaboration endpoints at their existing positions.
      const presets: IPreset[] = editorPresets.map((preset) => ({ ...preset, plugins: preset.plugins.map((entry): IPresetPlugin => {
        const plugin = Array.isArray(entry) ? entry[0] : entry;
        const config = Array.isArray(entry) ? entry[1] : {};
        if (plugin === UniverNetworkPlugin) return [UniverNetworkPlugin, { ...config, override: [[IHTTPImplementation, { useValue: transport }]] }];
        if (plugin === UniverCollaborationClientPlugin) return [UniverCollaborationClientPlugin, { ...config, ...collaborationConfig }];
        if (plugin === UniverCollaborationClientUIPlugin) return [UniverCollaborationClientUIPlugin, { ...config, enableDocumentCollaborationUI: true, enableUrlUnitLoader: false }];
        if (plugin === UniverExchangeClientPlugin) return [UniverExchangeClientPlugin, { ...config,
          uploadFileServerUrl: '/universer-api/stream/file/upload', getTaskServerUrl: '/universer-api/exchange/task/{taskID}',
          signUrlServerUrl: '/universer-api/file/{fileID}/sign-url', importServerUrl: '/universer-api/exchange/{type}/import',
          exportServerUrl: '/universer-api/exchange/{type}/export', downloadEndpointUrl: '/',
        }];
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
            ...(file.type === 'doc' ? [...getDocThreadCommentCollaborationPlugins(),
                  [UniverDocsHistoryUIPlugin, { historyServerUrl: '/universer-api/history', univerContainerId: element.id }],
                  [UniverExchangeClientPlugin, {
                    uploadFileServerUrl: '/universer-api/stream/file/upload',
                    getTaskServerUrl: '/universer-api/exchange/task/{taskID}',
                    signUrlServerUrl: '/universer-api/file/{fileID}/sign-url',
                    importServerUrl: '/universer-api/exchange/{type}/import',
                    exportServerUrl: '/universer-api/exchange/{type}/export', downloadEndpointUrl: '/',
                  }], UniverDocsExchangeClientPlugin, UniverDocsPrintPlugin] as IPresetPlugin[]
              : file.type === 'board' ? [UniverBoardsThreadCommentUIPlugin, UniverThreadCommentDataSourcePlugin,
                  [UniverBoardsHistoryUIPlugin, { historyServerUrl: '/universer-api/history', univerContainerId: element.id }],
                  UniverBoardsPrintPlugin] as IPresetPlugin[]
                : file.type === 'base' ? [UniverBasesThreadCommentUIPlugin, UniverThreadCommentDataSourcePlugin,
                    [UniverBasesHistoryUIPlugin, { historyServerUrl: '/universer-api/history', univerContainerId: element.id }],
                    [UniverExchangeClientPlugin, {
                      uploadFileServerUrl: '/universer-api/stream/file/upload',
                      getTaskServerUrl: '/universer-api/exchange/task/{taskID}',
                      signUrlServerUrl: '/universer-api/file/{fileID}/sign-url',
                      importServerUrl: '/universer-api/exchange/{type}/import',
                      exportServerUrl: '/universer-api/exchange/{type}/export', downloadEndpointUrl: '/',
                    }], UniverBasesExchangeClientPlugin] as IPresetPlugin[]
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
      const referenceHost = { view: { kind: 'trunk' as const } };
      const snapshotReferences = createWorkspaceReferencedUnitProviderRegistration({
        hostContext: referenceHost,
        prepareUnit: async (unitType: UniverInstanceType) => {
          if (!embedProducts) throw new Error('The embed runtime is not ready.');
          await embedProducts.ensure(unitType);
        },
        resolveSnapshotService: () => {
          if (!runtime) throw new Error('Workspace SnapshotService is not ready.');
          return runtime.univer.__getInjector().get(SnapshotService);
        },
      });
      const preparedReferences = { ...snapshotReferences, provider: {
        async ensureUnit(input: Parameters<typeof snapshotReferences.provider.ensureUnit>[0]) {
          const result = await snapshotReferences.provider.ensureUnit(input);
          if (result.unitId !== file.unitId) referencedUnitIds.add(result.unitId);
          return result;
        },
      } };
      const referenceProvider = file.type === 'doc' || file.type === 'slide'
        ? withLiveSheetReferences(preparedReferences, referenceHost, async sourceUnitId => {
            if (canceled || !runtime) throw new Error('Editor was disposed.');
            if (sourceUnitId !== file.unitId) await runtime.univer.__getInjector().get(CollaborationController).readyForCollab(sourceUnitId);
          })
        : preparedReferences;
      const embedPlugins: IPresetPlugin[] = [
        [UniverEmbedPlugin, { resourceRefUnitProviderRegistrations: [referenceProvider] }],
        UniverEmbedUIPlugin, UniverChartEmbedPlugin,
      ];
      const runtimePresets: IPreset[] = [
        ...(file.type !== 'sheet' ? [licensePreset] : []),
        ...(['slide', 'board', 'base'].includes(file.type) ? [{ plugins: [[UniverNetworkPlugin, { override: [[IHTTPImplementation, { useValue: transport }]] }]] } as IPreset] : []),
        ...presets,
      ];
      runtime = createUniver({
        locale: LocaleType.ZH_CN,
        collaboration: true,
        ...(file.type === 'slide' ? { theme: purpleTheme } : file.type === 'board' ? { theme: redTheme } : file.type === 'base' ? { theme: yellowTheme } : {}),
        locales: {
          [LocaleType.ZH_CN]: mergeLocales(
            docsLocale,
            ...(file.type === 'doc' ? [docEditorLocales['zh-CN'], docHistoryLocale] : []),
            sheetsLocale,
            sheetEditorLocales['zh-CN'],
            ...(file.type === 'slide' ? [slideEditorLocales['zh-CN'], slideHistoryLocale] : file.type === 'board' ? [boardEditorLocales['zh-CN'], boardHistoryLocale] : file.type === 'base' ? [baseEditorLocales['zh-CN'], baseHistoryLocale] : []),
            collabLocale,
            collabUILocale,
            embedLocale,
            docCommentLocale,
            docsDrawingLocale,
            sheetsDrawingLocale,
            sheetCommentLocale,
          ),
        },
        presets: runtimePresets,
        plugins: [...collaborationPlugins, ...embedPlugins],
      });
      const { univer, univerAPI: api } = runtime;
      focusChannel = crypto.randomUUID();
      const selectionService = file.type === 'doc'
        ? univer.__getInjector().get(DocSelectionManagerService)
        : undefined;
      const publishDocFocus = () => {
        if (!selectionService || canceled || abort.signal.aborted) return;
        const current = selectionService.__getCurrentSelection();
        const info = current?.unitId === file.unitId && current.subUnitId === file.unitId
          ? selectionService.getSelectionInfo(current) : undefined;
        const target = info ? captureDocTarget(api.getDocument(file.unitId)!, info.textRanges, !!info.rectRanges.length) : null;
        face.updateDocFocus(target ? { ...target, id: crypto.randomUUID(), channel: focusChannel, nodeId: file.nodeId, resourceId: file.resourceId, unitId: file.unitId } : null);
      };
      if (selectionService) {
        const focusSubscription = selectionService.textSelection$.subscribe(publishDocFocus);
        subscriptions.push({ unsubscribe: () => focusSubscription.unsubscribe() });
      }
      embedProducts = createEmbedProductRuntime({
        univer, container: element, license: workspaceLicense,
        plugins: [...runtimePresets.flatMap(preset => preset.plugins), ...collaborationPlugins, ...embedPlugins],
        createBaseWorker: () => new Worker('/api/space/base-worker', { type: 'module' }),
      });
      disposables.push(api.addEvent(api.Event.BeforeCommandExecute, event => {
        if (isReferencedSourceBlockedMutation(event, referencedUnitIds)) event.cancel = true;
      }));
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
            if (!ownsView() || event.unitID && event.unitID !== file.unitId) return;
            if (event.id === CollaborationUIEventId.PERMISSION_DENIED) {
              accessDenied = true;
              publishStatus('denied');
              publishError(
                'Workspace 拒绝编辑权限。请重新打开文件以检查当前访问权限。',
              );
            }
            if (event.id === CollaborationUIEventId.CONFLICT) {
              publishStatus('conflict');
              publishError('同步冲突。请保留此页并等待恢复。');
            }
          }),
      );
      const collaboration = api.getCollaboration();
      disposables.push(
        api.addEvent(api.Event.CollaborationStatusChanged, (event) => {
          // A Facade notification can be queued across load/disposal. Read the
          // current entity instead of consuming an old event payload again.
          if (ownsView() && event.unitId === file.unitId) syncState(collaboration.getCollaborationStatus(file.unitId));
        }),
      );
      docState = file.type === 'base' ? undefined : univer.__getInjector().get(DocStateChangeManagerService);
      const flush = async () => {
        if (!initialized && !locallyChanged && !(await needsFlush())) {
          cancelingLoad = true;
          abort.abort(new DOMException('Document load superseded by navigation', 'AbortError'));
          return;
        }
        await startup;
        docState?.flushPendingChanges(file.unitId);
        await transport!.drainWrites();
        docState?.flushPendingChanges(file.unitId);
        // A clean document can be left while the socket is offline; no local edit is discarded.
        if (!(await needsFlush())) return;
        await collaboration.flush(file.unitId, { timeout: 20000 });
        // A committed Comment body can schedule its anchor mutation afterwards.
        await transport!.drainWrites();
        docState?.flushPendingChanges(file.unitId);
        await collaboration.flush(file.unitId, { timeout: 20000 });
      };
      disposables.push(
        api.addEvent(api.Event.CommandExecuted, (event) => {
          if (
            event.type === CommandType.MUTATION &&
            event.params?.unitId === file.unitId &&
            !event.options?.fromCollab &&
            !event.options?.fromChangeset &&
            !event.options?.onlyLocal
          ) {
            locallyChanged = true;
            if (initialized && !canceled) publishStatus('saving');
          }
        }),
      );
      releaseEditor = face.bindEditor(file.nodeId, {
        flush,
        isSaved: () =>
          !(docState?.getStateCache(file.unitId).collaboration.length ?? 0) &&
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
              : file.type === 'base' ? collaboration.loadBaseAsync(file.unitId)
                : Promise.reject(new Error('Unsupported collaborative editor.')));
      if (canceled || abort.signal.aborted) return;
      if (!unit) throw new Error('Server 未能加载此文件。');
      const session = await univer
        .__getInjector()
        .get(CollaborationSessionService)
        .requireSession(file.unitId);
      if (canceled || abort.signal.aborted) return;
      // Entity OFFLINE is also its initial state while the room joins. The
      // public per-Unit room lifecycle distinguishes startup from actual loss.
      subscriptions.push(session.sessionStatus$.subscribe(value => {
        if (canceled || abort.signal.aborted) return;
        sessionStatus = value;
        syncState(collaboration.getCollaborationStatus(file.unitId));
      }));
      // Asset loads can retry independently; they must not hold editor startup open.
      await transport.drainWrites();
      if (canceled || abort.signal.aborted) return;
      if (api.getCurrentLifecycleStage() < LifecycleStages.Rendered)
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(abort.signal.reason);
          abort.signal.addEventListener('abort', onAbort, { once: true });
          if (abort.signal.aborted) onAbort();
          disposables.push(
            api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => {
              if (stage >= LifecycleStages.Rendered) {
                abort.signal.removeEventListener('abort', onAbort);
                resolve();
              }
            }),
            { dispose: () => abort.signal.removeEventListener('abort', onAbort) },
          );
        });
      if (canceled || abort.signal.aborted) return;
      api.setCurrent(file.unitId);
      disposables.push(
        subscribeWorkspaceCollaborators(
          univer.__getInjector().get(MemberService),
          file.unitId,
          (people) => {
            lastMembers = people;
            if (!canceled)
              publishMembers(
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
            publishStatus('denied');
            publishError('文件权限已更改。请重新打开文件以使用当前权限。');
          }
        } catch (cause) {
          if (
            !canceled &&
            cause instanceof Error &&
            /not found|forbidden|access denied|permission/i.test(cause.message)
          ) {
            accessDenied = true;
            publishMembers([]);
            publishStatus('denied');
            publishError('你已无权访问此文件。请联系 Space 所有者。');
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
          void retention?.refresh().catch((cause) => publishError(cause.message));
        if (file.type === 'sheet') {
          void api.executeCommand(ToggleSheetCommentPanelOperation.id);
        } else if (file.type === 'slide' && !commentPanel.panelVisible) {
          void api.executeCommand(OpenSlideCommentPanelOperation.id);
        } else if (file.type === 'board' && !commentPanel.panelVisible) {
          void api.executeCommand(OpenBoardCommentPanelOperation.id);
        } else if (file.type === 'base' && !commentPanel.panelVisible) {
          // SDK 1.1.0 registers this Base command but does not export its constant.
          void api.executeCommand('base.operation.open-comment-panel');
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
          if (canceled || abort.signal.aborted) return;
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
          publishComments({ visible, toggle: toggleComments });
        }),
      );
      publishComments({
        visible: commentPanel.panelVisible,
        toggle: toggleComments,
      });
      initialized = true;
      publishLoaded(true);
      publishDocFocus();
      if (file.type === 'doc') {
        const selection = new SelectionEditing(univer, api, file, face,
          blocked => inputGate.setProjectionBlocked(blocked), flush,
          () => ownsView() && !accessDenied && sessionStatus === SessionStatus.ONLINE && !disconnected);
        selectionEditingBinding = selection;
        disposables.push(selection);
        setSelectionEditing(selection);
      }
      syncState(collaboration.getCollaborationStatus(file.unitId));
    };
    startup = mount().catch(cause => {
      if (cancelingLoad && abort.signal.aborted) return;
      throw cause;
    });
    void startup.catch(fail);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        runtime &&
        (runtime.univerAPI
          .getCollaboration()
          .getCollaborationStatus(file.unitId) !== CollaborationStatus.SYNCED ||
          (docState?.getStateCache(file.unitId).collaboration.length ?? 0) > 0)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      if (canceled) return;
      canceled = true;
      disposeEditorResources([
        () => selectionEditingBinding?.dispose(),
        () => setSelectionEditing(null),
        () => face.updateDocFocus(null, focusChannel),
        () => publishComments(null),
        () => publishMembers([]),
        () => releaseEditor(),
      ]);
      const active = runtime;
      // Host panel changes can unmount us without using a Space navigation action.
      // Drain the SDK queue before destruction; preserve its user-scoped offline
      // cache on failure. New mounts await this barrier, so runtimes never overlap.
      if (active)
        closingEditor = (async () => {
          try {
            if (!cancelingLoad) await startup;
            await transport?.drainWrites();
            docState?.flushPendingChanges(file.unitId);
            if (await needsFlush())
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
            if (matchesView()) face.update({
              error: cached
                ? '修改尚未同步。请保持同一 Workspace 账号并重新打开文件，从此浏览器的离线缓存恢复同步。'
                : '修改尚未同步，离线缓存也未能完成。请检查网络后重试。',
            });
          } finally {
            // Keep lifecycle listeners and local-mutation tracking alive until startup/flush settle.
            disposeEditorResources([...disposables.map(d => () => d.dispose()), () => active.univerAPI.disposeUnit(file.unitId)]);
            // The collaboration queue has been flushed or durably cached above.
            // Cancel asset/metadata reads instead of waiting for their remote timeouts.
            disposeEditorResources([() => abort.abort()]);
            try { await transport?.drain(); } catch (error) {
              console.error('Editor transport cleanup failed', error);
            } finally {
              disposeEditorResources([
                () => window.removeEventListener('beforeunload', beforeUnload),
                ...subscriptions.map(s => () => s.unsubscribe()),
                () => embedProducts?.dispose(), () => active.univer.dispose(), () => editorWorker?.terminate(),
              ]);
            }
          }
        })();
      else {
        disposeEditorResources([
          ...disposables.map(d => () => d.dispose()),
          ...subscriptions.map(s => () => s.unsubscribe()), () => embedProducts?.dispose(),
          () => editorWorker?.terminate(), () => abort.abort(),
          () => window.removeEventListener('beforeunload', beforeUnload),
        ]);
      }
    };
  }, [file.nodeId, user?.id, attempt, loadId]);
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
      {selectionEditing && <SelectionEditingNotice editor={selectionEditing} />}
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
