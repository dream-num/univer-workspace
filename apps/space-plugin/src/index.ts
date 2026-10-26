import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-system-prompt';
import { ToolBindings, registerReadTools } from './tools.js';
import { AgentEditing, registerEditingTools } from './editing.js';
import { SpaceError, WorkspaceConnection } from './workspace.js';

export const name = 'space-plugin';
export const inject = ['connection', 'tools', 'systemPrompt'];

/** Use the public Connection carrier; no webServer or Desktop-private IPC. */
export function apply(ctx: Context) {
  const workspace = new WorkspaceConnection();
  const bindings = new ToolBindings(workspace);
  const editing = new AgentEditing(workspace, bindings);
  ctx.effect(() => registerEditingTools(ctx, editing));
  ctx.effect(() => registerReadTools(ctx, workspace, bindings, (session, args, signal) => editing.inspect(session, args, signal)));
  ctx.effect(() =>
    ctx.systemPrompt.context({
      name: 'space:current-document',
      order: 230,
      interpolate: false,
      required: true,
      text: (context) =>
        context.agent ? bindings.contextText(context.agent.session.id) : '',
    }),
  );
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message.source.kind === 'user')
      bindings.admit(agent.session.id, message.id);
  });
  ctx.on('agent/inbox/discarded', ({ agent, message }) => {
    bindings.discard(agent.session.id, message.id);
  });
  ctx.on('agent/pre-step', async ({ agent, turn, messages }, next) => {
    bindings.beginStep(agent.session.id, turn, messages);
    return next();
  });
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') bindings.endTurn(agent.session.id);
  });
  ctx.effect(() => () => workspace.dispose());
  const handle = async (
    operation: string,
    payload: unknown,
    signal: AbortSignal,
  ) => {
    try {
      signal.throwIfAborted();
      const input = payload as Record<string, unknown> | null;
      const string = (key: string, optional = false): string => {
        const value = input?.[key];
        if (optional && value === undefined) return '';
        if (typeof value !== 'string' || value.length > 4096)
          throw new SpaceError(400, `Invalid ${key}.`);
        return value;
      };
      let value: unknown;
      switch (operation) {
        case 'editing-status':
          value = await editing.status(string('sessionId'), string('nodeId'));
          break;
        case 'editing-action':
          value = await editing.action(string('sessionId'), string('nodeId'), string('action'), string('proposalId'), string('reviewToken', true));
          break;
        case 'status':
          value = await workspace.status();
          break;
        case 'associate':
          value = await bindings.bind(string('sessionId'), string('nodeId'));
          break;
        case 'configure': {
          const before = workspace.endpoint;
          value = await workspace.connect(string('endpoint'), signal);
          if (before !== workspace.endpoint) bindings.clear();
          break;
        }
        case 'login': {
          const before = await workspace.status();
          const after = await workspace.login(
            string('username'),
            string('password'),
          );
          if (before.user?.id !== after.user?.id) bindings.clear();
          value = after;
          break;
        }
        case 'current': {
          const sequence = input?.sequence;
          if (!Number.isSafeInteger(sequence) || Number(sequence) < 0)
            throw new SpaceError(400, 'Invalid association sequence.');
          value = await bindings.setCurrent(
            string('sessionId'),
            string('nodeId', true),
            string('owner'),
            Number(sequence),
          );
          break;
        }
        case 'recent': {
          const query = new URLSearchParams({ limit: '100' });
          const cursor = string('cursor', true);
          if (cursor) query.set('cursor', cursor);
          value = await workspace.json(`/api/recent-resources?${query}`, {
            signal,
          });
          break;
        }
        case 'sharing':
          value = await workspace.sharing(input as any, signal);
          break;
        case 'spaces':
          value = await workspace.json('/api/spaces', { signal });
          break;
        case 'nodes': {
          const parent = string('parent', true);
          const space = string('space', true);
          if (!parent && !space)
            throw new SpaceError(400, 'Space or parent required.');
          const upstream = parent
            ? `/api/nodes/${encodeURIComponent(parent)}/children`
            : `/api/spaces/${encodeURIComponent(space)}/nodes`;
          const query = new URLSearchParams({ limit: '100' });
          const cursor = string('cursor', true);
          if (cursor) query.set('cursor', cursor);
          value = await workspace.json(`${upstream}?${query}`, { signal });
          break;
        }
        case 'index':
          value = await workspace.index(signal);
          break;
        case 'editor-http': {
          const body = input?.body;
          if (body !== null && typeof body !== 'string')
            throw new SpaceError(400, 'Invalid editor body.');
          value = await workspace.editorRequest(
            {
              endpoint: string('endpoint'),
              userId: string('userId'),
              path: string('path'),
              method: string('method'),
              body,
            },
            signal,
          );
          break;
        }
        case 'create':
          value = await workspace.create(
            {
              kind: string('kind'),
              name: string('name'),
              space: string('space', true),
              parent: string('parent', true),
              key: string('key'),
            },
            signal,
          );
          break;
        case 'content':
          value = await workspace.read(string('node'), signal);
          break;
        case 'metadata':
          value = await workspace.json(
            `/api/nodes/${encodeURIComponent(string('node'))}`,
            { signal },
          );
          break;
        case 'html-source': {
          const unit = string('unit');
          const resolved = await workspace.json(
            `/api/unit-resources/${encodeURIComponent(unit)}`,
            { signal },
          );
          const opened = await workspace.json(
            `/api/resources/${encodeURIComponent(resolved.resource.id)}/open`,
            { method: 'POST', signal },
          );
          if (
            opened.resource.kind !== 'univer' ||
            opened.resource.unitType !== 'sheet' ||
            opened.resource.unitId !== unit ||
            !['edit', 'readOnly'].includes(opened.resource.editorMode)
          )
            throw new SpaceError(
              403,
              'This Page source must be an accessible Sheet.',
            );
          value = { editorMode: opened.resource.editorMode };
          break;
        }
        case 'trash':
          value = await workspace.trash(signal);
          break;
        case 'mutate':
          value = await workspace.mutate(
            {
              action: string('action'),
              id: string('id'),
              name: string('name', true),
              parent: string('parent', true),
            },
            signal,
          );
          break;
        default:
          throw new SpaceError(404, 'Unknown Space operation.');
      }
      signal.throwIfAborted();
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: String(error instanceof SpaceError ? error.status : 500),
          message:
            error instanceof SpaceError
              ? error.message
              : 'Space request failed or was canceled.',
          details: {},
        },
      };
    }
  };
  // rpc.handle in DSH 0.2.1-rc.3 accesses the caller's webServer directly.
  // Public exact Fetch routes use the shared authenticated carrier and admit
  // owner peers only. They are also supported by Desktop's dsh-app forwarding.
  for (const operation of [
    'status',
    'editing-status',
    'editing-action',
    'configure',
    'login',
    'spaces',
    'sharing',
    'recent',
    'nodes',
    'content',
    'create',
    'editor-http',
    'associate',
    'index',
    'current',
    'metadata',
    'html-source',
    'mutate',
    'trash',
  ]) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `/api/space/${operation}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            if (
              !request.headers
                .get('content-type')
                ?.startsWith('application/json')
            )
              return new Response('JSON required', { status: 415 });
            const raw = await request.text();
            if (
              raw.length >
              (operation === 'editor-http' ? 8 * 1024 * 1024 : 16384)
            )
              return new Response('Request too large', { status: 413 });
            let message;
            try {
              message = JSON.parse(raw);
            } catch {
              return new Response('Invalid JSON', { status: 400 });
            }
            if (
              message?.type !== 'client-request' ||
              typeof message.rpcId !== 'string' ||
              message.method !== `space/${operation}`
            )
              return new Response('Invalid RPC envelope', { status: 400 });
            const result = await handle(
              operation,
              message.payload,
              request.signal,
            );
            return Response.json(
              { type: 'server-response', rpcId: message.rpcId, result },
              { headers: { 'cache-control': 'no-store' } },
            );
          },
        }),
      `Space: ${operation} Connection route`,
    );
  }
}
