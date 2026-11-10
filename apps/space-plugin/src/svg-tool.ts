import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { compileSvg } from '@univerjs/univer-workspace-agent-runtime/workspace-svg';
import { authorizedSessionPath } from '@univerjs/univer-workspace-agent-runtime/workspace-session-path';
import { svgParameters } from './workspace-svg-contract.js';
import { SpaceError } from './workspace.js';
import type { AgentEditing } from './editing.js';

/** The original SVG-to-Facade compiler; ordinary requests target trunk. */
export function registerSvgTool(ctx: Context, editing: AgentEditing) {
  return ctx.tools.register({
    name: 'univer_compile_svg', parameters: { ...svgParameters },
    description: 'Compile an SVG from the native Session workspace into a Slide page using the original Univer Facade compiler. It commits to trunk unless an explicitly supported Worktree is supplied.',
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: any, exec: ToolRunContext) {
      const sessionId = exec.agent?.session.id;
      if (!sessionId) throw new SpaceError(403, 'A native Agent Session is required.');
      if (!args || typeof args.source !== 'string' || !args.source.trim() || typeof args.unitId !== 'string' || !args.unitId.trim() ||
          !Number.isSafeInteger(args.page) || args.page < 1 || (args.mode !== undefined && !['add', 'replace'].includes(args.mode)) ||
          (args.worktreeId !== undefined && (typeof args.worktreeId !== 'string' || !args.worktreeId.trim()))) throw new SpaceError(400, 'Provide an SVG source, Slide Unit and valid page.');
      const source = await authorizedSessionPath(exec.agent?.session.header.cwd, args.source, true);
      const compiled = await compileSvg({ source: source.path, sourceWorkspace: source.workspace, page: args.page, ...(args.mode ? { mode: args.mode } : {}), signal: exec.signal });
      const execution = await editing.edit(sessionId, { mode: 'write', unitId: args.unitId, unitType: 'slide', ...(args.worktreeId ? { worktreeId: args.worktreeId } : {}), code: compiled.code }, exec.signal);
      return { ok: true, operation: 'compile-svg', sourcePath: args.source, unitId: args.unitId, ...(args.worktreeId ? { worktreeId: args.worktreeId } : {}), page: compiled.page, mode: compiled.mode, viewport: compiled.viewport, textMeasure: compiled.textMeasure, warnings: compiled.warnings, lints: compiled.lints, execution };
    },
    presentCall: () => ({ card: 'generic', title: 'Compile SVG into Slide', kind: 'execute' }),
  });
}
