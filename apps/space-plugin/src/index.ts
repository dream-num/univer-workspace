import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-client-connection';
import { SpaceError, WorkspaceConnection } from './workspace.js';

export const name = 'space-plugin';
export const inject = ['webServer', 'connection'];

export function apply(ctx: Context) {
  const workspace = new WorkspaceConnection();
  ctx.effect(() => () => workspace.dispose());
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/space-plugin/api',
    async handler(req, res) {
      // Same public trust fence used by official DSH HTTP extensions.
      const rejection = ctx.connection.requestRejection(req);
      if (rejection !== undefined) { res.writeHead(rejection); res.end(); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try {
        const url = new URL(req.url!, 'http://localhost');
        const path = url.pathname.slice('/space-plugin/api'.length);
        let result: unknown;
        if (req.method === 'GET' && path === '/status') result = await workspace.status();
        else if (req.method === 'POST' && path === '/configure') {
          const { endpoint } = await body(req);
          if (typeof endpoint !== 'string') throw new SpaceError(400, 'Endpoint is required.');
          workspace.configure(endpoint); result = await workspace.status();
        } else if (req.method === 'POST' && path === '/login') {
          const { username, password } = await body(req);
          if (typeof username !== 'string' || typeof password !== 'string') throw new SpaceError(400, 'Username and password are required.');
          result = await workspace.login(username, password);
        } else if (req.method === 'GET' && path === '/spaces') result = await workspace.json('/api/spaces');
        else if (req.method === 'GET' && path === '/nodes') {
          const parent = url.searchParams.get('parent');
          const space = url.searchParams.get('space');
          if (!parent && !space) throw new SpaceError(400, 'Space or parent Node required.');
          const upstream = parent ? `/api/nodes/${encodeURIComponent(parent)}/children` : `/api/spaces/${encodeURIComponent(space!)}/nodes`;
          const query = new URLSearchParams({ limit: '100' });
          if (url.searchParams.get('cursor')) query.set('cursor', url.searchParams.get('cursor')!);
          result = await workspace.json(`${upstream}?${query}`);
        } else if (req.method === 'GET' && path === '/content') {
          const node = url.searchParams.get('node');
          if (!node) throw new SpaceError(400, 'Node required.');
          result = await workspace.read(node);
        } else throw new SpaceError(404, 'Unknown Space plugin operation.');
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = error instanceof SpaceError ? error.status : 500;
        res.end(JSON.stringify({ error: error instanceof SpaceError ? error.message : 'Space request failed or was canceled.' }));
      }
    },
  }), 'Space: authenticated read-only Workspace routes');
}

async function body(req: import('node:http').IncomingMessage): Promise<any> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new SpaceError(415, 'JSON required.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new SpaceError(413, 'Request too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new SpaceError(400, 'Invalid JSON.'); }
}
