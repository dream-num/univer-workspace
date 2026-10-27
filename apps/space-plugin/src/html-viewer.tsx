import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  WorkspaceHtmlViewer,
  type WorkspaceHtmlViewerHandle,
} from '@univerjs/univer-workspace-html-viewer';
import { createWorkspaceHtmlEngine } from '@univerjs/univer-workspace-html-viewer/engine';
import { IHTTPImplementation, HTTPService } from '@univerjs/network';
import { UniverEmbedPlugin } from '@univerjs-pro/embed';
import { UniverCollaborationEmbedPlugin } from '@univerjs-pro/collaboration-embed';
import { UniverChartEmbedPlugin } from '@univerjs-pro/chart-embed';
import { HoverManagerService, DragManagerService } from '@univerjs/sheets-ui';
import type { Face } from './client.js';
import type { OpenFile, State } from './model.js';
import { editorHTTP } from './editor-http.js';
import { workspaceLicense } from './license.js';

const allowedOrigins = ['https://cdn.jsdelivr.net'];

/** The same formal HTML View host/engine as Browser, on this Host's authenticated transport. */
export function HtmlViewer({
  file,
  face,
  user,
}: {
  file: OpenFile;
  face: Face;
  user: State['status']['user'];
}) {
  const viewer = useRef<WorkspaceHtmlViewerHandle>(null);
  const [error, setError] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const lifetime = useRef(new AbortController());
  const transports = useRef<ReturnType<typeof editorHTTP>[]>([]);
  const tracking = useRef<{ dispose(): void }[]>([]);
  const loadEngine = useCallback(
    async (unitId: string, signal: AbortSignal) => {
      if (!user?.id)
        throw new Error('Sign in to Workspace to open this source.');
      const source = await face.htmlSource(unitId);
      signal.throwIfAborted();
      const combined = AbortSignal.any([signal, lifetime.current.signal]);
      const transport = editorHTTP((input, requestSignal) =>
        face.editorRequest(
          file,
          user.id!,
          input,
          AbortSignal.any([combined, requestSignal]),
        ),
        (input, requestSignal) => face.editorUpload(file, user.id!, input, AbortSignal.any([combined, requestSignal])),
      );
      transports.current.push(transport);
      const socketURL = new URL('/universer-api/comb/connect', file.endpoint);
      socketURL.protocol = socketURL.protocol === 'https:' ? 'wss:' : 'ws:';
      const networkConfig = {
        useFetchImpl: true,
        override: [[IHTTPImplementation, { useValue: transport }]],
      };
      return createWorkspaceHtmlEngine(
        {
          unitId,
          canEdit: source.editorMode === 'edit',
          translateError: (code) =>
            code === 'signInRequired'
              ? 'Sign in to edit this source.'
              : 'You do not have permission to edit this source.',
          user: {
            id: user.id,
            displayName: user.displayName ?? user.username ?? 'Workspace user',
          },
          license: workspaceLicense,
          networkConfig,
          collaborationClientConfig: {
            enableOfflineEditing: false,
            enableAuthServer: true,
            snapshotServerUrl: '/universer-api/snapshot',
            collabSubmitChangesetUrl: '/universer-api/comb',
            collabWebSocketUrl: socketURL.href,
            wsSessionTicketUrl: '/universer-api/user/session-ticket',
            authzUrl: '/universer-api/authz',
          },
          registerEmbed(univer) {
            // The eagerly loaded Sheets UI Facade observes every Sheet runtime.
            // Register its real public pointer services in this headless runtime;
            // they share the existing instance/render services and create no UI.
            const injector = univer.__getInjector();
            tracking.current.push(
              injector
                .get(HTTPService)
                .registerHTTPInterceptor({
                  priority: -100000,
                  interceptor: transport.track,
                }),
            );
            if (!injector.has(HoverManagerService))
              injector.add([HoverManagerService]);
            if (!injector.has(DragManagerService))
              injector.add([DragManagerService]);
            univer.registerPlugin(UniverEmbedPlugin);
            univer.registerPlugin(UniverCollaborationEmbedPlugin);
            univer.registerPlugin(UniverChartEmbedPlugin);
          },
        },
        combined,
      );
    },
    [file.nodeId, user?.id],
  );
  useEffect(() => {
    const flush = async () => {
      await viewer.current?.prepareToLeave();
      await Promise.all(
        transports.current.map((transport) => transport.drainWrites()),
      );
    };
    const isSaved = () => !viewer.current?.hasPendingChanges();
    face.bindEditor(file.nodeId, {
      flush,
      isSaved,
      resume: async () => {
        await viewer.current?.resume();
      },
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isSaved()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      face.bindEditor(file.nodeId, null);
      window.removeEventListener('beforeunload', beforeUnload);
      void Promise.allSettled(
        transports.current.map((transport) => transport.drainWrites()),
      ).finally(() => {
        lifetime.current.abort();
        tracking.current.forEach((registration) => registration.dispose());
      });
    };
  }, [file.nodeId]);
  return (
    <div className="sp-html-preview">
      {error && (
        <div className="sp-editor-error" role="alert">
          {error}
        </div>
      )}
      <button
        className="sp-html-inspect sp-control"
        aria-pressed={inspecting}
        onClick={() => {
          const operation = inspecting
            ? viewer.current?.inspect.close()
            : viewer.current?.inspect.open();
          void operation?.catch((cause) =>
            setError(
              cause instanceof Error
                ? cause.message
                : 'Cannot inspect this page.',
            ),
          );
        }}
      >
        Inspect page
      </button>
      <WorkspaceHtmlViewer
        ref={viewer}
        source={file.html ?? ''}
        title={file.name}
        locale="zh-CN"
        allowedOrigins={allowedOrigins}
        className="sp-html-runtime"
        loadEngine={loadEngine}
        onError={setError}
        onInspectChanged={setInspecting}
      />
    </div>
  );
}
