import React from 'react';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/remote';
import { SpaceView, NativeConversation } from './ui.js';
import { PageContextDock } from './components/page-context.js';
import { HostNavigation } from './components/navigation.js';
import { HostNavigationBridge } from './components/host-navigation.js';
import { WorkspaceReference } from './components/file-reference.js';
import { workspaceReferenceRule } from './file-reference.js';
import { Icon } from './components/primitives.js';
import {
  selectedReference,
  type State,
  type Content,
  type Page,
} from './model.js';
import css from './space.css';
import tailwind from '../lib/tailwind.css';
import sdkCss from '../lib/univer-scoped.css';

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
    space: '',
    parent: '',
    content: null,
    context: null,
    sessionId: null,
    sessionTitle: '',
    sessions: [],
    error: '',
    busy: false,
    settings: false,
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
        if (ownBlock) ctx.conversation.blocks.set(sessionId, ownBlock.block);
      }
      throw error;
    } finally {
      if (sequence === contextSequence && view.context?.state !== 'failed')
        unblock();
    }
  }
  async function clearCurrent(sessionId = view.sessionId) {
    const sequence = ++contextSequence;
    if (sessionId)
      await api('current', {
        sessionId,
        nodeId: '',
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
    if (previous && previous !== id) await clearCurrent(previous);
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
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }
  let pending = 0;
  async function run(operation: () => Promise<void>) {
    pending++;
    update({ busy: true, error: '' });
    try {
      await operation();
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        update({
          error: error instanceof Error ? error.message : '请求失败，请重试。',
        });
    } finally {
      pending--;
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
    let before = generation;
    const status = await api('status');
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
          ? { ...status, user: view.status.user }
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
      pins: [],
      chatMode: 'compact',
    });
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
      await clearCurrent(view.sessionId);
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
  const face = {
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
        const status = await api('configure', { endpoint });
        if (status.endpoint !== view.status.endpoint) clearContent();
        update({ status });
        await refresh();
      }),
    login: (username: string, password: string) =>
      run(async () => {
        await api('login', { username, password });
        await refresh();
        if (view.status.state === 'connected') update({ settings: false });
      }),
    disconnect: () =>
      run(async () => {
        clearContent();
        await api('configure', { endpoint: '' });
        await refresh();
      }),
    directory: (space: string, parent = '', cursor = '') =>
      run(() => directory(space, parent, cursor)),
    home: (location: 'home' | 'recent' = 'home') => {
      void run(clearCurrent);
      sessionRequest++;
      contentRequest++;
      directoryRequest++;
      update({
        location,
        content: null,
        query: '',
        filter: 'all',
      });
      void run(() => recents());
    },
    moreRecent: () => run(() => recents(view.recentCursor ?? '')),
    open: (node: string) =>
      run(async () => {
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
    close: () => {
      void run(clearCurrent);
      sessionRequest++;
      contentRequest++;
      directoryRequest++;
      update({ content: null });
      if (view.location === 'space') void run(restoreSession);
    },
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
    back: () => {
      ctx.layout.selectPanel(null);
      const target = defaultSessionId && references.get(defaultSessionId);
      if (target)
        void target.ready.then((binding: any) =>
          requestAnimationFrame(() => {
            if (ctx.layout.panelInfo.getSnapshot().activePanelId === null)
              ctx.conversation.input.for(binding.ctx).focus();
          }),
        );
    },
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
            openFile: async (
              node: string,
              resource: string,
              unit: string,
              session: string,
            ) => {
              const before = generation,
                request = ++contentRequest;
              directoryRequest++;
              sessionRequest++;
              const file = await api<Content>('content', { node });
              if (before !== generation || request !== contentRequest) return;
              if (file.resourceId !== resource || file.unitId !== unit)
                throw new Error(
                  'This file reference no longer matches its Workspace identity.',
                );
              // Preserve the reference Session, then visibly associate this Page under current ACLs.
              ctx.layout.selectPanel(PANEL);
              contentRequest++;
              directoryRequest++;
              update({
                content: file,
                ai: true,
                chatMode: 'expanded',
              });
              await linkSession(session);
            },
          }),
        },
        WorkspaceReference,
      ),
    ),
  );
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
  newConversation(): void;
  pin(id: string): void;
  reference(): any;
  store: { getSnapshot(): State; subscribe(fn: () => void): () => void };
  update(patch: Partial<State>): void;
  refresh(): void;
  configure(endpoint: string): void;
  login(username: string, password: string): void;
  disconnect(): void;
  directory(space: string, parent?: string, cursor?: string): void;
  home(location?: 'home' | 'recent'): void;
  moreRecent(): void;
  open(node: string): void;
  close(): void;
  removeContext(): void;
  reconnectContext(): void;
  chat(): void;
  back(): void;
  link(id: string): void;
};
