import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { createWorktreeLocalUnit, setWorktreeUnitRemoved } from '@univerjs/univer-workspace-agent-runtime/workspace-worktree-api';
import { runUnitOperation } from '@univerjs/univer-workspace-agent-runtime/workspace-unit-operations';
import { unitParameters } from './workspace-unit-contract.js';
import { resolveToolSpace, type ToolBindings } from './tools.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

/** Original Worktree-local Unit creation and reversible deletion intent. */
export function registerUnitTool(ctx: Context, workspace: WorkspaceConnection, bindings: ToolBindings) {
  return ctx.tools.register({
    name: 'univer_unit', parameters: { ...unitParameters },
    description: 'Create a Unit inside a draft Workspace Worktree, or mark a Unit for removal and restore that intent. This does not merge or publish the Worktree.',
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: any, exec: ToolRunContext) {
      const sessionId = exec.agent?.session.id;
      if (!sessionId) throw new SpaceError(403, 'A native Agent Session is required.');
      const status = await workspace.status();
      if (status.state !== 'connected' || !status.user?.id) throw new SpaceError(401, 'Sign in to Workspace first.');
      if (!args || !['create', 'remove', 'restore'].includes(args.action) || typeof args.worktreeId !== 'string') throw new SpaceError(400, 'Choose a Worktree and a valid Unit action.');
      const signal = AbortSignal.any([exec.signal, workspace.identitySignal]);
      const space = args.action === 'create' ? await resolveToolSpace(workspace, bindings, sessionId, args.spaceId, signal) : '';
      const client = { origin: status.endpoint, sessionToken: '', request: (path: string, init: RequestInit = {}) => workspace.rawRequest(path, {
        ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }) };
      return runUnitOperation(args, space, {
        createWorktreeLocalUnit: (input) => createWorktreeLocalUnit(client, input),
        setWorktreeUnitRemoved: (worktreeId, unitId, removed) => setWorktreeUnitRemoved(client, worktreeId, unitId, removed),
      });
    },
    presentCall: (args: any) => ({ card: 'generic', title: `${args.action} Worktree Unit`, kind: 'execute' }),
  });
}
