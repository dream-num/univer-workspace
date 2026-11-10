import { readFile } from 'node:fs/promises';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { parseDocMarkdownSourceMap, readDocMarkdown } from '@univer-cli/doc-markdown-facade';
import {
  compileWorkspaceMarkdownFile, workspaceMarkdownTargetUnitId,
  readWorkspaceMarkdownImage, writeWorkspaceMarkdownExport,
} from '@univerjs/univer-workspace-client-core/markdown';
import { materializeWorkspaceDocument } from '@univerjs/univer-workspace-client-core/document-materialize';
import { authorizedSessionPath } from '@univerjs/univer-workspace-agent-runtime/workspace-session-path';
import { createWorktreeLocalUnit, getWorktreeDetail } from '@univerjs/univer-workspace-agent-runtime/workspace-worktree-api';
import { resolveDraftTarget } from './draft-target.js';
import { resolveToolSpace, type ToolBindings } from './tools.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

function input(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SpaceError(400, 'Provide Markdown tool arguments.');
  return value as Record<string, unknown>;
}
function string(args: Record<string, unknown>, name: string, required = false): string | undefined {
  const value = args[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new SpaceError(400, `Provide a non-empty ${name}.`);
  return value;
}
function blockIds(args: Record<string, unknown>): string[] | undefined {
  const value = args.blockIds;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some(id => typeof id !== 'string' || !id.trim()) || new Set(value).size !== value.length)
    throw new SpaceError(400, 'Provide distinct non-empty blockIds.');
  return value;
}
const text = { type: 'string' } as const;
const ids = { type: 'array', items: text } as const;
const output = { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] };

