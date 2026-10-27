import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { listIssues, readIssue, createIssue, updateIssue, commentOnIssue, listIssueLabels } from '@univerjs/univer-workspace-agent-runtime/workspace-issues';
import { runIssueOperation } from '@univerjs/univer-workspace-agent-runtime/workspace-issue-operations';
import { openResource } from '@univerjs/univer-workspace-agent-runtime/workspace-resources';
import { issueParameters } from './workspace-issue-contract.js';
import { resolveToolSpace, type ToolBindings } from './tools.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

/** Register the original Issue operations on the native DSH Agent registry. */
export function registerIssueTool(ctx: Context, workspace: WorkspaceConnection, bindings: ToolBindings) {
  return ctx.tools.register({
    name: 'univer_issue', parameters: { ...issueParameters },
    description: 'Read and operate Team Space Issues: list, get, create, update, comment, close and reopen. Issue writes are not idempotent. Read an Issue before beginning its task; never close an Issue unless the user asks.',
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: any, exec: ToolRunContext) {
      const sessionId = exec.agent?.session.id;
      if (!sessionId) throw new SpaceError(403, 'A native Agent Session is required.');
      const status = await workspace.status();
      if (status.state !== 'connected' || !status.user?.id) throw new SpaceError(401, 'Sign in to Workspace first.');
      if (!args || !['list', 'get', 'create', 'update', 'comment', 'close', 'reopen'].includes(args.action)) throw new SpaceError(400, 'Invalid Issue action.');
      const signal = AbortSignal.any([exec.signal, workspace.identitySignal]);
      const spaceId = args.action === 'list' && args.scope === 'mine'
        ? '' : await resolveToolSpace(workspace, bindings, sessionId, args.spaceId, signal);
      const client = { origin: status.endpoint, sessionToken: '', request: (path: string, init: RequestInit = {}) => workspace.rawRequest(path, {
        ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }) };
      const service = {
        listIssues: (_: string, query: Parameters<typeof listIssues>[1]) => listIssues(client, query),
        readIssue: (_: string, space: string, number: number, options: Parameters<typeof readIssue>[3]) => readIssue(client, space, number, options),
        createIssue: (_: string, space: string, input: Parameters<typeof createIssue>[2]) => createIssue(client, space, input),
        updateIssue: (_: string, space: string, number: number, change: Parameters<typeof updateIssue>[3]) => updateIssue(client, space, number, change),
        commentOnIssue: (_: string, space: string, number: number, body: string) => commentOnIssue(client, space, number, body),
        listIssueLabels: (_: string, space: string) => listIssueLabels(client, space),
        openDocument: (_: string, resourceId: string) => openResource(client, resourceId),
      };
      return runIssueOperation(args, status.user.id, spaceId, service);
    },
    presentCall: (args: any) => ({ card: 'generic', title: `Issue ${args.action}${args.number ? ` #${args.number}` : ''}`, kind: args.action === 'list' || args.action === 'get' ? 'read' : 'execute' }),
  });
}
