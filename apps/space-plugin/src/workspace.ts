import type { Content, OpenFile } from './model.js';
import { createHash } from 'node:crypto';
import { RuntimeManager } from '@univerjs/univer-workspace-agent-runtime';
import { inspectionQuery } from '@univerjs/univer-workspace-agent-runtime/workspace-inspection';
import {
  transformSnapshotToDocumentData,
  transformSnapshotToWorkbookData,
  transformSnapshotToSlideData,
  transformSnapshotToBoardData,
  transformSnapshotToBaseData,
} from '@univerjs-pro/collaboration';
import { UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { contentType } from './content-types.js';

export class SpaceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SpaceError(400, 'Endpoint must be a valid HTTP(S) origin.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new SpaceError(
      400,
      'Endpoint must be an HTTP(S) origin without credentials or a path.',
    );
  if (
    url.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new SpaceError(400, 'Use HTTPS for a remote Workspace.');
  return url.origin;
}

/** Plugin-owned connection only; no credentials, second Agent, or chat history in the client. */
export class WorkspaceConnection {
  readonly license = process.env.UNIVER_LICENSE ?? '';
  endpoint = '';
  private contentGeneration = 0;
  private htmlCache = new Map<string, { html: string; etag: string | null; sha256?: string }>();
  get contentVersion() { return this.contentGeneration; }
  noteContentChanged() { this.contentGeneration++; }
  get sessionCookie() { return this.cookie; }
  /** Aborted whenever the active endpoint or Workspace credential changes. */
  get identitySignal() { return this.lifetime.signal; }
  /** Activate only a server-verified Workspace credential; never a DSH identity. */
  activateSession(endpoint: string, token: string) {
    if (!/^[A-Za-z0-9._~-]{16,4096}$/.test(token)) throw new SpaceError(400, 'Invalid Workspace session.');
    this.configure(endpoint);
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.cookie = `workspace_session=${token}`;
    this.htmlCache.clear();
  }
  clearSession() {
    this.loginAttempt++;
    this.loginAbort?.abort();
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.cookie = '';
    this.htmlCache.clear();
  }
  private runtime = new RuntimeManager(new URL('./workspace-content-worker.js', import.meta.url));
  /** Host-only credential boundary. No credential enters Tool results or UI. */
  private draftTarget(file: { endpoint: string; unitId: string; type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' }, worktreeId: string, revision = -1) {
    const token = this.cookie.match(/(?:^|; )workspace_session=([^;]+)/)?.[1];
    if (!token || this.endpoint !== file.endpoint) throw new SpaceError(401, 'Workspace identity changed.');
    return { origin: this.endpoint, sessionToken: token, license: this.license, revision, scope: { kind: 'worktree' as const, worktreeId }, unitId: file.unitId, unitType: file.type };
  }
  async executeDraft(file: { endpoint: string; unitId: string; type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' }, worktreeId: string, code: string, revision = -1, signal?: AbortSignal) {
    return this.runtime.writeAndCommit(this.draftTarget(file, worktreeId, revision), code, signal ? AbortSignal.any([signal, this.identitySignal]) : this.identitySignal);
  }
  /** Commit through the original collaboration runtime and authenticated trunk endpoints. */
  async executeTrunk(
    file: { endpoint: string; unitId: string; type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' },
    code: string,
    signal: AbortSignal,
    revision = -1,
  ) {
    const token = this.cookie.match(/(?:^|; )workspace_session=([^;]+)/)?.[1];
    if (!token || this.endpoint !== file.endpoint) throw new SpaceError(401, 'Workspace identity changed.');
    const identity = this.lifetime.signal;
    const result = await this.runtime.writeTrunkAndCommit({
      origin: this.endpoint, sessionToken: token, license: this.license, revision,
      scope: { kind: 'trunk' }, unitId: file.unitId, unitType: file.type,
    }, code, AbortSignal.any([signal, identity]));
    if (result.committed) this.noteContentChanged();
    return result;
  }
  async readUnit(file: { endpoint: string; unitId: string; type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' }, code: string, revision = -1) {
    return this.runtime.read(this.unitTarget(file, undefined, revision), code);
  }
  async readUnitDraft(file: { endpoint: string; unitId: string; type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' }, worktreeId: string, code: string, revision = -1) {
    return this.runtime.read(this.unitTarget(file, worktreeId, revision), code);
  }
  async exportUnitData(file: { endpoint: string; unitId: string; type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' }, worktreeId?: string, revision = -1) {
    return this.runtime.exportUnitData(this.unitTarget(file, worktreeId, revision));
  }
  private unitTarget(file: { endpoint: string; unitId: string; type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' }, worktreeId?: string, revision = -1) {
    const token = this.cookie.match(/(?:^|; )workspace_session=([^;]+)/)?.[1];
    if (!token || this.endpoint !== file.endpoint) throw new SpaceError(401, 'Workspace identity changed.');
    return { origin: this.endpoint, sessionToken: token, license: this.license, revision,
      scope: worktreeId ? { kind: 'worktree' as const, worktreeId } : { kind: 'trunk' as const },
      unitId: file.unitId, unitType: file.type };
  }
  async inspectUnit(file: { endpoint: string; unitId: string; type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' }, range?: string, revision = -1, worktreeId?: string) {
    return this.runtime.inspect(this.unitTarget(file, worktreeId, revision), inspectionQuery(file.type, range));
  }
  async inspectDraft(file: { endpoint: string; unitId: string; type: 'doc' | 'sheet' }, worktreeId: string, sheet?: string, range?: string) {
    if (range && (!sheet || file.type !== 'sheet')) throw new SpaceError(400, 'A worksheet name is required for a Sheet range.');
    return this.runtime.inspect(this.draftTarget(file, worktreeId), file.type === 'doc' ? { kind: 'document' } : range ? { kind: 'worksheet-range', ranges: [{ worksheet: { name: sheet! }, range }] } : { kind: 'workbook' });
  }
  private cookie = '';
  private lifetime = new AbortController();
  private connectAttempt = 0;
  private connectAbort: AbortController | undefined;
  private loginAttempt = 0;
  private loginAbort: AbortController | undefined;
  private pending = new Set<Promise<unknown>>();
  private materializer = new UnitSnapshotMaterializer({
    execution: { mode: 'in-process' },
  });

  configure(endpoint: string) {
    const next = endpoint ? normalizeEndpoint(endpoint) : '';
    this.connectAttempt++;
    this.connectAbort?.abort();
    if (next === this.endpoint) return false;
    this.loginAttempt++;
    this.loginAbort?.abort();
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.cookie = '';
    this.htmlCache.clear();
    this.endpoint = next;
    return true;
  }

  /** Validate a new service before replacing the authenticated connection. */
  async connect(endpoint: string, signal?: AbortSignal) {
    const next = endpoint ? normalizeEndpoint(endpoint) : '';
    const attempt = ++this.connectAttempt;
    this.connectAbort?.abort();
    const controller = (this.connectAbort = new AbortController());
    if (next && next !== this.endpoint) {
      const combined = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(10000),
        ...(signal ? [signal] : []),
      ]);
      try {
        const response = await fetch(new URL('/api/session', next), {
          redirect: 'error',
          signal: combined,
          headers: { accept: 'application/json' },
        });
        if (
          !response.ok ||
          typeof (await response.json()).authenticated !== 'boolean'
        )
          throw new Error('Invalid service');
      } catch {
        throw new SpaceError(502, '无法连接这个 Workspace，请检查服务地址。');
      }
    }
    if (attempt !== this.connectAttempt)
      throw new SpaceError(409, 'This connection attempt was superseded.');
    this.configure(next);
    return this.status();
  }

  async dispose() {
    this.connectAttempt++;
    this.connectAbort?.abort();
    this.loginAttempt++;
    this.loginAbort?.abort();
    this.lifetime.abort();
    this.cookie = '';
    this.htmlCache.clear();
    await Promise.allSettled([...this.pending]);
    await this.runtime.close();
    await this.materializer.dispose();
  }

  async request(path: string, init: RequestInit = {}) {
    if (!this.endpoint)
      throw new SpaceError(409, 'Workspace is not configured.');
    const signal = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(20000),
      ...(init.signal ? [init.signal] : []),
    ]);
    try {
      const response = await fetch(new URL(path, this.endpoint), {
        ...init,
        redirect: 'error',
        signal,
        headers: {
          'content-type': 'application/json',
          ...Object.fromEntries(new Headers(init.headers)),
          ...(this.cookie ? { cookie: this.cookie } : {}),
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new SpaceError(
          response.status,
          body?.error?.message ??
            body?.message ??
            `Workspace returned HTTP ${response.status}.`,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof SpaceError) throw error;
      throw new SpaceError(
        502,
        signal.aborted
          ? 'Workspace request canceled or timed out.'
          : 'Cannot reach Workspace.',
      );
    }
  }

  /** Original Blob workflows need raw HTTP status and network failures for retry recovery. */
  async rawRequest(path: string, init: RequestInit = {}) {
    if (!this.endpoint) throw new SpaceError(409, 'Workspace is not configured.');
    const target = new URL(path, this.endpoint);
    if (target.origin !== this.endpoint || !path.startsWith('/api/')) throw new SpaceError(400, 'Invalid Workspace API path.');
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(20000), ...(init.signal ? [init.signal] : [])]);
    return fetch(target, { ...init, redirect: 'error', signal,
      headers: { ...Object.fromEntries(new Headers(init.headers)), ...(this.cookie ? { cookie: this.cookie } : {}) } });
  }
  async json(path: string, init: RequestInit = {}): Promise<any> {
    return (await this.request(path, init)).json();
  }

  async login(username: string, password: string) {
    const lifetime = this.lifetime,
      attempt = ++this.loginAttempt;
    this.loginAbort?.abort();
    const controller = (this.loginAbort = new AbortController());
    const response = await this.request('/api/auth/password/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
    lifetime.signal.throwIfAborted();
    if (attempt !== this.loginAttempt)
      throw new SpaceError(409, 'This sign-in was superseded.');
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    if (!cookie)
      throw new SpaceError(
        502,
        'Workspace login did not issue a session cookie.',
      );
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.cookie = cookie;
    this.htmlCache.clear();
    return this.status();
  }

  async status() {
    if (!this.endpoint) return { state: 'unconfigured', endpoint: '' };
    try {
      const session = await this.json('/api/session');
      return {
        state: session.authenticated ? 'connected' : 'unauthenticated',
        endpoint: this.endpoint,
        user: session.user ?? null,
      };
    } catch (error) {
      return {
        state:
          error instanceof SpaceError && [401, 403].includes(error.status)
            ? 'unauthenticated'
            : 'network-error',
        endpoint: this.endpoint,
      };
    }
  }

  /** Aggregate metadata using existing ACL-checked product endpoints; never load bodies. */
  async index(signal: AbortSignal) {
    const lifetime = this.lifetime;
    const read = (path: string) =>
      this.json(path, { signal: AbortSignal.any([signal, lifetime.signal]) });
    const { spaces } = await read('/api/spaces');
    const nodes: any[] = [];
    const sharedNodeIds: string[] = [];
    const seen = new Set<string>();
    const queue: { space: string; parent?: string }[] = spaces.map(
      (space: any) => ({
        space: space.id,
      }),
    );
    // Direct Personal shares do not grant browseRoot on the owner's Space.
    // Discover their authorized roots through the same Browser Shared view API.
    let sharedCursor = '';
    do {
      const page = await read(
        `/api/shared-with-me?${new URLSearchParams({ limit: '100', ...(sharedCursor ? { cursor: sharedCursor } : {}) })}`,
      );
      for (const { node } of page.items) {
        sharedNodeIds.push(node.id);
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        nodes.push(node);
        if (!node.resource && node.capabilities?.browseChildren)
          queue.push({ space: node.spaceId, parent: node.id });
      }
      sharedCursor = page.nextCursor ?? '';
    } while (sharedCursor);
    while (queue.length) {
      const location = queue.shift()!;
      let cursor = '';
      do {
        const path = location.parent
          ? `/api/nodes/${encodeURIComponent(location.parent)}/children`
          : `/api/spaces/${encodeURIComponent(location.space)}/nodes`;
        const page = await read(
          `${path}?${new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) })}`,
        );
        for (const node of page.nodes) {
          if (seen.has(node.id)) continue;
          seen.add(node.id);
          nodes.push(node);
          if (nodes.length > 2000)
            throw new SpaceError(
              413,
              'All index exceeds 2,000 items. Browse individual Spaces instead.',
            );
          if (!node.resource && node.capabilities?.browseChildren)
            queue.push({ space: location.space, parent: node.id });
        }
        cursor = page.nextCursor ?? '';
      } while (cursor);
    }
    const htmlIds = new Set<string>();
    let htmlCursor = '';
    do {
      const page = await read(
        `/api/html-views?${new URLSearchParams({ limit: '100', ...(htmlCursor ? { cursor: htmlCursor } : {}) })}`,
      );
      for (const item of page.items) {
        htmlIds.add(item.node.id);
        // Pages can parent Pages. The directory scan above walks Folders only;
        // retain authorized nested Pages from the existing HTML Views index.
        if (!seen.has(item.node.id)) {
          seen.add(item.node.id);
          nodes.push({ ...item.node, resource: item.resource });
          if (nodes.length > 2000)
            throw new SpaceError(413, 'All index exceeds 2,000 items. Browse individual Spaces instead.');
        }
      }
      htmlCursor = page.nextCursor ?? '';
    } while (htmlCursor);
    for (const node of nodes)
      if (htmlIds.has(node.id) && node.resource?.kind === 'blob')
        node.resource = { ...node.resource, htmlView: true };
    lifetime.signal.throwIfAborted();
    return { nodes, sharedNodeIds, scope: 'accessible-spaces', complete: true };
  }

  /** SDK HTTP only, bound to the same Workspace endpoint and authenticated user.
   * No cookies/DSH credentials cross into the editor. WS uses the SDK's one-time ticket.
   * Server ACLs authorize every Unit read/mutation; no snapshot replacement endpoint.
   */
  async editorRequest(
    input: {
      endpoint: string;
      userId: string;
      path: string;
      method: string;
      body: string | null;
    },
    signal: AbortSignal,
  ) {
    const lifetime = this.lifetime;
    if (input.endpoint !== this.endpoint)
      throw new SpaceError(
        409,
        'Workspace connection changed. Reopen the file.',
      );
    const session = await this.status();
    if (
      lifetime !== this.lifetime ||
      session.state !== 'connected' ||
      session.user?.id !== input.userId
    )
      throw new SpaceError(
        401,
        'Workspace identity changed. Sign in and reopen the file.',
      );
    // Accept relative SDK routes only. Never accept authority, traversal, Worktree or product writes.
    if (
      !/^\/universer-api\/(?:snapshot\/|history\/[^/?]+\/(?:list|creators|cs)(?:\?|$)|file\/[^/?]+\/sign-url(?:\?|$)|exchange\/(?:import|[^/?]+\/(?:import|export)|task\/[^/?]+)(?:\?|$)|comb(?:\/|$)|authz(?:\/|$)|comment\/unit\/[^/?]+\/(?:list|add|reply|solved|edit|delete)(?:\?|$)|user\/(?:session-ticket|list)(?:\?|$))/.test(
        input.path,
      ) ||
      input.path.includes('..') ||
      input.path.includes('\\') ||
      input.path.includes('#') ||
      !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method)
    )
      throw new SpaceError(400, 'Unsupported collaborative editor request.');
    const target = new URL(input.path, this.endpoint);
    if (
      !target.pathname.startsWith('/universer-api/') ||
      target.pathname !== input.path.split('?')[0] ||
      ((target.pathname.startsWith('/universer-api/snapshot/') ||
        target.pathname.startsWith('/universer-api/history/') ||
        target.pathname.startsWith('/universer-api/file/')) && input.method !== 'GET') ||
      (target.pathname.startsWith('/universer-api/exchange/task/') && input.method !== 'GET') ||
      (target.pathname.startsWith('/universer-api/exchange/') && !target.pathname.startsWith('/universer-api/exchange/task/') && input.method !== 'POST')
    )
      throw new SpaceError(
        400,
        'Unsupported collaborative editor path or snapshot write.',
      );
    const response = await fetch(target, {
      method: input.method,
      body: input.body,
      redirect: 'error',
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      signal: AbortSignal.any([
        signal,
        lifetime.signal,
        AbortSignal.timeout(30000),
      ]),
    });
    let body = await response.text();
    const asset = /^\/universer-api\/file\/([^/]+)\/sign-url$/.exec(target.pathname);
    if (asset && response.ok) {
      const value = JSON.parse(body) as { url?: unknown };
      // The deployed Server may return a signed storage URL instead of the Fork's content route.
      // Preserve SDK error envelopes and proxy successful URLs through the authenticated owner route.
      if (value.url !== undefined) {
        assetContentURL(value.url, this.endpoint);
        const query = new URLSearchParams({ endpoint: input.endpoint, userId: input.userId, fileId: decodeURIComponent(asset[1]!) });
        value.url = `/api/space/editor-asset?${query}`;
        body = JSON.stringify(value);
      }
    }
    lifetime.signal.throwIfAborted();
    return { status: response.status, statusText: response.statusText, body };
  }

  /** Stream an SDK multipart upload through the existing owner Connection. */
  async editorUpload(input: { endpoint: string; userId: string; path: string }, request: Request) {
    const identity = this.lifetime;
    if (input.endpoint !== this.endpoint) throw new SpaceError(409, 'Workspace connection changed.');
    const status = await this.status();
    if (identity !== this.lifetime || status.state !== 'connected' || status.user?.id !== input.userId) throw new SpaceError(401, 'Workspace identity changed.');
    if (!/^\/universer-api\/stream\/file\/upload(?:\?|$)/.test(input.path) || input.path.includes('..') || input.path.includes('\\') || input.path.includes('#')) throw new SpaceError(400, 'Unsupported editor upload path.');
    const target = new URL(input.path, this.endpoint);
    if (target.origin !== this.endpoint || target.pathname !== '/universer-api/stream/file/upload') throw new SpaceError(400, 'Unsupported editor upload path.');
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data; boundary=') || !request.body) throw new SpaceError(400, 'Multipart upload required.');
    const response = await fetch(target, {
      method: 'POST', headers: { 'content-type': contentType, cookie: this.cookie }, body: request.body,
      duplex: 'half', redirect: 'error', signal: AbortSignal.any([request.signal, identity.signal, AbortSignal.timeout(120000)]),
    } as RequestInit & { duplex: 'half' });
    identity.signal.throwIfAborted();
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
  }

  /** Forward only a Server-authorized image/export file; cookies remain in Host memory. */
  async editorAsset(input: { endpoint: string; userId: string; fileId: string }, request: Request) {
    const identity = this.lifetime;
    if (input.endpoint !== this.endpoint) throw new SpaceError(409, 'Workspace connection changed.');
    const status = await this.status();
    if (identity !== this.lifetime || status.state !== 'connected' || status.user?.id !== input.userId) throw new SpaceError(401, 'Workspace identity changed.');
    if (!input.fileId || input.fileId.length > 256 || /[\\/]/.test(input.fileId)) throw new SpaceError(400, 'Invalid asset identity.');
    const signed = await this.json(`/universer-api/file/${encodeURIComponent(input.fileId)}/sign-url`, { signal: AbortSignal.any([request.signal, identity.signal]) });
    identity.signal.throwIfAborted();
    const contentURL = assetContentURL(signed.url, this.endpoint);
    const range = request.headers.get('range');
    const response = await fetch(contentURL, { headers: {
      ...(contentURL.origin === this.endpoint ? { cookie: this.cookie } : {}),
      ...(range ? { range } : {}),
    }, redirect: 'error', signal: AbortSignal.any([request.signal, identity.signal, AbortSignal.timeout(120000)]) });
    identity.signal.throwIfAborted();
    const headers = new Headers();
    for (const name of ['content-type', 'content-length', 'content-disposition', 'content-range', 'accept-ranges', 'etag', 'content-security-policy', 'cross-origin-resource-policy', 'x-content-type-options']) {
      const value = response.headers.get(name); if (value) headers.set(name, value);
    }
    headers.set('cache-control', 'private, no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  /** Existing membership workflow. Identity and ACL are always Server-owned. */
  async sharing(
    input: import('./sharing.js').SharingInput,
    signal: AbortSignal,
  ) {
    const id = encodeURIComponent(input.id ?? ''),
      user = encodeURIComponent(input.user ?? '');
    const options = { signal };
    switch (input.action) {
      case 'file': {
        const metadata = await this.json(`/api/nodes/${id}`, options);
        let space;
        try {
          space = await this.json(
            `/api/spaces/${encodeURIComponent(metadata.node.spaceId)}`,
            options,
          );
        } catch (cause) {
          if (
            !(cause instanceof SpaceError && [403, 404].includes(cause.status))
          )
            throw cause;
        }
        // Team Nodes deliberately have no direct-grant model. Never fall through
        // to Personal grant endpoints or invent a per-file permission override.
        if (metadata.space.type === 'team')
          return {
            node: metadata.node,
            space,
            owner: space?.owner,
            grants: [],
            inherited: [],
            members: space
              ? await this.json(
                  `/api/team-spaces/${encodeURIComponent(space.id)}/members`,
                  options,
                )
              : undefined,
          };
        if (!metadata.node.capabilities.share)
          return {
            node: metadata.node,
            space: space ?? null,
            owner: space?.owner,
            grants: [],
            inherited: [],
          };
        const grants = await this.json(`/api/nodes/${id}/grants`, options);
        const link = await this.json(`/api/nodes/${id}/link-sharing`, options);
        const inherited = [];
        for (const ancestor of metadata.breadcrumbs.filter(
          (a: any) => a.id !== metadata.node.id,
        )) {
          const ancestorId = encodeURIComponent(ancestor.id);
          inherited.push({
            ...ancestor,
            ...(await this.json(`/api/nodes/${ancestorId}/grants`, options)),
            link: await this.json(
              `/api/nodes/${ancestorId}/link-sharing`,
              options,
            ),
          });
        }
        return {
          node: metadata.node,
          space: space ?? null,
          owner: space?.owner,
          ...grants,
          inherited,
          link,
        };
      }
      case 'set-grant':
        if (!['viewer', 'editor'].includes(input.role ?? ''))
          throw new SpaceError(400, 'Invalid file role.');
        return this.json(`/api/nodes/${id}/grants/${user}`, {
          ...options,
          method: 'PUT',
          body: JSON.stringify({ role: input.role }),
        });
      case 'remove-grant':
        return this.json(`/api/nodes/${id}/grants/${user}`, {
          ...options,
          method: 'DELETE',
        });
      case 'link-access':
        if (
          typeof input.enabled !== 'boolean' ||
          !['viewer', 'editor'].includes(input.role ?? '')
        )
          throw new SpaceError(400, 'Invalid link access.');
        return this.json(`/api/nodes/${id}/link-sharing`, {
          ...options,
          method: 'PUT',
          body: JSON.stringify({ enabled: input.enabled, role: input.role }),
        });
      case 'users':
        if (!input.query?.trim() || input.query.length > 100)
          throw new SpaceError(
            400,
            'Enter a name or username (up to 100 characters).',
          );
        return this.json(
          `/api/users/search?${new URLSearchParams({ query: input.query.trim() })}`,
          options,
        );
      case 'members': {
        const space = await this.json(`/api/spaces/${id}`, options);
        if (space.type === 'personal') {
          const session = await this.status();
          return {
            space,
            owner: {
              ...space.owner,
              displayName:
                session.user?.id === space.owner.id
                  ? session.user.displayName
                  : space.owner.username,
            },
            members: [],
          };
        }
        return {
          space,
          ...(await this.json(`/api/team-spaces/${id}/members`, options)),
        };
      }
      case 'set-member':
        if (!['admin', 'editor', 'viewer'].includes(input.role ?? ''))
          throw new SpaceError(400, 'Invalid member role.');
        return this.json(`/api/team-spaces/${id}/members/${user}`, {
          ...options,
          method: 'PUT',
          body: JSON.stringify({ role: input.role }),
        });
      case 'remove-member':
        await this.request(`/api/team-spaces/${id}/members/${user}`, {
          ...options,
          method: 'DELETE',
        });
        return { removed: true };
      case 'space-access':
        if (typeof input.publicRead !== 'boolean')
          throw new SpaceError(400, 'Invalid access setting.');
        return this.json(`/api/spaces/${id}`, {
          ...options,
          method: 'PATCH',
          body: JSON.stringify({ publicRead: input.publicRead }),
        });
      default:
        throw new SpaceError(400, 'Unsupported sharing operation.');
    }
  }

  /** Human creation only. Server resolves identity, parent capabilities and ACL. */
  async create(
    input: {
      kind: string;
      name: string;
      space: string;
      parent: string;
      key: string;
    },
    signal: AbortSignal,
  ) {
    const name = input.name.trim();
    if (!name || name.length > (input.kind === 'space' ? 100 : 255))
      throw new SpaceError(400, 'Enter a valid name.');
    const init = { method: 'POST', signal };
    if (input.kind === 'space')
      return {
        space: await this.json('/api/team-spaces', {
          ...init,
          body: JSON.stringify({ name }),
        }),
      };
    const location = {
      spaceId: input.space,
      parentNodeId: input.parent || null,
      name,
    };
    if (input.kind === 'folder')
      return {
        node: await this.json('/api/nodes', {
          ...init,
          body: JSON.stringify(location),
        }),
      };
    if (input.kind === 'site') {
      // Same reserve -> stream -> complete workflow as Browser node-transfers.ts.
      const html =
        '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
      const filename = `${name}.univer.html`;
      const reserved = await this.json('/api/blob-upload-sessions', {
        ...init,
        headers: { 'Idempotency-Key': input.key },
        body: JSON.stringify({
          ...location,
          originalFilename: filename,
          byteSize: Buffer.byteLength(html),
          declaredMediaType: 'text/html',
        }),
      });
      if (reserved.operation.state === 'completed')
        return this.createdResult(reserved, signal);
      if (!reserved.uploadTarget)
        throw new SpaceError(
          409,
          'Page upload is not ready. Retry this creation.',
        );
      const target = new URL(reserved.uploadTarget.contentUrl, this.endpoint);
      const expected = `/api/blob-upload-sessions/${encodeURIComponent(reserved.upload.id)}/content`;
      if (
        target.origin !== this.endpoint ||
        target.pathname !== expected ||
        target.search ||
        target.hash
      )
        throw new SpaceError(
          502,
          'Workspace returned an invalid upload target.',
        );
      await this.request(expected, {
        method: 'PUT',
        signal,
        headers: { 'content-type': 'application/octet-stream' },
        body: html,
      });
      const result = await this.json(
        `/api/blob-upload-sessions/${encodeURIComponent(reserved.upload.id)}/complete`,
        init,
      );
      return this.createdResult(result, signal);
    }
    if (contentType(input.kind)?.resource !== 'univer')
      throw new SpaceError(400, 'Unsupported creation type.');
    // The product resource workflow owns default data, Unit identity and recovery.
    const result = await this.json('/api/resources', {
      ...init,
      headers: { 'Idempotency-Key': input.key },
      body: JSON.stringify({
        ...location,
        kind: 'univer',
        unitType: input.kind,
      }),
    });
    return this.createdResult(result, signal);
  }

  /** Browser wait-for-created-resource semantics, including durable async recovery. */
  private async createdResult(result: any, signal: AbortSignal) {
    if (result.node) return result;
    let operation = result.operation;
    for (let attempt = 0; attempt <= 60; attempt++) {
      signal.throwIfAborted();
      if (operation?.state === 'failed')
        throw new SpaceError(
          409,
          operation.error?.message || 'Creation failed.',
        );
      if (operation?.state === 'completed' && operation.result?.nodeId)
        return this.json(
          `/api/nodes/${encodeURIComponent(operation.result.nodeId)}`,
          { signal },
        );
      if (!operation?.id || attempt === 60)
        throw new SpaceError(
          409,
          'Creation is still processing. Retry with the same name to recover its result.',
        );
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      operation = await this.json(
        `/api/operations/${encodeURIComponent(operation.id)}`,
        { signal },
      );
    }
  }

  /** Existing product workflows; Server resolves ACL, cycles, Trash and recovery. */
  async mutate(
    input: { action: string; id: string; name?: string; parent?: string },
    signal: AbortSignal,
  ) {
    const id = encodeURIComponent(input.id);
    switch (input.action) {
      case 'rename':
      case 'rename-space': {
        const name = input.name?.trim();
        if (
          !name ||
          name.length > (input.action === 'rename-space' ? 100 : 255)
        )
          throw new SpaceError(400, 'Enter a valid name.');
        return this.json(
          `/api/${input.action === 'rename-space' ? 'spaces' : 'nodes'}/${id}`,
          { method: 'PATCH', signal, body: JSON.stringify({ name }) },
        );
      }
      case 'move':
        if (typeof input.parent !== 'string')
          throw new SpaceError(400, 'Choose a destination.');
        return this.json(`/api/nodes/${id}`, {
          method: 'PATCH',
          signal,
          body: JSON.stringify({ parentNodeId: input.parent || null }),
        });
      case 'delete':
        return this.json(`/api/nodes/${id}/trash`, { method: 'POST', signal });
      case 'restore':
        return this.json(`/api/trash-batches/${id}/restore`, {
          method: 'POST',
          signal,
        });
      default:
        throw new SpaceError(400, 'Unsupported file operation.');
    }
  }

  async trash(signal: AbortSignal) {
    const { spaces } = await this.json('/api/spaces', { signal });
    const items: any[] = [];
    for (const space of spaces.filter((s: any) => s.capabilities?.viewTrash)) {
      let cursor = '';
      do {
        const page = await this.json(
          `/api/spaces/${encodeURIComponent(space.id)}/trash?${new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) })}`,
          { signal },
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? '';
      } while (cursor);
    }
    return { items };
  }

  /** Open formal editors with authorized metadata; their SDK loader owns the snapshot read. */
  open(nodeId: string, signal?: AbortSignal): Promise<OpenFile> {
    const operation = this.readContent(nodeId, signal, true);
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }

  private async htmlContent(resourceId: string, sha256: string | undefined, signal?: AbortSignal) {
    const identity = this.lifetime;
    const active = AbortSignal.any([identity.signal, ...(signal ? [signal] : [])]);
    active.throwIfAborted();
    const cached = this.htmlCache.get(resourceId);
    // The fresh resource-open response has already rechecked ACL and content identity.
    if (cached && sha256 && cached.sha256 === sha256) {
      this.htmlCache.delete(resourceId); this.htmlCache.set(resourceId, cached);
      return cached.html;
    }
    const response = await this.rawRequest(`/api/blob-resources/${encodeURIComponent(resourceId)}/content`, {
      signal: active, headers: cached?.etag ? { 'if-none-match': cached.etag } : {},
    });
    active.throwIfAborted();
    if (response.status === 304 && cached) {
      const entry = { ...cached, sha256, etag: response.headers.get('etag') ?? cached.etag };
      this.htmlCache.delete(resourceId); this.htmlCache.set(resourceId, entry);
      return cached.html;
    }
    if (!response.ok) {
      this.htmlCache.delete(resourceId);
      throw new SpaceError(response.status, 'Cannot load this Workspace Page.');
    }
    const html = await response.text();
    active.throwIfAborted();
    if (Buffer.byteLength(html, 'utf8') > 1024 * 1024) throw new SpaceError(413, 'HTML preview exceeds 1 MiB. Open this file in Workspace.');
    this.htmlCache.delete(resourceId);
    this.htmlCache.set(resourceId, { html, sha256, etag: response.headers.get('etag') });
    while (this.htmlCache.size > 16) this.htmlCache.delete(this.htmlCache.keys().next().value!);
    return html;
  }

  /** Track materialization so unload waits until all SDK work has settled. */
  read(nodeId: string, signal?: AbortSignal) {
    const operation = this.readContent(nodeId, signal);
    this.pending.add(operation);
    void operation
      .finally(() => this.pending.delete(operation))
      .catch(() => {});
    return operation;
  }

  private readContent(nodeId: string, signal?: AbortSignal): Promise<Content>;
  private readContent(nodeId: string, signal: AbortSignal | undefined, metadataOnly: true): Promise<OpenFile>;
  private async readContent(nodeId: string, signal?: AbortSignal, metadataOnly = false): Promise<Content | OpenFile> {
    const lifetime = this.lifetime;
    const endpoint = this.endpoint;
    const json = (path: string, init: RequestInit = {}) => {
      lifetime.signal.throwIfAborted();
      return this.json(path, {
        ...init,
        signal: signal
          ? AbortSignal.any([lifetime.signal, signal])
          : lifetime.signal,
      });
    };
    const nodeResult = await json(`/api/nodes/${encodeURIComponent(nodeId)}`);
    const node = nodeResult.node ?? nodeResult;
    const resource = node.resource;
    if (!resource?.capabilities?.openContent)
      throw new SpaceError(403, 'No permission to open this content.');
    const opened = (
      await json(`/api/resources/${encodeURIComponent(resource.id)}/open`, {
        method: 'POST',
      })
    ).resource;
    if (resource.kind === 'blob') {
      if (!opened.originalFilename?.toLowerCase().endsWith('.univer.html'))
        throw new SpaceError(
          400,
          'This file has no supported preview. Pages require a .univer.html file.',
        );
      if (opened.byteSize > 1024 * 1024)
        throw new SpaceError(
          413,
          'HTML preview exceeds 1 MiB. Open this file in Workspace.',
        );
      const html = await this.htmlContent(resource.id, typeof opened.sha256 === 'string' ? opened.sha256 : undefined, signal);
      lifetime.signal.throwIfAborted();
      return {
        endpoint,
        nodeId,
        resourceId: resource.id,
        unitId: '',
        type: 'site',
        name: node.name,
        node,
        space: nodeResult.space,
        breadcrumbs: nodeResult.breadcrumbs,
        revision: 0,
        sha256: createHash('sha256').update(html).digest('hex'),
        capturedAt: new Date().toISOString(),
        data: null,
        html,
        content: { text: '', sheets: [] },
      };
    }
    const types: Record<string, number> = {
      doc: 1,
      sheet: 2,
      slide: 3,
      base: 5,
      board: 6,
    };
    const type = types[resource.unitType];
    if (resource.kind !== 'univer' || !type)
      throw new SpaceError(400, 'This content type has no supported preview.');
    if (metadataOnly) return {
      endpoint, nodeId, resourceId: resource.id, unitId: resource.unitId,
      type: resource.unitType, name: node.name, node,
      space: nodeResult.space, breadcrumbs: nodeResult.breadcrumbs,
    };
    const prefix = `/universer-api/snapshot/${type}/unit/${encodeURIComponent(resource.unitId)}`;
    const body = await json(`${prefix}/rev/0`);
    const snapshot = decodeSnapshot(body.snapshot);
    if (
      snapshot.unitID !== resource.unitId ||
      snapshot.type !== type ||
      !Array.isArray(body.changesets)
    )
      throw new SpaceError(
        502,
        'Workspace returned a different or invalid Unit.',
      );
    const revision = body.changesets.at(-1)?.revision ?? snapshot.rev;
    const blockIds = [
      ...new Set(
        Object.values(snapshot.workbook?.blockMeta ?? {}).flatMap(
          (meta: any) => meta.blocks,
        ),
      ),
    ];
    const sheetBlocks = [];
    for (const id of blockIds) {
      const { block } = await json(
        `${prefix}/block/${encodeURIComponent(String(id))}`,
      );
      sheetBlocks.push({ ...block, data: bytes(block.data) });
    }
    // Hash persisted input before SDK materialization; legacy Docs may synthesize
    // different section IDs on each transformation without changing Server data.
    const sourceSha256 = createHash('sha256')
      .update(
        JSON.stringify({
          snapshot: body.snapshot,
          changesets: body.changesets,
          sheetBlocks,
        }),
      )
      .digest('hex');
    const materialized = await this.materializer.materializeSnapshot({
      snapshot,
      changesets: body.changesets,
      targetRevision: revision,
      sheetBlocks,
    });
    const data: any =
      type === 1
        ? transformSnapshotToDocumentData(materialized.snapshot)
        : type === 2
          ? await transformSnapshotToWorkbookData(
              materialized.snapshot,
              materialized.sheetBlocks,
            )
          : type === 3
            ? transformSnapshotToSlideData(materialized.snapshot)
            : type === 5
              ? await transformSnapshotToBaseData(
                  materialized.snapshot,
                  materialized.sheetBlocks,
                )
              : transformSnapshotToBoardData(materialized.snapshot);
    lifetime.signal.throwIfAborted();
    const content =
      type === 1
        ? { text: data.body?.dataStream ?? '', sheets: [] }
        : type !== 2
          ? { text: '', sheets: [] }
          : {
              text: '',
              sheets: (data.sheetOrder ?? Object.keys(data.sheets)).map(
                (id: string) => {
                  const sheet = data.sheets[id];
                  const cells: {
                    row: number;
                    column: number;
                    value: string;
                  }[] = [];
                  for (const [row, columns] of Object.entries(
                    sheet.cellData ?? {},
                  )) {
                    for (const [column, cell] of Object.entries(
                      columns as object,
                    )) {
                      const c = cell as any;
                      cells.push({
                        row: Number(row),
                        column: Number(column),
                        value: String(
                          c.v ?? c.p?.body?.dataStream ?? c.f ?? '',
                        ),
                      });
                    }
                  }
                  return { id, name: sheet.name, cells };
                },
              ),
            };
    const frozen = {
      endpoint,
      nodeId,
      resourceId: resource.id,
      unitId: resource.unitId,
      type: resource.unitType,
      name: node.name,
      node,
      space: nodeResult.space,
      breadcrumbs: nodeResult.breadcrumbs,
      revision,
      content,
    };
    const sha256 = createHash('sha256')
      .update(JSON.stringify({ ...frozen, sourceSha256 }))
      .digest('hex');
    return {
      ...frozen,
      sha256,
      sourceSha256,
      capturedAt: new Date().toISOString(),
      data,
      notice:
        'Read-only frozen snapshot. Core SDK preview; advanced embedded objects may require additional plugins.',
    };
  }
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}
function decodeSnapshot(value: any): any {
  const snapshot = structuredClone(value);
  for (const key of ['doc', 'workbook', 'slide', 'board', 'base']) {
    if (snapshot[key]?.originalMeta !== undefined)
      snapshot[key].originalMeta = bytes(snapshot[key].originalMeta);
  }
  for (const sheet of Object.values(snapshot.workbook?.sheets ?? {}) as any[])
    sheet.originalMeta = bytes(sheet.originalMeta);
  return snapshot;
}

/** Match the original Workspace asset contract: HTTP(S), with no URL credentials. */
function assetContentURL(value: unknown, origin: string): URL {
  if (typeof value !== 'string' || !value)
    throw new SpaceError(502, 'Workspace did not return an asset content URL.');
  let url: URL;
  try { url = new URL(value, origin); }
  catch { throw new SpaceError(502, 'Workspace returned an invalid asset URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new SpaceError(502, 'Workspace returned an unsupported asset URL.');
  return url;
}
