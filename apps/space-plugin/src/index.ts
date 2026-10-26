import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import { SpaceError, WorkspaceConnection } from './workspace.js';

export const name = 'space-plugin';
export const inject = ['connection'];

/** Use the public Connection carrier; no webServer or Desktop-private IPC. */
export function apply(ctx: Context) {
  const workspace = new WorkspaceConnection();
  ctx.effect(() => () => workspace.dispose());
  const handle = async (operation: string, payload: unknown, signal: AbortSignal) => {
    try {
      signal.throwIfAborted();
      const input = payload as Record<string, unknown> | null;
      const string = (key: string, optional = false): string => {
        const value = input?.[key];
        if (optional && value === undefined) return '';
        if (typeof value !== 'string' || value.length > 4096) throw new SpaceError(400, `Invalid ${key}.`);
        return value;
      };
      let value: unknown;
      switch (operation) {
        case 'status': value = await workspace.status(); break;
        case 'configure': workspace.configure(string('endpoint')); value = await workspace.status(); break;
        case 'login': value = await workspace.login(string('username'), string('password')); break;
        case 'recent': {
          const query = new URLSearchParams({ limit: '100' });
          const cursor = string('cursor', true); if (cursor) query.set('cursor', cursor);
          value = await workspace.json(`/api/recent-resources?${query}`, { signal }); break;
        }
        case 'spaces': value = await workspace.json('/api/spaces', { signal }); break;
        case 'nodes': {
          const parent = string('parent', true);
          const space = string('space', true);
          if (!parent && !space) throw new SpaceError(400, 'Space or parent required.');
          const upstream = parent ? `/api/nodes/${encodeURIComponent(parent)}/children` : `/api/spaces/${encodeURIComponent(space)}/nodes`;
          const query = new URLSearchParams({ limit: '100' });
          const cursor = string('cursor', true);
          if (cursor) query.set('cursor', cursor);
          value = await workspace.json(`${upstream}?${query}`, { signal });
          break;
        }
        case 'content': value = await workspace.read(string('node')); break;
        default: throw new SpaceError(404, 'Unknown Space operation.');
      }
      signal.throwIfAborted();
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: { code: String(error instanceof SpaceError ? error.status : 500), message: error instanceof SpaceError ? error.message : 'Space request failed or was canceled.', details: {} } };
    }
  };
  // rpc.handle in DSH 0.2.1-rc.3 accesses the caller's webServer directly.
  // Public exact Fetch routes use the shared authenticated carrier and admit
  // owner peers only. They are also supported by Desktop's dsh-app forwarding.
  for (const operation of ['status', 'configure', 'login', 'spaces', 'recent', 'nodes', 'content']) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: `/api/space/${operation}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response('JSON required', { status: 415 });
        const raw = await request.text();
        if (raw.length > 16384) return new Response('Request too large', { status: 413 });
        let message;
        try { message = JSON.parse(raw); } catch { return new Response('Invalid JSON', { status: 400 }); }
        if (message?.type !== 'client-request' || typeof message.rpcId !== 'string' || message.method !== `space/${operation}`) return new Response('Invalid RPC envelope', { status: 400 });
        const result = await handle(operation, message.payload, request.signal);
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result }, { headers: { 'cache-control': 'no-store' } });
      },
    }), `Space: ${operation} Connection route`);
  }
}
