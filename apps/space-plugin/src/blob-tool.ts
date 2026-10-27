import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { getBlob, uploadBlob, downloadBlob, replaceBlob } from '@univerjs/univer-workspace-agent-runtime/workspace-blob';
import { authorizedSessionPath } from '@univerjs/univer-workspace-agent-runtime/workspace-session-path';
import { blobParameters } from './workspace-blob-contract.js';
import { referenceText } from './model.js';
import { resolveToolSpace, type ToolBindings } from './tools.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

export function blobIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,200}$/.test(value))
    throw new SpaceError(400, 'idempotencyKey must contain 16–200 ASCII letters, digits, underscores or hyphens. Reuse it only for an identical retry.');
  return value;
}

/** Native registration around the original Workspace Blob protocol and Session path policy. */
export function registerBlobTool(ctx: Context, workspace: WorkspaceConnection, bindings: ToolBindings) {
  return ctx.tools.register({
    name: 'univer_blob', parameters: { ...blobParameters },
    description: 'Get, download, upload or replace Workspace Blob files. Downloads use the Session workspace; uploads and replacements publish directly. Replace requires the exact downloaded ETag and a stable idempotencyKey.',
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: any, exec: ToolRunContext) {
      const sessionId = exec.agent?.session.id;
      if (!sessionId) throw new SpaceError(403, 'A native Agent Session is required.');
      const status = await workspace.status();
      if (status.state !== 'connected' || !status.user?.id) throw new SpaceError(401, 'Sign in to Workspace first.');
      if (!args || !['get', 'download', 'upload', 'replace'].includes(args.action)) throw new SpaceError(400, 'Invalid Blob action.');
      const required = (value: unknown, name: string): string => {
        if (typeof value !== 'string' || !value.trim()) throw new SpaceError(400, `${name} is required.`);
        return value;
      };
      const identity = workspace.identitySignal;
      const signal = AbortSignal.any([exec.signal, identity]);
      const client = { request: (path: string, init: RequestInit = {}) => workspace.rawRequest(path, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal }) };
      if (args.action === 'get') return getBlob(client, required(args.resourceId, 'resourceId'));
      const file = required(args.file, 'file');
      if (args.action === 'upload') {
        const idempotencyKey = blobIdempotencyKey(args.idempotencyKey);
        if (args.spaceId !== undefined && typeof args.spaceId !== 'string') throw new SpaceError(400, 'Invalid Space.');
        if (args.parentNodeId !== undefined && typeof args.parentNodeId !== 'string') throw new SpaceError(400, 'Invalid folder.');
        const spaceId = await resolveToolSpace(workspace, bindings, sessionId, args.spaceId, signal);
        const parent = args.parentNodeId ?? (args.spaceId === undefined || args.spaceId === bindings.currentSpace(sessionId) ? bindings.currentParent(sessionId) : '');
        const source = await authorizedSessionPath(exec.agent?.session.header.cwd, file, true);
        const name = args.name === undefined ? basename(file) : required(args.name, 'name');
        const bytes = await readFile(source.path, { signal });
        const result = await uploadBlob(client, { spaceId, parentNodeId: parent || null, name, originalFilename: basename(file), bytes, idempotencyKey });
        workspace.noteContentChanged();
        return basename(file).toLowerCase().endsWith('.univer.html')
          ? { ...result, reference: referenceText({ endpoint: workspace.endpoint, ...result, unitId: '', name, type: 'site' }) }
          : result;
      }
      const resourceId = required(args.resourceId, 'resourceId');
      if (args.action === 'download') {
        const output = await authorizedSessionPath(exec.agent?.session.header.cwd, file, false);
        const result = await downloadBlob(client, resourceId);
        signal.throwIfAborted();
        await mkdir(dirname(output.path), { recursive: true });
        await writeFile(output.path, result.bytes, { flag: 'wx', signal });
        return { resourceId, file, byteSize: result.bytes.byteLength, etag: result.etag, mediaType: result.mediaType };
      }
      const idempotencyKey = blobIdempotencyKey(args.idempotencyKey);
      const etag = required(args.etag, 'etag');
      const source = await authorizedSessionPath(exec.agent?.session.header.cwd, file, true);
      const bytes = await readFile(source.path, { signal });
      const result = await replaceBlob(client, { resourceId, bytes, etag, idempotencyKey });
      workspace.noteContentChanged();
      return result;
    },
    presentCall: (args: any) => ({ card: 'generic', title: `Blob ${args.action}`, kind: args.action === 'replace' || args.action === 'upload' ? 'edit' : 'read' }),
  });
}
