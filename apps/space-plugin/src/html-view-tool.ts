import { readFile } from 'node:fs/promises';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { IWorkbookData } from '@univerjs/core';
import { isHtmlViewFilename } from '@univerjs-labs/html-view';
import { validateHtmlView } from '@univerjs/univer-workspace-agent-runtime/workspace-html-view';
import { authorizedSessionPath } from '@univerjs/univer-workspace-agent-runtime/workspace-session-path';
import { uploadBlob } from '@univerjs/univer-workspace-agent-runtime/workspace-blob';
import { blobIdempotencyKey } from './blob-tool.js';
import { htmlViewParameters } from './workspace-html-contract.js';
import { referenceText, type FileReference } from './model.js';
import { resolveToolSpace, type ToolBindings } from './tools.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

/** Reuse the original Page binding validation and Blob publication workflow. */
export function registerHtmlViewTool(ctx: Context, workspace: WorkspaceConnection, bindings: ToolBindings) {
  return ctx.tools.register({
    name: 'univer_html_view', parameters: { ...htmlViewParameters },
    description: 'Validate or create a .univer.html Page bound to accessible Workspace Sheets. Validation checks actual source Units, worksheets and bounds; creation publishes a separate Blob. Revise an existing Page with univer_blob download and ETag replace.',
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: any, exec: ToolRunContext) {
      const sessionId = exec.agent?.session.id;
      if (!sessionId) throw new SpaceError(403, 'A native Agent Session is required.');
      if (!args || !['validate', 'create'].includes(args.action) || typeof args.source !== 'string' || !isHtmlViewFilename(args.source)) throw new SpaceError(400, 'Provide a .univer.html source and valid action.');
      const status = await workspace.status();
      if (status.state !== 'connected' || !status.user?.id) throw new SpaceError(401, 'Sign in to Workspace first.');
      const identity = workspace.identitySignal, signal = AbortSignal.any([exec.signal, identity]);
      const source = await authorizedSessionPath(exec.agent?.session.header.cwd, args.source, true);
      const html = await readFile(source.path, { encoding: 'utf8', signal });
      const validation = await validateHtmlView(html, async (unitId) => {
        const file = await bindings.resolve(sessionId, { unitId, unitType: 'sheet' }, signal);
        const data = await workspace.exportUnitData(file as FileReference & { type: 'sheet' });
        signal.throwIfAborted();
        return data as unknown as IWorkbookData;
      }, signal);
      if (args.action === 'validate') return validation;
      if (typeof args.name !== 'string' || !args.name.trim()) throw new SpaceError(400, 'A Page name is required.');
      if ((args.spaceId !== undefined && typeof args.spaceId !== 'string') || (args.parentNodeId !== undefined && typeof args.parentNodeId !== 'string')) throw new SpaceError(400, 'Invalid Page destination.');
      const idempotencyKey = blobIdempotencyKey(args.idempotencyKey);
      const spaceId = await resolveToolSpace(workspace, bindings, sessionId, args.spaceId, signal);
      const parent = args.parentNodeId ?? (args.spaceId === undefined || args.spaceId === bindings.currentSpace(sessionId) ? bindings.currentParent(sessionId) : '');
      const name = isHtmlViewFilename(args.name.trim()) ? args.name.trim() : `${args.name.trim()}.univer.html`;
      const client = { request: (path: string, init: RequestInit = {}) => workspace.rawRequest(path, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal }) };
      const result = await uploadBlob(client, { bytes: new TextEncoder().encode(html), name, originalFilename: name, idempotencyKey, spaceId, parentNodeId: parent || null });
      workspace.noteContentChanged();
      return { ...result, workspaceUrl: new URL(`/nodes/${encodeURIComponent(result.nodeId)}`, workspace.endpoint).href,
        reference: referenceText({ endpoint: workspace.endpoint, ...result, unitId: '', name, type: 'site' }) };
    },
    presentCall: (args: any) => ({ card: 'generic', title: `HTML view: ${args.action}`, kind: args.action === 'create' ? 'execute' : 'read' }),
  });
}
