import { getWorktreeDetail, openWorktreeUnit } from '@univerjs/univer-workspace-agent-runtime/workspace-worktree-api';
import type { ToolBindings } from './tools.js';
import { SpaceError, type WorkspaceConnection } from './workspace.js';

type UnitType = 'doc' | 'sheet' | 'slide' | 'board' | 'base';
/** Resolve a draft through the existing Workspace Worktree API and its ACLs. */
export async function resolveDraftTarget(workspace: WorkspaceConnection, bindings: ToolBindings, sessionId: string, args: any, signal: AbortSignal, write: boolean) {
  if (typeof args.worktreeId !== 'string' || !args.worktreeId.trim()) throw new SpaceError(400, 'A Worktree id is required.');
  const identity = workspace.identitySignal;
  const status = await workspace.status();
  identity.throwIfAborted();
  if (status.state !== 'connected' || !status.user?.id) throw new SpaceError(401, 'Sign in to Workspace first.');
  const lifetime = AbortSignal.any([signal, identity]);
  const client = { origin: status.endpoint, sessionToken: '', request: (path: string, init: RequestInit = {}) => workspace.rawRequest(path, {
    ...init, signal: init.signal ? AbortSignal.any([lifetime, init.signal]) : lifetime,
  }) };
  const detail = await getWorktreeDetail(client, args.worktreeId);
  if (write && (detail.status !== 'draft' || !detail.capabilities.editDraft)) throw new SpaceError(403, 'This Worktree is not an editable draft.');
  const current = bindings.currentFile(sessionId);
  const explicit = args.unitId || args.resourceId || args.nodeId;
  const candidates = detail.units.filter(unit =>
    (args.unitId ? unit.unitId === args.unitId : true) &&
    (args.resourceId ? unit.resourceId === args.resourceId : true) &&
    (args.nodeId ? unit.nodeId === args.nodeId : true) &&
    (!explicit ? current?.unitId === unit.unitId : true));
  if (candidates.length !== 1) throw new SpaceError(404, 'Choose a Unit that belongs to this Worktree.');
  const unit = candidates[0]!;
  if (unit.kind === 'deleted') throw new SpaceError(409, 'This Unit is marked for removal in the Worktree.');
  if (!['doc', 'sheet', 'slide', 'board', 'base'].includes(unit.unitType) || (args.unitType && args.unitType !== unit.unitType)) throw new SpaceError(409, 'The Unit type does not match the Worktree.');
  const opened = await openWorktreeUnit(client, args.worktreeId, unit.unitId, 'draft');
  if (opened.unitId !== unit.unitId || opened.unitType !== unit.unitType || opened.collaborationScope.kind !== 'worktree' || opened.collaborationScope.worktreeId !== args.worktreeId) throw new SpaceError(409, 'The Worktree returned a different Unit or scope.');
  if (write && opened.editorMode !== 'edit') throw new SpaceError(403, 'This Worktree Unit is read-only.');
  lifetime.throwIfAborted();
  return { endpoint: status.endpoint, nodeId: unit.nodeId, resourceId: unit.resourceId, unitId: unit.unitId, name: unit.name, type: unit.unitType as UnitType, worktreeId: args.worktreeId };
}
