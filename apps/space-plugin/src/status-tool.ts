import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { getFileState, getWorktreeFileState } from '@univerjs/univer-workspace-agent-runtime/workspace-file-state-api';
import { openResource, resolveUnitResource } from '@univerjs/univer-workspace-agent-runtime/workspace-resources';
import { runDocumentStatus } from '@univerjs/univer-workspace-agent-runtime/workspace-status';
import { statusParameters } from './workspace-status-contract.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

/** Original Server-authorized document and Worktree status tool. */
export function registerStatusTool(ctx: Context, workspace: WorkspaceConnection) {
  return ctx.tools.register({
    name: 'univer_status', parameters: { ...statusParameters },
    description: 'Read an accessible Workspace document or Worktree collaboration status using its Resource, Unit or Worktree identity.',
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: any, exec: ToolRunContext) {
      if (!exec.agent?.session.id) throw new SpaceError(403, 'A native Agent Session is required.');
      const status = await workspace.status();
      if (status.state !== 'connected' || !status.user?.id) throw new SpaceError(401, 'Sign in to Workspace first.');
      const signal = AbortSignal.any([exec.signal, workspace.identitySignal]);
      const client = { origin: status.endpoint, sessionToken: '', request: (path: string, init: RequestInit = {}) => workspace.rawRequest(path, {
        ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }) };
      return runDocumentStatus(args, {
        resolveUnitResource: (id) => resolveUnitResource(client, id),
        openDocument: (id) => openResource(client, id),
        getFileState: (id) => getFileState(client, id),
        getWorktreeFileState: (id) => getWorktreeFileState(client, id),
        async assertWorktreeAccessible(id) { await getWorktreeFileState(client, id); },
      });
    },
    presentCall: () => ({ card: 'generic', title: 'Read Workspace status', kind: 'read' }),
  });
}
