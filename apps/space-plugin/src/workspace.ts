import { createHash } from 'node:crypto';
import { transformSnapshotToDocumentData, transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';

export class SpaceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function normalizeEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new SpaceError(400, 'Endpoint must be a valid HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new SpaceError(400, 'Endpoint must be an HTTP(S) origin without credentials or a path.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new SpaceError(400, 'Use HTTPS for a remote Workspace.');
  return url.origin;
}

/** Plugin-owned connection only; no credentials, second Agent, or chat history in the client. */
export class WorkspaceConnection {
  endpoint = '';
  private cookie = '';
  private lifetime = new AbortController();
  private pending = new Set<Promise<unknown>>();
  private materializer = new UnitSnapshotMaterializer({ execution: { mode: 'in-process' } });

  configure(endpoint: string) {
    const next = endpoint ? normalizeEndpoint(endpoint) : '';
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.cookie = '';
    this.endpoint = next;
  }

  async dispose() {
    this.lifetime.abort();
    this.cookie = '';
    await Promise.allSettled([...this.pending]);
    await this.materializer.dispose();
  }

  async request(path: string, init: RequestInit = {}) {
    if (!this.endpoint) throw new SpaceError(409, 'Workspace is not configured.');
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(20000), ...(init.signal ? [init.signal] : [])]);
    try {
      const response = await fetch(new URL(path, this.endpoint), {
        ...init, redirect: 'error', signal,
        headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      });
      if (!response.ok) throw new SpaceError(response.status, `Workspace returned HTTP ${response.status}.`);
      return response;
    } catch (error) {
      if (error instanceof SpaceError) throw error;
      throw new SpaceError(502, signal.aborted ? 'Workspace request canceled or timed out.' : 'Cannot reach Workspace.');
    }
  }

  async json(path: string, init: RequestInit = {}): Promise<any> {
    return (await this.request(path, init)).json();
  }

  async login(username: string, password: string) {
    const lifetime = this.lifetime;
    const response = await this.request('/api/auth/password/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    lifetime.signal.throwIfAborted();
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    if (!cookie) throw new SpaceError(502, 'Workspace login did not issue a session cookie.');
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.cookie = cookie;
    return this.status();
  }

  async status() {
    if (!this.endpoint) return { state: 'unconfigured', endpoint: '' };
    try {
      const session = await this.json('/api/session');
      return { state: session.authenticated ? 'connected' : 'unauthenticated', endpoint: this.endpoint, user: session.user ?? null };
    } catch (error) {
      return { state: error instanceof SpaceError && [401, 403].includes(error.status) ? 'unauthenticated' : 'network-error', endpoint: this.endpoint };
    }
  }

  /** Track materialization so unload waits until all SDK work has settled. */
  read(nodeId: string) {
    const operation = this.readContent(nodeId);
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }

  private async readContent(nodeId: string) {
    const lifetime = this.lifetime;
    const endpoint = this.endpoint;
    const json = (path: string, init: RequestInit = {}) => {
      lifetime.signal.throwIfAborted();
      return this.json(path, { ...init, signal: lifetime.signal });
    };
    const nodeResult = await json(`/api/nodes/${encodeURIComponent(nodeId)}`);
    const node = nodeResult.node ?? nodeResult;
    const resource = node.resource;
    if (resource?.kind !== 'univer' || !['doc', 'sheet'].includes(resource.unitType))
      throw new SpaceError(400, 'This slice opens Document and Sheet only.');
    if (!resource.capabilities.openContent) throw new SpaceError(403, 'No permission to open this content.');
    await json(`/api/resources/${encodeURIComponent(resource.id)}/open`, { method: 'POST' });
    const type = resource.unitType === 'doc' ? 1 : 2;
    const prefix = `/universer-api/snapshot/${type}/unit/${encodeURIComponent(resource.unitId)}`;
    const body = await json(`${prefix}/rev/0`);
    const snapshot = decodeSnapshot(body.snapshot);
    if (snapshot.unitID !== resource.unitId || snapshot.type !== type || !Array.isArray(body.changesets))
      throw new SpaceError(502, 'Workspace returned a different or invalid Unit.');
    const revision = body.changesets.at(-1)?.revision ?? snapshot.rev;
    const blockIds = [...new Set(Object.values(snapshot.workbook?.blockMeta ?? {}).flatMap((meta: any) => meta.blocks))];
    const sheetBlocks = [];
    for (const id of blockIds) {
      const { block } = await json(`${prefix}/block/${encodeURIComponent(String(id))}`);
      sheetBlocks.push({ ...block, data: bytes(block.data) });
    }
    const materialized = await this.materializer.materializeSnapshot({ snapshot, changesets: body.changesets, targetRevision: revision, sheetBlocks });
    const data: any = type === 1
      ? await transformSnapshotToDocumentData(materialized.snapshot)
      : await transformSnapshotToWorkbookData(materialized.snapshot, materialized.sheetBlocks);
    lifetime.signal.throwIfAborted();
    const content = type === 1 ? { text: data.body?.dataStream ?? '', sheets: [] } : {
      text: '', sheets: (data.sheetOrder ?? Object.keys(data.sheets)).map((id: string) => {
        const sheet = data.sheets[id];
        const cells: { row: number; column: number; value: string }[] = [];
        for (const [row, columns] of Object.entries(sheet.cellData ?? {})) {
          for (const [column, cell] of Object.entries(columns as object)) {
            const c = cell as any;
            cells.push({ row: Number(row), column: Number(column), value: String(c.v ?? c.p?.body?.dataStream ?? c.f ?? '') });
          }
        }
        return { id, name: sheet.name, cells };
      }),
    };
    const frozen = { endpoint, nodeId, resourceId: resource.id, unitId: resource.unitId, type: resource.unitType, name: node.name, revision, content };
    const sha256 = createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
    return { ...frozen, sha256, capturedAt: new Date().toISOString(), notice: 'Read-only text/cell projection. Rich layout, embedded objects and formula recalculation are outside this slice.' };
  }
}

function bytes(value: string): Uint8Array { return Uint8Array.from(Buffer.from(value, 'base64')); }
function decodeSnapshot(value: any): any {
  const snapshot = structuredClone(value);
  for (const key of ['doc', 'workbook', 'slide', 'board']) {
    if (snapshot[key]?.originalMeta !== undefined) snapshot[key].originalMeta = bytes(snapshot[key].originalMeta);
  }
  for (const sheet of Object.values(snapshot.workbook?.sheets ?? {}) as any[]) sheet.originalMeta = bytes(sheet.originalMeta);
  return snapshot;
}
