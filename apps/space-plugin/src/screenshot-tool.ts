import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { screenshotWithAttachments, displayPathArgument, type AttachmentStoreLike, type LlmServiceLike, type ScreenshotArguments } from '@univerjs/univer-workspace-agent-runtime/workspace-screenshot';
import { screenshotParameters } from './workspace-screenshot-contract.js';
import type { AgentEditing } from './editing.js';
import type { ToolBindings } from './tools.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

/** The original screenshot workflow, registered only with DSH's attachment service. */
export function registerScreenshotTool(ctx: Context, workspace: WorkspaceConnection, bindings: ToolBindings, editing: AgentEditing) {
  return ctx.tools.register({
    name: 'univer_screenshot', parameters: { ...screenshotParameters },
    description: 'Render an explicit Workspace Unit to PNG files using the original Univer runtime and return durable DSH image attachments.',
    output: { schema: {}, render: (_args: unknown, value: any) => [
      { type: 'text' as const, text: JSON.stringify(value ?? {}) },
      ...(Array.isArray(value?.result?.images) ? value.result.images.flatMap((item: any) => item.image ? [{ type: 'image' as const, attachment: item.image }] : []) : []),
    ] },
    async execute(args: ScreenshotArguments, exec: ToolRunContext) {
      const sessionId = exec.agent?.session.id;
      if (!sessionId) throw new SpaceError(403, 'A native Agent Session is required.');
      if (!args || typeof args.unitId !== 'string' || !args.unitId.trim() || !['sheet', 'doc', 'slide', 'board', 'base'].includes(args.unitType) || typeof args.output !== 'string') throw new SpaceError(400, 'Choose a Unit and a Session-relative screenshot output directory.');
      const signal = AbortSignal.any([exec.signal, workspace.identitySignal]);
      const renderPageRoot = process.env.UWH_RENDER_PAGE_ROOT?.trim() || process.env.UNIVER_RENDER_PAGE_ROOT?.trim() || fileURLToPath(new URL('./render-runtime/', import.meta.url));
      const attachments = ctx.get('attachments') as AttachmentStoreLike | undefined;
      const llm = ctx.get('llm') as LlmServiceLike | undefined;
      return screenshotWithAttachments(args, { agent: exec.agent, signal }, attachments, llm, async () => {
        const file = await bindings.resolve(sessionId, { unitId: args.unitId, unitType: args.unitType }, signal);
        if (file.type === 'site') throw new SpaceError(400, 'A Univer Unit is required.');
        const unitData = args.worktreeId
          ? await editing.exportDraft(sessionId, args, signal)
          : await workspace.exportUnitData({ ...file, type: file.type });
        signal.throwIfAborted();
        return { unitId: file.unitId, unitType: file.type, unitData };
      }, { license: workspace.license, env: { ...process.env, UWH_RENDER_PAGE_ROOT: renderPageRoot }, signal });
    },
    presentCall: (args: ScreenshotArguments) => ({ card: 'generic', title: 'Screenshot Univer Unit', kind: 'read', locations: [{ path: displayPathArgument(args.output) }] }),
  });
}
