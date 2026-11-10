import { mkdir } from 'node:fs/promises';
import { FilesystemResourceCache, FilesystemResourceOutput, HttpsResourceDownloader, createResourceLibrary, loadResourceManifestFromPath } from '@univer-cli/resource-library';
import { authorizedSessionPath } from './session-path.js';

export class ResourceOperationError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'ResourceOperationError'; }
}
type Args = { action: string; queries?: readonly string[]; registries?: readonly string[]; limit?: number; handle?: string; handles?: readonly string[]; output?: string };
/** Original version-pinned Workspace Agent resource library operations. */
export async function runResourceOperation(args: Args, cwd: string | undefined, manifestPath: string, signal?: AbortSignal) {
  if (!args || !['registries', 'find', 'read', 'export', 'clear-cache'].includes(args.action)) throw new ResourceOperationError('Invalid resource action.', 'RESOURCE_INPUT_INVALID');
  const workspace = await authorizedSessionPath(cwd, '.', true);
  const cache = await authorizedSessionPath(workspace.workspace, '.dsh-univer-resource-cache', false);
  const library = createResourceLibrary({ manifest: loadResourceManifestFromPath(manifestPath), cache: new FilesystemResourceCache(cache.path), downloader: new HttpsResourceDownloader(), output: new FilesystemResourceOutput() });
  await mkdir(cache.path, { recursive: true }); signal?.throwIfAborted();
  let result: unknown;
  if (args.action === 'registries') result = library.listRegistries();
  else if (args.action === 'clear-cache') result = await library.clearCache();
  else if (args.action === 'find') {
    const queries = nonEmptyList(args.queries, 'queries', 'find');
    if (args.registries !== undefined && (!Array.isArray(args.registries) || args.registries.some(item => typeof item !== 'string' || !item.trim()))) throw new ResourceOperationError('univer_resources find registries must be non-empty strings.', 'RESOURCE_INPUT_INVALID');
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1)) throw new ResourceOperationError('univer_resources find limit must be a positive integer.', 'RESOURCE_INPUT_INVALID');
    result = library.find({ queries, ...(args.registries ? { registries: args.registries } : {}), ...(args.limit === undefined ? {} : { limit: args.limit }) });
  } else if (args.action === 'read') {
    if (typeof args.handle !== 'string' || !args.handle.trim()) throw new ResourceOperationError('univer_resources read requires a non-empty handle.', 'RESOURCE_INPUT_INVALID');
    result = await library.read({ handle: args.handle });
  } else {
    const handles = nonEmptyList(args.handles, 'handles', 'export');
    if (typeof args.output !== 'string' || !args.output.trim()) throw new ResourceOperationError('univer_resources export requires a non-empty output directory.', 'RESOURCE_INPUT_INVALID');
    const output = await authorizedSessionPath(workspace.workspace, args.output, false);
    result = await library.export({ handles, destination: output.path });
  }
  signal?.throwIfAborted();
  return { ok: true as const, operation: 'resources' as const, result };
}
function nonEmptyList(value: readonly string[] | undefined, name: string, action: string) {
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !item.trim())) throw new ResourceOperationError(`univer_resources ${action} requires at least one non-empty ${name}.`, 'RESOURCE_INPUT_INVALID');
  return value;
}
