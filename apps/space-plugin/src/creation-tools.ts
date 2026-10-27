import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { createDocument } from '@univerjs/univer-workspace-agent-runtime/workspace-resources';
import { workspaceCreateOutput, workspaceCreateParameters } from './workspace-create-contract.js';
import { resolveToolSpace, type ToolBindings } from './tools.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

const unitTypes = ['sheet', 'doc', 'slide', 'board', 'base'] as const;
type UnitType = typeof unitTypes[number];

/** Original document creation plus the existing Workspace organization workflows. */
export function registerCreationTools(ctx: Context, workspace: WorkspaceConnection, bindings: ToolBindings) {
  const output = { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] };
  const requireSession = (exec: ToolRunContext) => {
    const id = exec.agent?.session.id;
    if (!id) throw new SpaceError(403, 'A native Agent Session is required.');
    return id;
  };
  const createUnit = async (args: any, exec: ToolRunContext) => {
    const sessionId = requireSession(exec);
    if (!args || typeof args.name !== 'string' || !args.name.trim() ||
        !unitTypes.includes(args.unitType) ||
        (args.spaceId !== undefined && typeof args.spaceId !== 'string') ||
        (args.parentNodeId !== undefined && typeof args.parentNodeId !== 'string'))
      throw new SpaceError(400, 'A document name and supported Unit type are required.');
    const identity = workspace.identitySignal;
    const spaceId = await resolveToolSpace(workspace, bindings, sessionId, args.spaceId, exec.signal);
    const signal = AbortSignal.any([exec.signal, identity]);
    const client = { request: (path: string, init: RequestInit = {}) => workspace.request(path, {
      ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
    }) };
    const parent = args.parentNodeId ?? (args.spaceId === undefined || args.spaceId === bindings.currentSpace(sessionId) ? bindings.currentParent(sessionId) : '');
    const created = await createDocument(client, {
      spaceId, parentNodeId: parent || null, name: args.name.trim(), unitType: args.unitType as UnitType,
    });
    workspace.noteContentChanged();
    return created;
  };
  const createTool = (name: 'univer_create' | 'univer_new') => ({
    name,
    description: 'Create a new Univer Workspace document directly in the shared trunk. Supports Docs, Sheets, Slides, Canvas and Relational Table. Omit spaceId for the admitted current Space or Personal Space.',
    parameters: { ...workspaceCreateParameters },
    output: { ...output, schema: name === 'univer_create' ? workspaceCreateOutput : {} },
    execute: createUnit,
    presentCall: () => ({ card: 'generic' as const, title: 'Create Workspace document', kind: 'execute' as const }),
  });
  const organization = ctx.tools.register({
    name: 'univer_workspace',
    description: 'Create a Space, Folder, or Page, or rename, move, or restore a Workspace item. For restore, id is the Trash Batch ID. Writes use the authenticated Workspace Server and publish directly to the shared Workspace.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create_space', 'create_folder', 'create_page', 'rename', 'rename_space', 'move', 'restore'] },
        name: { type: 'string' }, spaceId: { type: 'string' }, parentNodeId: { type: 'string' }, id: { type: 'string' },
      }, required: ['action'],
    },
    output,
    async execute(args: any, exec: ToolRunContext) {
      const sessionId = requireSession(exec);
      if (!args || typeof args.action !== 'string') throw new SpaceError(400, 'Choose a Workspace action.');
      const identity = workspace.identitySignal;
      const signal = AbortSignal.any([exec.signal, identity]);
      let value: unknown;
      if (['create_space', 'create_folder', 'create_page'].includes(args.action)) {
        if (typeof args.name !== 'string' || !args.name.trim() ||
            (args.spaceId !== undefined && typeof args.spaceId !== 'string') ||
            (args.parentNodeId !== undefined && typeof args.parentNodeId !== 'string'))
          throw new SpaceError(400, 'Enter a valid name and location.');
        const space = args.action === 'create_space' ? '' : await resolveToolSpace(workspace, bindings, sessionId, args.spaceId, signal);
        const key = createHash('sha256').update(`${sessionId}\0${exec.callId}`).digest('hex');
        const parent = args.parentNodeId ?? (args.spaceId === undefined || args.spaceId === bindings.currentSpace(sessionId) ? bindings.currentParent(sessionId) : '');
        value = await workspace.create({ kind: args.action === 'create_space' ? 'space' : args.action === 'create_folder' ? 'folder' : 'site',
          name: args.name, space, parent, key }, signal);
      } else {
        const actions: Record<string, string> = { rename: 'rename', rename_space: 'rename-space', move: 'move', restore: 'restore' };
        const action = actions[args.action];
        if (!action || typeof args.id !== 'string' || !args.id.trim() ||
            (args.name !== undefined && typeof args.name !== 'string') ||
            (args.parentNodeId !== undefined && typeof args.parentNodeId !== 'string'))
          throw new SpaceError(400, 'Choose a valid Workspace item and action.');
        value = await workspace.mutate({ action, id: args.id, name: args.name, parent: args.parentNodeId ?? '' }, signal);
      }
      workspace.noteContentChanged();
      return value;
    },
    presentCall: () => ({ card: 'generic', title: 'Update Workspace', kind: 'execute' }),
  });
  const newTool = ctx.tools.register(createTool('univer_new'));
  const create = ctx.tools.register(createTool('univer_create'));
  return () => { create(); newTool(); organization(); };
}
