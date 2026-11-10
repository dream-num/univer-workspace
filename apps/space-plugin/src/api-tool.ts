import type { Context } from '@deepseek-ai/cordis';
import { ApiReferenceInputError, queryWorkspaceApi } from '@univerjs/univer-workspace-agent-runtime/api-reference';
import { SpaceError } from './workspace.js';

/** Original Workspace Agent API discovery, registered with the Host's Tools service. */
export function registerApiTool(ctx: Context) {
  return ctx.tools.register({
    name: 'univer_api',
    description: 'Look up the pinned, version-matched Univer Facade API. Use find when the class or API label is unknown; use show for a known class, type, or exact Class.member label. Each query is independent and find is case-insensitive.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'find discovers API labels; show documents a known symbol or member.', enum: ['find', 'show'] },
        queries: { type: 'array', description: 'One or more non-empty API terms, such as conditionalFormat, FRange, or FRange.setValue.', items: { type: 'string' } },
        unit: { type: 'string', description: 'Optional Unit filter for find.', enum: ['sheet', 'doc', 'slide', 'base', 'board'] },
        limit: { type: 'integer', description: 'Optional positive maximum matches per find term.' },
      },
      required: ['action', 'queries'],
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', const: true }, operation: { type: 'string', const: 'api' }, result: {},
      }, required: ['ok', 'operation', 'result'] },
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value ?? {}) }],
    },
    async execute(args: any) {
      try { return await queryWorkspaceApi(args); }
      catch (error) {
        if (error instanceof ApiReferenceInputError) throw new SpaceError(400, error.message);
        throw error;
      }
    },
    presentCall: (args: any) =>
      args && ['find', 'show'].includes(args.action) && Array.isArray(args.queries) && args.queries.every((query: unknown) => typeof query === 'string')
        ? { card: 'generic', title: `Univer API ${args.action}: ${args.queries.join(', ')}`, kind: 'read' }
        : undefined,
  });
}
