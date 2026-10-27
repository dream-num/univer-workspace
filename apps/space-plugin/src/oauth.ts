import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { SpaceError, WorkspaceConnection, normalizeEndpoint } from './workspace.js';

// Adapted directly from apps/agent/src/oauth-authorization.ts (beginOAuth /
// exchangeOAuth). Same deployed public Client, scopes, S256, TTL and token
// contract. DSH owns its Session runtime; only the return carrier differs.
export const DEFAULT_WORKSPACE = 'https://space.univer.ai';
export const OAUTH_CLIENT = 'univer-workspace-harness';
export const CALLBACK_PATH = '/auth/oauth/callback';
export const CALLBACK_PORT = 3101;
const TTL = 10 * 60_000;
type Phase = 'idle' | 'waiting' | 'exchanging' | 'succeeded' | 'cancelled' | 'expired' | 'failed';
interface Saved { version: 1; endpoint: string; token?: string; userId?: string }
export interface AuthStorage {
  read(): Promise<unknown>;
  write(value: Saved): Promise<void>;
}
interface Pending {
  state: string; verifier: string; origin: string; redirectUri: string;
  expiresAt: number; version: number; desktop: boolean; abort: AbortController;
}

/** Owner-started, bounded loopback listener; no unauthenticated control API. */
export class WorkspaceOAuth {
  private server?: Server;
  private pending?: Pending;
  private phase: Phase = 'idle';
  private version = 0;
  private writes = Promise.resolve();
  private durable?: Saved;
  private callbacks = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setTimeout>;
  private ready: Promise<void>;
  private message = '';
  constructor(
    private workspace: WorkspaceConnection,
    private storage: AuthStorage,
    private changed: () => void,
    private port = CALLBACK_PORT,
    private now = Date.now,
  ) { this.ready = this.restore(); }

