import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { importUnitData, exportUnitData, inferExportFormat, type LocalExchangeUnitType } from '@univerjs/univer-workspace-agent-runtime/workspace-exchange';
import { authorizedSessionPath } from '@univerjs/univer-workspace-agent-runtime/workspace-session-path';
import { createDocument } from '@univerjs/univer-workspace-agent-runtime/workspace-resources';
import { importParameters, exportParameters } from './workspace-exchange-contract.js';
import { resolveToolSpace, type ToolBindings } from './tools.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';
import type { AgentEditing } from './editing.js';
import type { FileReference } from './model.js';

/** Reuse the Workspace Agent's SDK conversion and Session path contract. */
export function registerExchangeTools(ctx: Context, workspace: WorkspaceConnection, bindings: ToolBindings, editing: AgentEditing) {
  const output = { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] };
  const session = (exec: ToolRunContext) => {
    if (!exec.agent?.session.id) throw new SpaceError(403, 'A native Agent Session is required.');
    return exec.agent.session.id;
  };
  const unitTypes = ['sheet', 'doc', 'slide', 'base'];
  const disposeImport = ctx.tools.register({
    name: 'univer_import', parameters: { ...importParameters }, output,
    description: 'Import an xls/xlsx/csv/tsv/doc/docx/ppt/pptx file from the native Session workspace as a new shared Workspace Unit. Unit data is converted by the original Univer Exchange SDK.',
    async execute(args: any, exec: ToolRunContext) {
      const sessionId = session(exec);
      if (!args || typeof args.source !== 'string' || !args.source.trim() || typeof args.name !== 'string' || !args.name.trim()) throw new SpaceError(400, 'Provide a source file and document name.');
      if (args.worktreeId !== undefined) throw new SpaceError(400, 'Import to a Worktree is not available in this Space integration.');
      if (args.unitType !== undefined && !unitTypes.includes(args.unitType)) throw new SpaceError(400, 'Invalid Unit type.');
      if (args.type !== undefined && args.type !== 'auto' && !unitTypes.includes(args.type)) throw new SpaceError(400, 'Invalid Unit type.');
      if (args.unitType && args.type && args.type !== 'auto' && args.unitType !== args.type) throw new SpaceError(400, 'unitType and type conflict.');
      if ((args.spaceId !== undefined && typeof args.spaceId !== 'string') || (args.parentNodeId !== undefined && typeof args.parentNodeId !== 'string') || (args.idempotencyKey !== undefined && (typeof args.idempotencyKey !== 'string' || !args.idempotencyKey.trim()))) throw new SpaceError(400, 'Invalid destination or idempotency key.');
      const identity = workspace.identitySignal;
      const signal = AbortSignal.any([exec.signal, identity]);
      const spaceId = await resolveToolSpace(workspace, bindings, sessionId, args.spaceId, signal);
      const source = await authorizedSessionPath(exec.agent?.session.header.cwd, args.source, true);
      const imported = await importUnitData(new Uint8Array(await readFile(source.path)), basename(source.path), (args.unitType ?? (args.type === 'auto' ? undefined : args.type)) as LocalExchangeUnitType | undefined);
      signal.throwIfAborted();
      const parent = args.parentNodeId ?? (args.spaceId === undefined || args.spaceId === bindings.currentSpace(sessionId) ? bindings.currentParent(sessionId) : '');
      const client = { request: (path: string, init: RequestInit = {}) => workspace.request(path, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal }) };
      const key = args.idempotencyKey ?? createHash('sha256').update(`${sessionId}\0${exec.callId}`).digest('hex');
      const unit = await createDocument(client, { spaceId, parentNodeId: parent || null, name: args.name.trim(), unitType: imported.unitType, initialData: imported.data as any, idempotencyKey: key });
      workspace.noteContentChanged();
      return { ok: true, operation: 'import', status: 'done', sourcePath: args.source, ...unit, unitType: imported.unitType, name: args.name.trim() };
    },
    presentCall: () => ({ card: 'generic', title: 'Import Workspace document', kind: 'execute' }),
  });
  const disposeExport = ctx.tools.register({
    name: 'univer_export', parameters: { ...exportParameters }, output,
    description: 'Export a synchronized Workspace Unit to xlsx, csv, tsv, docx or pptx inside the native Session workspace.',
    async execute(args: any, exec: ToolRunContext) {
      const sessionId = session(exec);
      const outputPath = args?.output ?? args?.file;
      if (typeof outputPath !== 'string' || !outputPath.trim()) throw new SpaceError(400, 'Provide an output path.');
      if (args.revision !== undefined && (!Number.isSafeInteger(args.revision) || args.revision < 0)) throw new SpaceError(400, 'Invalid revision.');
      const unitId = args.unitId ?? args.unitID;
      const file = unitId ? await bindings.resolve(sessionId, { unitId }, exec.signal) : bindings.currentFile(sessionId);
      if (!file || !unitTypes.includes(file.type)) throw new SpaceError(400, 'An exportable Workspace Unit is required.');
      if (args.type && args.type !== file.type) throw new SpaceError(409, 'The supplied type does not match this Unit.');
      const destination = await authorizedSessionPath(exec.agent?.session.header.cwd, outputPath, false);
      const format = inferExportFormat(destination.path);
      if (args.format && args.format !== format) throw new SpaceError(400, 'The format does not match the output extension.');
      const identity = workspace.identitySignal;
      const data = args.worktreeId
        ? await editing.exportDraft(sessionId, { ...args, nodeId: file.nodeId }, exec.signal)
        : await workspace.exportUnitData(file as FileReference & { type: 'doc' | 'sheet' | 'slide' | 'base' }, undefined, args.revision);
      exec.signal.throwIfAborted(); identity.throwIfAborted();
      const bytes = await exportUnitData(data as unknown as Readonly<Record<string, unknown>>, file.type as LocalExchangeUnitType, destination.path);
      exec.signal.throwIfAborted(); identity.throwIfAborted();
      await mkdir(dirname(destination.path), { recursive: true });
      await writeFile(destination.path, bytes);
      return { ok: true, operation: 'export', status: 'done', file: outputPath, output: outputPath, unitId: file.unitId, unitID: file.unitId, unitType: file.type, format, ...(args.worktreeId ? { worktreeId: args.worktreeId } : {}) };
    },
    presentCall: () => ({ card: 'generic', title: 'Export Workspace document', kind: 'execute' }),
  });
  return () => { disposeExport(); disposeImport(); };
}
