import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { runResourceOperation } from '@univerjs/univer-workspace-agent-runtime/workspace-resource-library';
import { resourcesParameters } from './workspace-resources-contract.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

/** Original bundled SVG resource library, scoped to the native Session workspace. */
export function registerResourcesTool(ctx: Context, workspace: WorkspaceConnection) {
  return ctx.tools.register({
    name: 'univer_resources', parameters: { ...resourcesParameters },
    description: 'Discover, read, export and cache the version-pinned Univer SVG resource library. Resource handles are separate from Workspace file Resources.',
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: any, exec: ToolRunContext) {
      if (!exec.agent?.session.id) throw new SpaceError(403, 'A native Agent Session is required.');
      const status = await workspace.status();
      if (status.state !== 'connected' || !status.user?.id) throw new SpaceError(401, 'Sign in to Workspace first.');
      return runResourceOperation(args, exec.agent.session.header.cwd, fileURLToPath(new URL('./resource-manifest.json', import.meta.url)), AbortSignal.any([exec.signal, workspace.identitySignal]));
    },
    presentCall: () => ({ card: 'generic', title: 'Univer visual resources', kind: 'read' }),
  });
}