  private async restore() {
    let saved: any;
    try { saved = await this.storage.read(); }
    catch { this.message = '无法读取 Workspace 登录状态，请重试。'; }
    let endpoint = DEFAULT_WORKSPACE;
    if (saved?.version === 1) {
      try { endpoint = normalizeEndpoint(saved.endpoint); this.durable = saved; }
      catch { saved = undefined; }
    } else saved = undefined;
    try {
      this.workspace.configure(normalizeEndpoint(endpoint));
      if (saved?.token && typeof saved.userId === 'string') {
        // Server checks still gate identity and content; offline startup keeps
        // the saved grant available for an authenticated retry.
        this.workspace.activateSession(endpoint, saved.token);
        const user = await this.verify(endpoint, saved.token);
        if (user.id !== saved.userId) throw new SpaceError(401, 'Workspace identity changed.');
        this.workspace.activateSession(endpoint, saved.token);
      }
    } catch (error) {
      // A temporary network failure must not erase a reusable durable grant.
      if (error instanceof SpaceError && error.status === 401) {
        this.workspace.clearSession();
        await this.save({ version: 1, endpoint: this.workspace.endpoint || DEFAULT_WORKSPACE })
          .catch(() => { this.message = '无法保存 Workspace 登录状态，请重试。'; });
      } else this.message = 'Workspace 暂时无法连接，可以重试。';
    }
  }
  private save(saved: Saved) {
    let previous: Saved | undefined;
    const write = this.writes.catch(() => {}).then(async () => {
      previous = this.durable;
      await this.storage.write(saved);
      this.durable = saved;
    });
    this.writes = write;
    return write.then(() => previous);
  }
  private rollback(candidate: Saved, previous: Saved | undefined) {
    const write = this.writes.catch(() => {}).then(async () => {
      // A later successful sign-in, Sign Out or Server change owns its record.
      // An old callback must never overwrite that newer durable state.
      if (this.durable !== candidate) return;
      const restored = previous ?? { version: 1 as const, endpoint: this.workspace.endpoint || DEFAULT_WORKSPACE };
      await this.storage.write(restored);
      this.durable = restored;
    });
    this.writes = write;
    return write;
  }
  private async verify(origin: string, token: string, signal?: AbortSignal) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{16,4096}$/.test(token)) throw new Error('Invalid session');
    const response = await fetch(new URL('/api/session', origin), {
      redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
      headers: { accept: 'application/json', cookie: `workspace_session=${token}` },
    });
    if (!response.ok) throw new SpaceError(response.status === 401 || response.status === 403 ? 401 : 502, 'Workspace 授权验证失败，请重试。');
    const session = await response.json();
    if (session.authenticated !== true || typeof session.user?.id !== 'string') throw new SpaceError(401, 'Workspace 登录已过期，请重新授权。');
    return session.user;
  }
  async status() {
    await this.ready;
    if (this.pending && this.pending.expiresAt <= this.now()) this.cancel('expired');
    return { ...(await this.workspace.status()), oauth: { phase: this.phase, message: this.message } };
  }
  private invalidate() {
    this.version++;
    this.pending?.abort.abort();
    this.pending = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    const server = this.server;
    this.server = undefined;
    server?.close();
    // Do not terminate the in-flight callback response; it has a bounded exchange.
    server?.closeIdleConnections();
  }
  cancel(phase: 'cancelled' | 'expired' = 'cancelled') {
    this.invalidate();
    this.phase = phase;
    this.message = phase === 'expired' ? '登录请求已过期，请重试。' : '已取消登录，可以随时重试。';
  }
  async configure(endpoint: string) {
    await this.ready;
    const next = normalizeEndpoint(endpoint || DEFAULT_WORKSPACE);
    this.invalidate(); this.phase = 'idle'; this.message = '';
    const previous = this.workspace.endpoint;
    const status = await this.workspace.connect(next);
    if (next !== previous) this.changed();
    this.phase = 'idle'; this.message = '';
    const token = this.workspace.sessionCookie.match(/^workspace_session=(.+)$/)?.[1];
    await this.save({ version: 1, endpoint: next, ...(token ? { token, userId: status.user?.id } : {}) });
    return this.status();
  }
  async signOut() {
    await this.ready;
    this.invalidate();
    // Revoke just this Workspace grant. Local removal still works offline.
    const cookie = this.workspace.sessionCookie;
    const origin = this.workspace.endpoint;
    const revoke = cookie ? fetch(new URL('/api/auth/logout', origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { cookie, origin, 'content-type': 'application/json' },
    }).catch(() => {}) : Promise.resolve();
    this.workspace.clearSession(); this.changed();
    this.phase = 'idle'; this.message = '';
    await this.save({ version: 1, endpoint: this.workspace.endpoint });
    await revoke;
    return this.status();
  }
  async start(desktop: boolean) {
    await this.ready;
    this.invalidate(); this.message = '';
    const version = this.version;
    const server = createServer((req, res) => {
      const operation = this.callback(req, res).catch(() => { res.destroy(); });
      this.callbacks.add(operation);
      void operation.finally(() => this.callbacks.delete(operation));
    });
    this.server = server;
    server.requestTimeout = 15_000; server.headersTimeout = 10_000;
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
      if (version !== this.version) { server.close(); throw new Error('Superseded'); }
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No callback listener');
      const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
      const origin = this.workspace.endpoint;
      this.pending = { state, verifier, origin, redirectUri, version, desktop, expiresAt: this.now() + TTL, abort: new AbortController() };
      const url = new URL('/api/auth/authorize', origin);
      url.search = new URLSearchParams({ client_id: OAUTH_CLIENT, redirect_uri: redirectUri, state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), scope: 'identity session', response_type: 'code', code_challenge_method: 'S256' }).toString();
      this.phase = 'waiting';
      this.timer = setTimeout(() => this.cancel('expired'), TTL); this.timer.unref(); server.unref();
      return { authorizationUrl: url.href };
    } catch {
      if (version === this.version) { this.invalidate(); this.phase = 'failed'; this.message = '无法开始浏览器登录，请关闭其他登录请求后重试。'; }
      throw new SpaceError(409, this.message || '登录请求已更新，请重试。');
    }
  }
  private async callback(req: IncomingMessage, res: ServerResponse) {
    let outcome = false, desktop = false;
    const entry = this.pending;
    let admitted = false;
    try {
      if (req.method !== 'GET' || !entry || this.phase !== 'waiting') throw new Error('No request');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.host !== new URL(entry.redirectUri).host || url.origin !== 'http://127.0.0.1' || url.pathname !== CALLBACK_PATH ||
          [...url.searchParams.keys()].some(key => !['state', 'code', 'error', 'error_description', 'scope'].includes(key)) ||
          [...new Set(url.searchParams.keys())].some(key => url.searchParams.getAll(key).length !== 1) ||
          url.searchParams.get('state') !== entry.state || entry.expiresAt <= this.now() || entry.version !== this.version || entry.origin !== this.workspace.endpoint)
        throw new Error('Invalid callback');
      desktop = entry.desktop;
      if (url.searchParams.has('error')) { this.cancel(); this.reply(res, false, desktop); return; }
      const code = url.searchParams.get('code');
      if (!code || code.length > 2048) throw new Error('Invalid code');
      admitted = true;
      this.phase = 'exchanging'; // Reject concurrent replay before the first await.
      const response = await fetch(new URL('/api/auth/token', entry.origin), {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', client_id: OAUTH_CLIENT, redirect_uri: entry.redirectUri, code, code_verifier: entry.verifier }),
        signal: AbortSignal.any([entry.abort.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw new Error('Exchange failed');
      const body = await response.json();
      if (typeof body.user?.id !== 'string' || typeof body.user?.username !== 'string') throw new Error('Invalid identity');
      const user = await this.verify(entry.origin, body.access_token, entry.abort.signal);
      const current = () => this.pending === entry && entry.version === this.version && entry.expiresAt > this.now() && entry.origin === this.workspace.endpoint;
      if (!current() || user.id !== body.user.id) throw new Error('Stale identity');
      const candidate: Saved = { version: 1, endpoint: entry.origin, token: body.access_token, userId: user.id };
      const previous = await this.save(candidate);
      if (!current()) {
        // A cancellation during the durable write must not resurrect it on restart.
        await this.rollback(candidate, previous);
        throw new Error('Stale authorization');
      }
      this.workspace.activateSession(entry.origin, body.access_token);
      this.changed(); desktop = entry.desktop; outcome = true;
      this.invalidate(); this.phase = 'succeeded'; this.message = '';
    } catch {
      if (admitted && this.pending === entry && this.phase === 'exchanging') { this.invalidate(); this.phase = 'failed'; this.message = '登录未完成，请重新授权。'; }
    }
    this.reply(res, outcome, desktop);
  }
  private reply(res: ServerResponse, success: boolean, desktop: boolean) {
    const nonce = randomBytes(18).toString('base64url');
    res.writeHead(success ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', connection: 'close', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'` });
    // Never render callback query fields, code, token, or identity. The installed
    // official Desktop's credential-free dsh://open handler only focuses its window.
    res.end(`<!doctype html><meta charset="utf-8"><title>Univer sign in</title><style>body{font:16px system-ui;display:grid;min-height:90vh;place-items:center}main{max-width:400px;padding:32px}p{color:#666;line-height:1.6}</style><main><h1>${success ? 'You’re signed in' : 'Sign in was not completed'}</h1><p>${success ? 'Your Workspace is ready. Return to DeepSeek Harness to continue.' : 'Return to DeepSeek Harness and try signing in again.'}</p>${desktop ? '<a href="dsh://open">Return to DeepSeek Harness</a>' : ''}</main><script nonce="${nonce}">history.replaceState(null,'','${CALLBACK_PATH}');${desktop ? "location.replace('dsh://open');" : ''}</script>`);
  }
  async dispose() {
    const server = this.server;
    this.invalidate();
    await this.ready;
    await Promise.allSettled([...this.callbacks]);
    await this.writes.catch(() => {});
    server?.closeAllConnections();
  }
}