/** Adapt the upstream compiler/materializer to native Session paths and the existing draft runtime. */
export function registerMarkdownTools(ctx: Context, workspace: WorkspaceConnection, bindings: ToolBindings) {
  const scope = async (exec: ToolRunContext) => {
    const sessionId = exec.agent?.session.id;
    if (!sessionId) throw new SpaceError(403, 'A native Agent Session is required.');
    const identity = workspace.identitySignal;
    const signal = AbortSignal.any([exec.signal, identity]);
    const status = await workspace.status();
    signal.throwIfAborted();
    if (status.state !== 'connected' || !status.user?.id) throw new SpaceError(401, 'Sign in to Workspace first.');
    const client = {
      origin: status.endpoint, sessionToken: '',
      request: (path: string, init: RequestInit = {}) => workspace.rawRequest(path, {
        ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
    };
    return { sessionId, signal, client };
  };
  const compile = ctx.tools.register({
    name: 'univer_compile_markdown',
    description: 'Compile Session Markdown and local assets into an editable Modern Doc using the official SDK. Requires an explicit draft worktreeId; never publishes or merges. For stable block updates provide unitId, sourceMapFile and blockIds together. Save the returned sourceMap for later export/update.',
    parameters: {
      type: 'object', properties: {
        source: text, worktreeId: text, title: text, spaceId: text, parentNodeId: text,
        idempotencyKey: text, unitId: text, sourceMapFile: text, blockIds: ids,
      }, required: ['source', 'worktreeId'],
    }, output,
    async execute(value: unknown, exec: ToolRunContext) {
      const args = input(value);
      const sourceFile = string(args, 'source', true)!;
      const worktreeId = string(args, 'worktreeId', true)!;
      const unitId = string(args, 'unitId');
      const sourceMapFile = string(args, 'sourceMapFile');
      const selected = blockIds(args);
      const title = string(args, 'title');
      const spaceId = string(args, 'spaceId');
      const parentNodeId = string(args, 'parentNodeId');
      const idempotencyKey = string(args, 'idempotencyKey');
      if (unitId ? !sourceMapFile || !selected : sourceMapFile !== undefined || selected !== undefined)
        throw new SpaceError(400, 'Block updates require unitId, sourceMapFile and blockIds together.');
      if (unitId && [spaceId, parentNodeId, idempotencyKey].some(item => item !== undefined))
        throw new SpaceError(400, 'Creation options cannot be combined with unitId.');
      const { sessionId, signal, client } = await scope(exec);
      const detail = await getWorktreeDetail(client, worktreeId);
      if (detail.status !== 'draft' || !detail.capabilities.editDraft) throw new SpaceError(403, 'This Worktree is not an editable draft.');
      const target = unitId ? await resolveDraftTarget(workspace, bindings, sessionId, { worktreeId, unitId, unitType: 'doc' }, signal, true) : undefined;
      const source = await authorizedSessionPath(exec.agent?.session.header.cwd, sourceFile, true);
      const mapPath = sourceMapFile ? await authorizedSessionPath(source.workspace, sourceMapFile, true) : undefined;
      const sourceMap = mapPath ? parseDocMarkdownSourceMap(JSON.parse(await readFile(mapPath.path, 'utf8'))) : undefined;
      signal.throwIfAborted();
      const compiled = await compileWorkspaceMarkdownFile(source.path, {
        targetUnitId: unitId ?? workspaceMarkdownTargetUnitId(idempotencyKey),
        ...(title === undefined ? {} : { title }),
        ...(sourceMap === undefined ? {} : { update: { sourceMap, blockIds: selected! } }),
      }, source.workspace);
      if (compiled.diagnostics.some(item => item.severity === 'error'))
        return { operation: 'compile-markdown', committed: false, diagnostics: compiled.diagnostics };
      signal.throwIfAborted();
      if (target) {
        const execution = await workspace.executeDraft({ ...target, type: 'doc' }, worktreeId, compiled.javascript, undefined, signal);
        signal.throwIfAborted();
        return { operation: 'compile-markdown', unitId, worktreeId, committedToSharedDocument: false, diagnostics: compiled.diagnostics, execution, sourceMap: parseDocMarkdownSourceMap(execution.value) };
      }
      const destination = await resolveToolSpace(workspace, bindings, sessionId, spaceId, signal);
      const parent = parentNodeId ?? (spaceId === undefined || spaceId === bindings.currentSpace(sessionId) ? bindings.currentParent(sessionId) : '');
      const materialized = await materializeWorkspaceDocument(
        { javascript: compiled.javascript, targetUnitId: compiled.targetUnitId }, { format: 'Markdown', license: workspace.license },
      );
      const materializedMap = compiled.sourceMap.length === 0 ? [] : parseDocMarkdownSourceMap(materialized.value);
      signal.throwIfAborted();
      const unit = await createWorktreeLocalUnit(client, {
        worktreeId, name: materialized.name ?? compiled.title, unitType: 'doc', targetSpaceId: destination,
        targetParentNodeId: parent || null, initialData: materialized.initialData,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      });
      signal.throwIfAborted();
      return { operation: 'compile-markdown', unit, worktreeId, committedToSharedDocument: false, diagnostics: compiled.diagnostics, sourceMap: materializedMap };
    },
    presentCall: () => ({ card: 'generic', title: 'Compile Markdown into Modern Doc', kind: 'execute' }),
  });
  const exportMarkdown = ctx.tools.register({
    name: 'univer_export_markdown',
    description: 'Read selected current native Modern Doc blocks in an explicit Worktree into a Session Markdown file and image sidecars. Requires the saved source map and blockIds. Returns same-read revision metadata and a refreshed map for later updates; performs no document write.',
    parameters: {
      type: 'object', properties: { worktreeId: text, unitId: text, sourceMapFile: text, blockIds: ids, out: text, sourceMapOut: text },
      required: ['worktreeId', 'unitId', 'sourceMapFile', 'blockIds', 'out'],
    }, output,
    async execute(value: unknown, exec: ToolRunContext) {
      const args = input(value);
      const worktreeId = string(args, 'worktreeId', true)!;
      const unitId = string(args, 'unitId', true)!;
      const sourceMapFile = string(args, 'sourceMapFile', true)!;
      const selected = blockIds(args);
      if (!selected) throw new SpaceError(400, 'Provide blockIds.');
      const out = string(args, 'out', true)!;
      const mapOut = string(args, 'sourceMapOut') ?? `${out}.map.json`;
      const { sessionId, signal, client } = await scope(exec);
      const target = await resolveDraftTarget(workspace, bindings, sessionId, { worktreeId, unitId, unitType: 'doc' }, signal, false);
      const source = await authorizedSessionPath(exec.agent?.session.header.cwd, sourceMapFile, true);
      const destination = await authorizedSessionPath(source.workspace, out, false);
      const mapDestination = await authorizedSessionPath(source.workspace, mapOut, false);
      const result = await readDocMarkdown({
        targetUnitId: unitId, blockIds: selected,
        sourceMap: parseDocMarkdownSourceMap(JSON.parse(await readFile(source.path, 'utf8'))),
      }, {
        read: async code => {
          signal.throwIfAborted();
          return workspace.readDraftWithRevision({ ...target, type: 'doc' }, worktreeId, code);
        },
        assetResolver: reference => readWorkspaceMarkdownImage(reference, { origin: client.origin, worktreeId, request: client.request }),
      });
      signal.throwIfAborted();
      await writeWorkspaceMarkdownExport(result, destination.path, mapDestination.path);
      return { ...result, operation: 'export-markdown', committed: false, out, sourceMapOut: mapOut, assets: result.assets.map(({ data: _data, ...asset }) => asset) };
    },
    presentCall: () => ({ card: 'generic', title: 'Export current native Doc blocks as Markdown', kind: 'execute' }),
  });
  return () => { exportMarkdown(); compile(); };
}
