import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { lintUnitLayout } from '@univerjs/univer-workspace-agent-runtime/workspace-render';
import { lintParameters } from './workspace-lint-contract.js';
import type { ToolBindings } from './tools.js';
import type { AgentEditing } from './editing.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

/** Original Slide layout lint, using the bundled official Render Page. */
export function registerLintTool(ctx: Context, workspace: WorkspaceConnection, bindings: ToolBindings, editing: AgentEditing) {
  return ctx.tools.register({
    name: 'univer_lint', parameters: { ...lintParameters },
    description: 'Analyze a Slide Unit with the original Univer layout-lint runtime. Reports off-page text, escaped containers, and overlaps.',
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: any, exec: ToolRunContext) {
      const sessionId = exec.agent?.session.id;
      if (!sessionId) throw new SpaceError(403, 'A native Agent Session is required.');
      if (!args || typeof args.unitId !== 'string' || !args.unitId.trim() || args.unitType !== 'slide') throw new SpaceError(400, 'Choose a Slide Unit for layout lint.');
      const signal = AbortSignal.any([exec.signal, workspace.identitySignal]);
      const file = args.worktreeId ? await editing.draftTarget(sessionId, args, signal) : await bindings.resolve(sessionId, { unitId: args.unitId, unitType: args.unitType }, signal);
      if (file.type !== 'slide') throw new SpaceError(400, 'Layout lint requires a Slide Unit.');
      const unitData = args.worktreeId ? await editing.exportDraft(sessionId, args, signal) : await workspace.exportUnitData({ ...file, type: 'slide' });
      signal.throwIfAborted();
      const renderPageRoot = process.env.UWH_RENDER_PAGE_ROOT?.trim() || process.env.UNIVER_RENDER_PAGE_ROOT?.trim() || fileURLToPath(new URL('./render-runtime/', import.meta.url));
      const result = await lintUnitLayout({ unitId: file.unitId, unitType: 'slide', unitData }, args.pages, {
        license: workspace.license, env: { ...process.env, UWH_RENDER_PAGE_ROOT: renderPageRoot }, signal,
      });
      return { ok: true, operation: 'lint', unitId: file.unitId, unitType: 'slide', ...(args.worktreeId ? { worktreeId: args.worktreeId } : {}), result };
    },
    presentCall: () => ({ card: 'generic', title: 'Lint Univer Slide', kind: 'read' }),
  });
}
