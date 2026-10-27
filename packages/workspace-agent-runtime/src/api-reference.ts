import type { ApiReferenceUnit, createStandardApiReference } from '@univer-cli/api-reference';

export interface WorkspaceApiQuery {
  action: 'find' | 'show';
  queries: string[];
  unit?: 'sheet' | 'doc' | 'slide' | 'base' | 'board';
  limit?: number;
}

export class ApiReferenceInputError extends Error {}
let reference: Promise<ReturnType<typeof createStandardApiReference>> | undefined;

/** Shared implementation of the original Workspace Agent's version-matched API lookup. */
export async function queryWorkspaceApi(args: WorkspaceApiQuery) {
  if (!args || !['find', 'show'].includes(args.action) || !Array.isArray(args.queries) ||
      args.queries.length === 0 || args.queries.some(query => typeof query !== 'string' || !query.trim()))
    throw new ApiReferenceInputError('univer_api requires an action and at least one non-empty query.');
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1))
    throw new ApiReferenceInputError('univer_api limit must be a positive integer.');
  if (args.unit !== undefined && !['sheet', 'doc', 'slide', 'base', 'board'].includes(args.unit))
    throw new ApiReferenceInputError('univer_api unit must be a supported Unit type.');
  const api = await (reference ??= import('@univer-cli/api-reference').then(module => module.createStandardApiReference()));
  const result = args.action === 'show'
    ? api.show(args.queries)
    : api.find({ terms: args.queries, ...(args.unit === undefined ? {} : { unit: args.unit as ApiReferenceUnit }),
        ...(args.limit === undefined ? {} : { limit: args.limit }) });
  return { ok: true as const, operation: 'api' as const, result };
}
