import React from 'react';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/remote';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote';
import { SpaceView, NativeConversation } from './ui.js';
import { PageContextDock } from './components/page-context.js';
import { HostNavigation } from './components/navigation.js';
import { HostNavigationBridge } from './components/host-navigation.js';
import { WorkspaceReference } from './components/file-reference.js';
import { ReturnedFiles } from './components/returned-files.js';
import { spaceReturnedFilesDefinition } from './turn-files.js';
import { workspaceReferenceRule } from './file-reference.js';
import { Icon } from './components/primitives.js';
import {
  selectedReference,
  type State,
  type Content,
  type Page,
  type Node,
} from './model.js';
import css from './space.css';
import tailwind from '../lib/tailwind.css';
import sdkCss from '../lib/univer-scoped.css';
import { configureLicense } from './license.js';
import { Settings } from './components/settings.js';

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    spacePlugin: true;
  }
}
export const inject = [
  'slots',
  'layout',
  'sessions',
  'uiWorkspace',
  'conversation',
  'uiConversation',
  'connection',
];
const PANEL = 'space-plugin';

/** Only content/navigation state lives here. Chat history remains in DSH. */
export function apply(ctx: any) {
  let view: State = {
    status: { state: 'unconfigured', endpoint: '' },
    spaces: [],
    all: [],
    recent: [],
    recentCursor: null,
    page: null,
    location: 'home',
    trash: [],
    action: null,
    sharing: null,
    space: '',
    parent: '',
    content: null,
    context: null,
    sessionId: null,
    sessionTitle: '',
    sessions: [],
    error: '',
    busy: false,
    ai: false,
    query: '',
    filter: 'all',
    discovery: 'Suggested',
    chatMode: 'compact',
    pins: [],
    spaceTab: 'Overview',
    notice: '',
    hostNavigation: 'checking',
  };
  const listeners = new Set<() => void>();
  const lifetime = new AbortController();
  let disposed = false;
  let licenseReady = false;
  let generation = 0;
  let contentRequest = 0;
  let directoryRequest = 0;
  let retained: any;
  const references = new Map<string, any>();
  const pageSessions = new Map<string, string>();
  let defaultSessionId: string | undefined;
  let sessionRequest = 0;
  const contextOwner = crypto.randomUUID();
  let contextSequence = 0;
  const removedContexts = new Set<string>();
  let ownBlock: { session: string; block: { reason: string } } | undefined;
  function unblock() {
    if (
      ownBlock &&
      ctx.conversation.blocks.storeFor(ownBlock.session).getSnapshot() ===
        ownBlock.block
    )
      ctx.conversation.blocks.set(ownBlock.session, undefined);
    ownBlock = undefined;
  }
  async function associateCurrent() {
    const file = view.content,
      sessionId = view.sessionId,
      request = sessionRequest,
      before = generation;
    if (!sessionId) {
      update({ context: null });
      return;
    }
    if (!file) {
      await clearCurrent();
      update({ context: null });
      return;
    }
    const key = `${file.nodeId}/${sessionId}`,
      removed = removedContexts.has(key),
      sequence = ++contextSequence;
    unblock();
    const block = { reason: '正在关联当前文档…' };
    if (!ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) {
      ownBlock = { session: sessionId, block };
      ctx.conversation.blocks.set(sessionId, block);
    }
    update({
      context: {
        file: selectedReference(file),
        state: removed ? 'removed' : 'linking',
      },
    });
    try {
      const result = await api('current', {
        sessionId,
        nodeId: removed ? '' : file.nodeId,
        space: file.node?.spaceId ?? file.space?.id ?? view.space,
        parent: file.node ? file.node.parentNodeId ?? '' : view.parent,
        owner: contextOwner,
        sequence,
      });
      if (
        before !== generation ||
        request !== sessionRequest ||
        view.content !== file ||
        view.sessionId !== sessionId
      )
        return;
      if (!result.applied) throw new Error('文档关联已变化，请重试。');
      update({
        context: {
          file: selectedReference(file),
          state: removed ? 'removed' : 'linked',
        },
      });
    } catch (error) {
      if (
        sequence === contextSequence &&
        before === generation &&
        request === sessionRequest
      ) {
        update({ context: { file: selectedReference(file), state: 'failed' } });
        if (ownBlock) {
          const failedBlock = { reason: '无法关联这份文档，请重试或移除引用。' };
          ownBlock = { session: sessionId, block: failedBlock };
          ctx.conversation.blocks.set(sessionId, failedBlock);
        }
      }
      throw error;
    } finally {
      if (sequence === contextSequence && view.context?.state !== 'failed')
        unblock();
    }
  }
  async function clearCurrent(sessionId = view.sessionId, space = view.location === 'space' || view.location === 'folder' ? view.space : '') {
    const sequence = ++contextSequence;
    if (sessionId)
      await api('current', {
        sessionId,
        nodeId: '',
        space,
        parent: space && space === view.space ? view.parent : '',
        owner: contextOwner,
        sequence,
      });
    if (sequence === contextSequence) unblock();
  }
  const workKey = () =>
    view.content
      ? `page:${view.content.nodeId}`
      : view.location === 'space'
        ? `space:${view.space}`
        : '';
  async function restoreSession() {
    const request = ++sessionRequest,
      before = generation;
    const previous = view.sessionId;
    const key = workKey();
    if (!defaultSessionId) {
      const active: any[] = Object.values(
        ctx.sessions.list.getSnapshot().byId,
      ).filter((row: any) => row.retainedBy.mainView > 0);
      if (active.length === 1) defaultSessionId = active[0].id;
    }
    const id = pageSessions.get(key) ?? view.sessionId ?? defaultSessionId;
    retained = undefined;
    update({
      sessionId: null,
      sessionTitle: '',
      context: null,
      chatMode: 'compact',
    });
    if (previous && previous !== id) await clearCurrent(previous, '');
    if (
      request !== sessionRequest ||
      before !== generation ||
      key !== workKey()
    )
      return;
    if (id) await linkSession(id, key);
  }
  function update(patch: Partial<State>) {
    if (!disposed) {
      view = { ...view, ...patch };
      listeners.forEach((fn) => fn());
    }
  }
  const store = {
    getSnapshot: () => view,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  async function api<T = any>(
    operation: string,
    payload: object = {},
  ): Promise<T> {
    const before = generation;
    const result = await ctx.connection.rpc.call(
      '/api',
      `space/${operation}`,
      payload,
      lifetime.signal,
    );
    if (before !== generation)
      throw new DOMException('Request superseded', 'AbortError');
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value;
  }
  let pending = 0;
  async function run(operation: () => Promise<void>) {
    pending++;
    update({ busy: true, error: '', notice: '' });
    try {
      await operation();
      return true;
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        update({
          error: error instanceof Error && error.message.startsWith('[FCollaboration]:')
            ? '尚未保存到 Workspace。请检查连接后重试，当前文档将保持打开。'
            : error instanceof Error ? error.message : '请求失败，请重试。',
        });
      return false;
    } finally {
      pending--;
      const resume = pausedEditor;
      if (
        !pending &&
        resume &&
        resume === editor &&
        view.content?.nodeId === resume.node
      ) {
        pausedEditor = null;
        try {
          await resume.resume?.();
        } catch (error) {
          update({
            error:
              error instanceof Error
                ? error.message
                : 'Cannot resume this page.',
          });
        }
      }
      update({ busy: pending > 0 });
    }
  }
  async function recents(cursor = '') {
    const before = generation;
    const result = await api('recent', { cursor });
    if (before === generation)
      update({
        recent: cursor ? [...view.recent, ...result.items] : result.items,
        recentCursor: result.nextCursor,
      });
  }
  async function refresh() {
    if (!licenseReady) {
      const config = await api('runtime-config');
      configureLicense(config.license);
      licenseReady = true;
    }
    let before = generation;
    let status = await api('status');
    if (before !== generation) return;
    if (
      status.endpoint !== view.status.endpoint ||
      (status.state !== 'network-error' &&
        status.user?.id !== view.status.user?.id)
    ) {
      clearContent();
      before = generation;
    }
    update({
      status:
        status.state === 'network-error'
          ? { ...status, user: status.endpoint === view.status.endpoint ? view.status.user : undefined }
          : status,
    });
    if (status.state === 'connected') {
      const result = await api('spaces');
      if (before !== generation) return;
      update({ spaces: result.spaces });
      const index = await api('index');
      if (before !== generation) return;
      update({ all: index.nodes });
      await recents();
    } else if (status.state !== 'network-error') {
      clearContent();
      update({
        spaces: [],
        all: [],
        recent: [],
        page: null,
        space: '',
        parent: '',
      });
    }
  }
  function clearContent() {
    generation++;
    contextSequence++;
    unblock();
    removedContexts.clear();
    contentRequest++;
    directoryRequest++;
    sessionRequest++;
    pageSessions.clear();
    update({
      content: null,
      context: null,
      spaces: [], all: [], recent: [], page: null, space: '', parent: '',
      location: 'home', query: '',
      pins: [],
      trash: [],
      action: null,
      sharing: null,
      chatMode: 'compact',
    });
  }
  async function refreshOpenMetadata() {
    const current = view.content, before = generation;
    if (!current) return;
    const metadata = await api<any>('metadata', { node: current.nodeId });
    if (before !== generation || view.content?.nodeId !== current.nodeId) return;
    if (metadata.node.name === current.name &&
        metadata.node.parentNodeId === current.node?.parentNodeId &&
        metadata.node.spaceId === current.node?.spaceId &&
        JSON.stringify(metadata.breadcrumbs) === JSON.stringify(current.breadcrumbs)) return;
    update({ content: { ...view.content, name: metadata.node.name, node: metadata.node,
      space: metadata.space, breadcrumbs: metadata.breadcrumbs } });
    await associateCurrent();
  }
  async function refreshVisibleDirectory() {
    if (!view.space || !['space', 'folder'].includes(view.location)) return;
    const space = view.space, parent = view.parent, before = generation, request = ++directoryRequest;
    const page = await api<Page>('nodes', { space, parent });
    if (before !== generation || request !== directoryRequest || view.space !== space || view.parent !== parent) return;
    page.nodes = page.nodes.map((node) => ({
      ...node,
      resource: node.resource && view.all.find((item) => item.id === node.id)?.resource?.htmlView
        ? { ...node.resource, htmlView: true } : node.resource,
    }));
    update({ page });
  }
  async function directory(space: string, parent = '', cursor = '') {
    const request = ++directoryRequest;
    contentRequest++;
    sessionRequest++;
    const before = generation;
    const page = await api<Page>('nodes', { space, parent, cursor });
    if (before !== generation || request !== directoryRequest) return;
    page.nodes = page.nodes.map((node) => ({
      ...node,
      resource:
        node.resource &&
        view.all.find((item) => item.id === node.id)?.resource?.htmlView
          ? { ...node.resource, htmlView: true }
          : node.resource,
    }));
    contentRequest++;
    update({
      location: parent ? 'folder' : 'space',
      space,
      parent,
      spaceTab: 'Overview',
      page:
        cursor && view.page
          ? { ...page, nodes: [...view.page.nodes, ...page.nodes] }
          : page,
      content: null,
      query: '',
      filter: 'all',
    });
    await restoreSession();
  }
  async function linkSession(id: string, key = workKey()) {
    const request = ++sessionRequest,
      before = generation;
    let next = references.get(id);
    if (!next) {
      next = ctx.sessions.retain(id, {
        source: 'spacePlugin',
        signal: lifetime.signal,
      });
      references.set(id, next);
    }
    try {
      await next.ready;
    } catch (error) {
      if (references.get(id) === next) {
        references.delete(id);
        next.release();
      }
      throw error;
    }
    if (
      request !== sessionRequest ||
      before !== generation ||
      key !== workKey()
    )
      return;
    if (view.sessionId && view.sessionId !== id) {
      await clearCurrent(view.sessionId, '');
      if (
        request !== sessionRequest ||
        before !== generation ||
        key !== workKey()
      )
        return;
    }
    retained = next;
    if (key) pageSessions.set(key, id);
    const row = ctx.sessions.list.getSnapshot().byId[id];
    update({
      sessionId: id,
      sessionTitle: row?.title ?? row?.displayTitle ?? 'New conversation',
      context: null,
    });
    // A failed/obsolete Workspace association does not release a live DSH Session.
    await associateCurrent();
  }

  async function newConversation() {
    const before = generation,
      key = workKey();
    const row = view.sessionId
      ? ctx.sessions.list.getSnapshot().byId[view.sessionId]
      : undefined;
    const id = await ctx.sessions.create(row?.cwd ? { cwd: row.cwd } : {});
    if (before !== generation || key !== workKey()) return;
    await linkSession(id, key);
    update({ chatMode: 'expanded' });
  }
  async function nativeChat(_withDocument: boolean) {
    update({ ai: true, chatMode: 'expanded' });
    if (!view.sessionId) await newConversation();
    else if (view.content) await associateCurrent();
  }
  type EditorBinding = {
    node: string;
    flush(): Promise<void>;
    isSaved(): boolean;
    resume?(): Promise<void>;
  };
  let editor: EditorBinding | null = null;
  let pausedEditor: EditorBinding | null = null;
  async function flushEditor() {
    // HTML drafts may still be inside the sandbox before the host sees pending
    // state. Its formal departure protocol must run even while Saved is true.
    if (editor) {
      if (editor.resume) pausedEditor = editor;
      await editor.flush();
    }
  }
  const face = {
    editingStatus: (sessionId: string, nodeId: string) => api('editing-status', { sessionId, nodeId }),
    editingAction: async (input: { sessionId: string; nodeId: string; action: string; proposalId: string; reviewToken?: string }) => {
      if (input.action === 'review' || input.action === 'apply') {
        // UX preflight only; the Server still verifies the review and ACL
        // atomically at merge. Avoid flushing an editor after access revocation.
        try {
          const { node } = await api<{ node: Node }>('metadata', { node: input.nodeId });
          if (!node.resource?.capabilities.editContent) throw Object.assign(new Error('Access denied'), { code: '403' });
        } catch (error) {
          if (['403', '404'].includes(String((error as { code?: string }).code)))
            throw new Error('你已无权应用这份文档的修改，请联系所有者。');
          throw error;
        }
        try { await flushEditor(); }
        catch (error) { throw new Error('文档尚未完成同步。请恢复连接后重试。', { cause: error }); }
      }
      return api('editing-action', input);
    },
    metadata: (node: string) => api('metadata', { node }),
    sharing: (input: import('./sharing.js').SharingInput) =>
      api('sharing', input),
    htmlSource: (unit: string) =>
      api<{ editorMode: 'edit' | 'readOnly' }>('html-source', { unit }),
    readDirectory: (space: string, parent = '', cursor = '') =>
      api<Page>('nodes', { space, parent, cursor }),
    showTrash: () =>
      run(async () => {
        await flushEditor();
        await clearCurrent();
        contentRequest++;
        directoryRequest++;
        sessionRequest++;
        const result = await api('trash');
        update({
          location: 'trash',
          content: null,
          trash: result.items,
          query: '',
        });
      }),
    mutate: (input: {
      action: string;
      id: string;
      name?: string;
      parent?: string;
    }) =>
      run(async () => {
        if (input.action === 'delete') await flushEditor();
        const result = await api('mutate', input);
        if (input.action === 'delete') {
          const deleted = new Set([input.id]);
          // A trashed Folder can contain the open document or current location.
          for (const node of view.all) {
            let current: typeof node | undefined = node;
            const visited = new Set<string>();
            while (current && !visited.has(current.id)) {
              visited.add(current.id);
              if (current.id === input.id) {
                deleted.add(node.id);
                break;
              }
              current = view.all.find(
                (item) => item.id === current?.parentNodeId,
              );
            }
          }
          if (view.content && deleted.has(view.content.nodeId)) {
            await clearCurrent();
            contentRequest++;
            update({ content: null, context: null });
          }
          update({ pins: view.pins.filter((id) => !deleted.has(id)) });
          if (deleted.has(view.parent)) {
            const original = view.all.find((node) => node.id === input.id);
            update({
              parent: original?.parentNodeId ?? '',
              location: original?.parentNodeId ? 'folder' : 'space',
            });
          }
        }
        await refresh();
        if (view.content) {
          const metadata = await api('metadata', { node: view.content.nodeId });
          update({
            content: {
              ...view.content,
              name: metadata.node.name,
              node: metadata.node,
              space: metadata.space,
              breadcrumbs: metadata.breadcrumbs,
            },
          });
          await associateCurrent();
        }
        if (view.location === 'folder' || view.location === 'space') {
          const page = await api<Page>('nodes', {
            space: view.space,
            parent: view.parent,
          });
          page.nodes = page.nodes.map((node) => ({
            ...node,
            resource:
              view.all.find((item) => item.id === node.id)?.resource ??
              node.resource,
          }));
          update({ page });
        }
        if (view.location === 'trash')
          update({ trash: (await api('trash')).items });
        update({
          action: null,
          sharing: null,
          notice:
            input.action === 'delete'
              ? 'Moved to Trash'
              : input.action === 'restore'
                ? 'Restored'
                : input.action === 'move'
                  ? 'Moved'
                  : 'Renamed',
        });
      }),
    editorRequest: async (
      file: Content,
      userId: string,
      input: { path: string; method: string; body: string | null },
      signal: AbortSignal,
    ) => {
      const result = await ctx.connection.rpc.call(
        '/api',
        'space/editor-http',
        { ...input, endpoint: file.endpoint, userId },
        AbortSignal.any([signal, lifetime.signal]),
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    bindEditor: (
      node: string,
      binding: {
        flush(): Promise<void>;
        isSaved(): boolean;
        resume?(): Promise<void>;
      } | null,
    ) => {
      if (binding) editor = { node, ...binding };
      else if (editor?.node === node) {
        editor = null;
        pausedEditor = null;
      }
    },
    pin: (id: string) => {
      const pins = view.pins.includes(id)
        ? view.pins.filter((p) => p !== id)
        : [...view.pins, id];
      update({ pins });
    },
    store,
    update,
    newConversation: () => run(newConversation),
    reference: () => retained,
    refresh: () => run(refresh),
    configure: (endpoint: string) =>
      run(async () => {
        await flushEditor();
        const status = await api('configure', { endpoint });
        if (status.endpoint !== view.status.endpoint) clearContent();
        update({ status });
        await refresh();
      }),
    signIn: () => {
      const desktop = window.location.protocol === 'dsh-app:';
      // Web popup is reserved in the click. Official Desktop forwards external
      // window.open HTTP(S) URLs to its system browser and returns null.
      const popup = desktop ? null : window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
      return run(async () => {
        try {
          await flushEditor();
          clearContent();
          const result = await api('oauth-start', { desktop });
          if (desktop) window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer');
          else if (popup) popup.location.replace(result.authorizationUrl);
          else throw new Error('请允许打开登录窗口，然后重试。');
          await refresh();
        } catch (error) { popup?.close(); await api('oauth-cancel'); throw error; }
      });
    },
    cancelSignIn: () => run(async () => { await api('oauth-cancel'); await refresh(); }),
    disconnect: () => run(async () => {
      await flushEditor();
      await api('sign-out');
      clearContent();
      await refresh();
    }),
    directory: (space: string, parent = '', cursor = '') =>
      run(async () => {
        await flushEditor();
        await directory(space, parent, cursor);
      }),
    home: (location: 'home' | 'recent' = 'home', filter = 'all') =>
      run(async () => {
        await flushEditor();
        void run(() => clearCurrent(view.sessionId, ''));
        sessionRequest++;
        contentRequest++;
        directoryRequest++;
        update({
          location,
          content: null,
          query: '',
          filter,
        });
        await recents();
      }),
    moreRecent: () => run(() => recents(view.recentCursor ?? '')),
    open: (node: string) =>
      run(async () => {
        if (view.content?.nodeId === node) return;
        await flushEditor();
        const request = ++contentRequest;
        directoryRequest++;
        sessionRequest++;
        const before = generation;
        const content = await api<Content>('content', { node });
        if (before === generation && request === contentRequest) {
          update({ content });
          await restoreSession();
          await recents();
        }
      }),
    create: (input: {
      kind: string;
      name: string;
      space: string;
      parent: string;
      key: string;
      invite?: import('./sharing.js').Invite;
    }) =>
      run(async () => {
        await flushEditor();
        const before = generation;
        const result = await api('create', input);
        if (before !== generation) return;
        await refresh();
        if (result.space) {
          await directory(result.space.id);
          if (input.invite) {
            try {
              await api('sharing', {
                action: 'set-member',
                id: result.space.id,
                user: input.invite.user.id,
                role: input.invite.role,
              });
              update({ notice: 'Space created · Member added' });
            } catch (error) {
              // Space creation already succeeded. Retry only the membership write.
              update({
                sharing: {
                  kind: 'space',
                  id: result.space.id,
                  name: result.space.name,
                  invite: input.invite,
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Member could not be added.',
                },
                notice:
                  'Space created. Member could not be added; retry in Share.',
                error: '',
              });
            }
          }
        } else {
          await directory(input.space, input.parent);
          update({ spaceTab: 'Content' });
          if (input.kind !== 'folder') {
            const content = await api<Content>('content', {
              node: result.node.id,
            });
            update({ content });
            await restoreSession();
            await recents();
          }
        }
      }),
    close: () =>
      run(async () => {
        await flushEditor();
        void run(clearCurrent);
        sessionRequest++;
        contentRequest++;
        directoryRequest++;
        update({ content: null });
        if (view.location === 'space') await restoreSession();
      }),
    removeContext: () => {
      if (view.content && view.sessionId) {
        removedContexts.add(`${view.content.nodeId}/${view.sessionId}`);
        void run(associateCurrent);
      }
    },
    reconnectContext: () => {
      if (view.content && view.sessionId) {
        removedContexts.delete(`${view.content.nodeId}/${view.sessionId}`);
        void run(associateCurrent);
      }
    },
    chat: () => run(() => nativeChat(Boolean(view.content))),
    back: () =>
      run(async () => {
        await flushEditor();
        ctx.layout.selectPanel(null);
        const target = defaultSessionId && references.get(defaultSessionId);
        if (target)
          void target.ready.then((binding: any) =>
            requestAnimationFrame(() => {
              if (ctx.layout.panelInfo.getSnapshot().activePanelId === null)
                ctx.conversation.input.for(binding.ctx).focus();
            }),
          );
      }),
    link: (id: string) => run(() => linkSession(id)),
  };
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = PANEL;
    style.textContent = `${sdkCss}\n${css}\n${tailwind}`;
    document.head.appendChild(style);
    return () => style.remove();
  });
  ctx.effect(() => () => {
    disposed = true;
    lifetime.abort();
    unblock();
    for (const reference of references.values()) reference.release();
    references.clear();
    listeners.clear();
  });
  const syncSessions = () => {
    const catalog = ctx.sessions.list.getSnapshot();
    const rows: any[] = Object.values(catalog.byId);
    update({
      sessionTitle: view.sessionId
        ? (catalog.byId[view.sessionId]?.title ??
          catalog.byId[view.sessionId]?.displayTitle ??
          view.sessionTitle)
        : '',
      sessions: rows
        .filter((row) => row.origin !== 'subagent')
        .map((row) => ({
          id: row.id,
          title: row.title ?? row.cwd?.split('/').pop() ?? '未命名对话',
        })),
    });
  };
  ctx.effect(() => ctx.sessions.list.subscribe(syncSessions));
  ctx.on('connection/reset', () => {
    void run(async () => {
      await refresh();
      if (view.content && view.sessionId && view.status.state === 'connected')
        await associateCurrent();
    });
  });
  syncSessions();
  ctx.effect(() =>
    ctx.layout.panelInfo.subscribe(() => {
      if (ctx.layout.panelInfo.getSnapshot().activePanelId !== PANEL) {
        void run(clearCurrent);
        return;
      }
      {
        const rows: any[] = Object.values(ctx.sessions.list.getSnapshot().byId);
        const active = rows.filter((row) => row.retainedBy.mainView > 0);
        if (active.length === 1) {
          defaultSessionId = active[0].id;
          if (!view.sessionId) void run(() => linkSession(active[0].id));
        }
      }
      void run(async () => {
        await refresh();
        if (view.content && view.sessionId && view.status.state === 'connected')
          await associateCurrent();
      });
    }),
  );
  async function openWorkspaceReference(node: string, resource: string, unit: string, session: string) {
    await flushEditor();
    const before = generation, request = ++contentRequest;
    directoryRequest++;
    sessionRequest++;
    const file = await api<Content>('content', { node });
    if (before !== generation || request !== contentRequest) return;
    if (file.resourceId !== resource || file.unitId !== unit)
      throw new Error('This file reference no longer matches its Workspace identity.');
    // Preserve the reference Session, then visibly associate this Page under current ACLs.
    ctx.layout.selectPanel(PANEL);
    contentRequest++;
    directoryRequest++;
    update({ content: file, ai: true, chatMode: 'expanded' });
    await linkSession(session);
  }

  ctx.effect(() =>
    ctx.uiConversation.userText.register(workspaceReferenceRule),
  );
  ctx.effect(() =>
    ctx.slots.inject('conversation.user.text.node', () =>
      ctx.slots.register(
        {
          name: 'conversation.user.text.node',
          key: 'workspace-file',
          inject: () => ({
            openFile: openWorkspaceReference,
          }),
        },
        WorkspaceReference,
      ),
    ),
  );
  ctx.effect(() => ctx.uiConversation.events.register(spaceReturnedFilesDefinition));
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: 'space-returned-files',
    select: (owner: any) => owner.turn.data.get('spaceReturnedFiles'),
    inject: (sessionId: string) => ({ sessionId, openFile: openWorkspaceReference }),
  }, ReturnedFiles)));
  ctx.effect(() =>
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'space-current-document',
          order: -100,
          inject: () => face,
        },
        PageContextDock,
      ),
    ),
  );
  ctx.effect(() =>
    ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register(
        {
          name: 'sidebar.footer.action',
          id: 'space-host-navigation',
          order: -100,
          inject: () => ({
            ...face,
            toggleSidebar: () => ctx.layout.toggleSidebar(),
            currentPanel: () =>
              ctx.layout.panelInfo.getSnapshot().activePanelId,
          }),
        },
        HostNavigationBridge,
      ),
    ),
  );
  // Public region override, registered only while Space is selected. Host stores,
  // outer controls, drag width and the original navigation registration stay owned by DSH.
  ctx.effect(() =>
    ctx.slots.inject('sidebar.workspaces', () => {
      let release: (() => void) | undefined;
      const sync = () => {
        const active =
          ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL &&
          view.hostNavigation === 'active';
        if (active && !release)
          release = ctx.slots.register(
            { name: 'sidebar.workspaces', priority: -100, inject: () => face },
            HostNavigation,
          );
        if (!active && release) {
          release();
          release = undefined;
        }
      };
      const unsubscribe = ctx.layout.panelInfo.subscribe(sync);
      const unsubscribeView = store.subscribe(sync);
      sync();
      return () => {
        unsubscribe();
        unsubscribeView();
        release?.();
      };
    }),
  );
  ctx.effect(() =>
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        {
          name: 'main',
          key: PANEL,
          children: {
            'space.conversation': { kind: 'single', scope: 'session' },
          },
          inject: () => face,
        },
        SpaceView,
      ),
    ),
  );
  ctx.effect(() =>
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: PANEL,
          order: -10,
          label: () => 'Space',
        },
        ({ size }: any) => <Icon name="workspace" size={size} />,
      ),
    ),
  );
  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({ name: 'settings.section', id: 'univer-workspace', order: 25,
      label: () => 'Workspace', inject: () => ({ face }) }, Settings)));
  ctx.effect(() => {
    let polling = false;
    let appliedContentVersion: number | undefined;
    const timer = setInterval(async () => {
      if (polling || lifetime.signal.aborted) return;
      polling = true;
      try {
        const status = await api('status');
        const changed = status.state !== view.status.state || status.endpoint !== view.status.endpoint || status.user?.id !== view.status.user?.id;
        const contentChanged = status.contentVersion !== appliedContentVersion;
        if (changed || contentChanged || status.oauth?.phase !== view.status.oauth?.phase) {
          await run(async () => {
            await refresh();
            if (contentChanged && view.status.state === 'connected') {
              await refreshVisibleDirectory();
              await refreshOpenMetadata();
              appliedContentVersion = status.contentVersion;
            } else if (contentChanged && view.status.state !== 'network-error') {
              appliedContentVersion = status.contentVersion;
            }
          });
        }
      } catch { /* Connection reset owns retry; never surface raw transport details. */ }
      finally { polling = false; }
    }, 1000);
    return () => clearInterval(timer);
  });
  ctx.effect(() =>
    ctx.slots.inject('space.conversation', () =>
      ctx.slots.register({ name: 'space.conversation' }, NativeConversation),
    ),
  );
  ctx.effect(() => () => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL)
      ctx.layout.selectPanel(null);
  });
}
export type Face = {
  editingStatus(sessionId: string, nodeId: string): Promise<import('./model.js').Proposal | null>;
  editingAction(input: { sessionId: string; nodeId: string; action: string; proposalId: string; reviewToken?: string }): Promise<any>;

  metadata(node: string): Promise<{ node: import('./model.js').Node }>;
  sharing(input: import('./sharing.js').SharingInput): Promise<any>;
  htmlSource(unit: string): Promise<{ editorMode: 'edit' | 'readOnly' }>;
  readDirectory(space: string, parent?: string, cursor?: string): Promise<Page>;
  showTrash(): Promise<boolean>;
  mutate(input: {
    action: string;
    id: string;
    name?: string;
    parent?: string;
  }): Promise<boolean>;
  editorRequest(
    file: Content,
    userId: string,
    input: { path: string; method: string; body: string | null },
    signal: AbortSignal,
  ): Promise<{ status: number; statusText: string; body: string }>;
  bindEditor(
    node: string,
    binding: {
      flush(): Promise<void>;
      isSaved(): boolean;
      resume?(): Promise<void>;
    } | null,
  ): void;
  newConversation(): void;
  pin(id: string): void;
  reference(): any;
  store: { getSnapshot(): State; subscribe(fn: () => void): () => void };
  update(patch: Partial<State>): void;
  refresh(): void;
  configure(endpoint: string): void;
  signIn(): void;
  cancelSignIn(): void;
  disconnect(): void;
  directory(space: string, parent?: string, cursor?: string): void;
  home(location?: 'home' | 'recent', filter?: string): void;
  moreRecent(): void;
  open(node: string): void;
  create(input: {
    kind: string;
    name: string;
    space: string;
    parent: string;
    key: string;
    invite?: import('./sharing.js').Invite;
  }): Promise<boolean>;
  close(): void;
  removeContext(): void;
  reconnectContext(): void;
  chat(): void;
  back(): void;
  link(id: string): void;
};
