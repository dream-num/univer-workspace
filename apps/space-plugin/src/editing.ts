import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { authorizedSessionPath } from '@univerjs/univer-workspace-agent-runtime/workspace-session-path';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SpaceError, type WorkspaceConnection } from './workspace.js';
import { resolveDraftTarget } from './draft-target.js';
import { createWorktree, addWorktreeTrunkUnit, getWorktreeDetail, worktreeSummaryFromDetail, markWorktreeReady, reopenWorktree } from '@univerjs/univer-workspace-agent-runtime/workspace-worktree-api';
import { openResource } from '@univerjs/univer-workspace-agent-runtime/workspace-resources';
import type { FileReference, ToolBindings } from './tools.js';
import type { Proposal } from './model.js';
export type { Proposal } from './model.js';
type Phase = Proposal['phase'];
interface Pending extends Proposal {
  worktreeId?: string;
  unitAdded?: boolean;
  operation?: Promise<unknown>;
  cancelRequested?: boolean;
  review?: any;
  applyKey: string;
}
/** Product orchestration only. All document execution and Worktree operations
 * reuse the Fork runtime and authenticated Server APIs, never snapshot writes. */
export class AgentEditing {
  private proposals = new Map<string, Pending>();
  constructor(
    private workspace: WorkspaceConnection,
    private bindings: ToolBindings,
  ) {}
  private key(session: string, node: string) {
    return `${session}/${node}`;
  }
  private async authorize(p: Pending) {
    const scope = await this.bindings.scope(p.sessionId);
    if (scope.userId !== p.userId || scope.endpoint !== p.file.endpoint)
      throw new SpaceError(403, 'Workspace identity changed.');
    const { node } = await this.workspace.json(
      `/api/nodes/${encodeURIComponent(p.file.nodeId)}`,
    );
    if (
      node.resource?.id !== p.file.resourceId ||
      node.resource?.unitId !== p.file.unitId ||
      node.resource?.unitType !== p.file.type
    )
      throw new SpaceError(409, 'Document identity changed.');
    if (!node.resource.capabilities.editContent)
      throw new SpaceError(
        403,
        'You do not have permission to edit this document.',
      );
  }
  private public(p: Pending): Proposal {
    const { id, file, userId, sessionId, turn, phase, message, revision } = p;
    return {
      id,
      file,
      userId,
      sessionId,
      turn,
      phase,
      message,
      ...(revision === undefined ? {} : { revision }),
    };
  }
  async status(session: string, node: string) {
    const scope = await this.bindings.scope(session);
    const p = this.proposals.get(this.key(session, node));
    return p && p.userId === scope.userId && p.file.endpoint === scope.endpoint
      ? this.public(p)
      : null;
  }
  private async target(session: string, args: any) {
    const scope = await this.bindings.scope(session);
    const { file, turn } = this.bindings.writingTurn(session);
    if (!file || !['doc', 'sheet'].includes(file.type))
      throw new SpaceError(400, 'AI editing is available for Docs and Sheets.');
    if (
      (args.nodeId && args.nodeId !== file.nodeId) ||
      (args.resourceId && args.resourceId !== file.resourceId) ||
      (args.unitId && args.unitId !== file.unitId) ||
      (args.unitType && args.unitType !== file.type)
    )
      throw new SpaceError(
        409,
        'This request is bound to a different document.',
      );
    let p = this.proposals.get(this.key(session, file.nodeId));
    if (
      p?.turn === turn &&
      ['canceled', 'rejected', 'canceling', 'applied'].includes(p.phase)
    )
      throw new SpaceError(
        409,
        'This editing request has ended. Send a new request to edit again.',
      );
    if (
      !p ||
      p.userId !== scope.userId ||
      p.file.endpoint !== scope.endpoint ||
      ['canceled', 'rejected', 'applied'].includes(p.phase)
    ) {
      p = {
        id: randomUUID(),
        file,
        sessionId: session,
        userId: scope.userId,
        turn,
        phase: 'editing',
        message: '',
        applyKey: randomUUID(),
      };
      await this.authorize(p);
      this.proposals.set(this.key(session, file.nodeId), p);
    }
    if (p.phase === 'applying' || p.phase === 'uncertain')
      throw new SpaceError(409, 'The Apply result must be confirmed before editing again.');
    if (args.worktreeId && args.worktreeId !== p.worktreeId)
      throw new SpaceError(403, 'This draft belongs to a different request.');
    await this.authorize(p);
    p.turn = turn;
    return p;
  }
  private async post(path: string, data?: unknown, key?: string, signal?: AbortSignal) {
    return this.workspace.json(path, {
      method: 'POST',
      headers: key ? { 'Idempotency-Key': key } : {},
      body: data === undefined ? undefined : JSON.stringify(data),
      signal,
    });
  }
  private async ensureDraft(p: Pending) {
    if (!p.worktreeId) {
      const worktree = await this.post(
        '/api/worktrees',
        {
          kind: 'user',
          name: `AI · ${p.file.name}`,
          visibility: 'private',
          summary: null,
        },
        p.id,
      );
      p.worktreeId = worktree.id;
    }
    if (!p.unitAdded) {
      await this.post(
        `/api/worktrees/${p.worktreeId}/units`,
        { source: 'trunk', resourceId: p.file.resourceId },
        `${p.id}-unit`,
      );
      p.unitAdded = true;
    }
    return p.worktreeId!;
  }
  private async perform<T>(
    p: Pending,
    signal: AbortSignal,
    action: () => Promise<T>,
  ): Promise<T> {
    if (p.operation)
      throw new SpaceError(409, 'This draft is still being edited.');
    signal.throwIfAborted();
    const cancel = () => {
      p.cancelRequested = true;
      p.phase = 'canceling';
    };
    signal.addEventListener('abort', cancel, { once: true });
    const operation = (async () => {
      try {
        const result = await action();
        if (p.cancelRequested || signal.aborted)
          throw new SpaceError(409, 'Editing canceled.');
        return result;
      } catch (error) {
        if (!p.cancelRequested) {
          p.phase = 'failed';
          p.message = '未能生成修改，请在聊天中查看反馈后重试。';
        }
        throw error;
      } finally {
        if (p.cancelRequested) {
          try {
            await this.discard(p, 'canceled');
          } catch {
            p.phase = 'failed';
            p.message =
              'Cancellation could not be confirmed. Shared content has not been applied.';
          }
        }
      }
    })();
    p.operation = operation;
    try {
      return await operation;
    } finally {
      p.operation = undefined;
      signal.removeEventListener('abort', cancel);
    }
  }
  async worktree(session: string, args: any, signal: AbortSignal) {
    const current = this.bindings.currentFile(session);
    const general = (args.action === 'create' && (!current || (args.resourceId && args.resourceId !== current.resourceId))) ||
      (args.action === 'ready' && args.worktreeId && !this.matchingProposal(session, args)) || (args.action === 'reopen' && !this.matchingProposal(session, args));
    if (general) {
      const identity = this.workspace.identitySignal;
      const status = await this.workspace.status();
      identity.throwIfAborted();
      if (status.state !== 'connected' || !status.user?.id) throw new SpaceError(401, 'Sign in to Workspace first.');
      const lifetime = AbortSignal.any([signal, identity]);
      const client = { origin: status.endpoint, sessionToken: '', request: (path: string, init: RequestInit = {}) => this.workspace.rawRequest(path, {
        ...init, signal: init.signal ? AbortSignal.any([lifetime, init.signal]) : lifetime,
      }) };
      if (args.action === 'create') {
        if (args.resourceId !== undefined && (typeof args.resourceId !== 'string' || !args.resourceId.trim())) throw new SpaceError(400, 'Provide a valid Resource id.');
        if (args.name !== undefined && (typeof args.name !== 'string' || !args.name.trim())) throw new SpaceError(400, 'Provide a valid Worktree name.');
        if (args.resourceId) await openResource(client, args.resourceId);
        const created = await createWorktree(client, { name: args.name ?? 'Univer worktree', summary: args.summary ?? null });
        if (!args.resourceId) return created;
        const added = await addWorktreeTrunkUnit(client, created.id, args.resourceId);
        const detail = await getWorktreeDetail(client, created.id);
        if (!detail.units.some(unit => unit.unitId === added.unitId && unit.resourceId === args.resourceId)) throw new SpaceError(502, 'The Worktree was created but its Unit was not registered.');
        return worktreeSummaryFromDetail(detail);
      }
      if (typeof args.worktreeId !== 'string' || !args.worktreeId.trim()) throw new SpaceError(400, 'A Worktree id is required.');
      return args.action === 'ready' ? markWorktreeReady(client, args.worktreeId) : reopenWorktree(client, args.worktreeId);
    }
    if (!['create', 'ready', 'reopen'].includes(args.action))
      throw new SpaceError(
        403,
        'Apply or reject changes in the document Review controls.',
      );
    const p = await this.target(session, args);
    return this.perform(p, signal, async () => {
      const id = await this.ensureDraft(p);
      if (args.action === 'reopen') {
        await this.post(`/api/worktrees/${id}/reopen`);
        p.phase = 'editing';
        p.review = undefined;
      }
      if (args.action === 'ready') {
        if (p.revision === undefined)
          throw new SpaceError(409, 'No draft changes were committed.');
        await this.post(`/api/worktrees/${id}/ready`);
        p.phase = 'ready';
      }
      return {
        ...this.public(p),
        worktreeId: id,
        committedToSharedDocument: false,
      };
    });
  }
  /** Existing current-document proposals keep their Review state; other explicit Worktrees use Server identities. */
  private matchingProposal(session: string, args: any) {
    const file = this.bindings.currentFile(session);
    if (!file) return undefined;
    const p = this.proposals.get(this.key(session, file.nodeId));
    if (!p?.worktreeId || p.worktreeId !== args.worktreeId) return undefined;
    if ((args.nodeId && args.nodeId !== file.nodeId) || (args.resourceId && args.resourceId !== file.resourceId) || (args.unitId && args.unitId !== file.unitId) || (args.unitType && args.unitType !== file.type)) return undefined;
    return p;
  }
  async draftTarget(session: string, args: any, signal: AbortSignal, write = false) {
    return resolveDraftTarget(this.workspace, this.bindings, session, args, signal, write);
  }
  private async editExplicitDraft(session: string, args: any, signal: AbortSignal) {
    const identity = this.workspace.identitySignal;
    const target = await this.draftTarget(session, args, signal, args.mode === 'write');
    identity.throwIfAborted();
    if (args.mode === 'read') {
      const value = await this.workspace.readUnitDraft(target, target.worktreeId, args.code, args.revision);
      signal.throwIfAborted(); identity.throwIfAborted();
      return { committed: false, value, file: target, worktreeId: target.worktreeId };
    }
    const result = await this.workspace.executeDraft(target, target.worktreeId, args.code, args.revision, signal);
    signal.throwIfAborted(); identity.throwIfAborted();
    return { ...result, value: result.value ?? null, file: target, worktreeId: target.worktreeId, committedToSharedDocument: false };
  }
  async edit(session: string, args: any, signal: AbortSignal) {
    if (
      !['read', 'write'].includes(args.mode) ||
      typeof args.code !== 'string' ||
      !args.code.trim() ||
      args.code.length > 64000
    )
      throw new SpaceError(
        400,
        'mode=read or write and bounded Facade code are required.',
      );
    if (args.revision !== undefined && (!Number.isSafeInteger(args.revision) || args.revision < 0)) throw new SpaceError(400, 'Invalid revision.');
    if (args.worktreeId && !this.matchingProposal(session, args)) return this.editExplicitDraft(session, args, signal);
    const explicit = args.nodeId || args.resourceId || args.unitId;
    const admitted = explicit ? undefined : this.bindings.writingTurn(session);
    const file = explicit ? await this.bindings.resolve(session, args, signal) : admitted?.file;
    if (!file) throw new SpaceError(403, 'No document was associated when this request was sent.');
    if (args.mode === 'read') {
      if (!['doc', 'sheet', 'slide', 'board', 'base'].includes(file.type)) throw new SpaceError(400, 'This content is not a Univer Unit.');
      if (args.worktreeId) {
        const p = await this.target(session, args);
        if (p.worktreeId !== args.worktreeId || p.operation) throw new SpaceError(409, 'No completed draft is available.');
        await this.authorize(p);
        const value = await this.workspace.readUnitDraft(p.file as FileReference & { type: 'doc' | 'sheet' }, args.worktreeId, args.code, args.revision);
        signal.throwIfAborted();
        return { committed: false, value, file, worktreeId: args.worktreeId };
      }
      const identity = this.workspace.identitySignal;
      const value = await this.workspace.readUnit(file as FileReference & { type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' }, args.code, args.revision);
      signal.throwIfAborted(); identity.throwIfAborted();
      return { committed: false, value, file };
    }
    const existing = this.proposals.get(this.key(session, file.nodeId));
    const turn = this.bindings.activeTurn(session);
    // A Worktree is explicit: either supplied by the caller or created earlier
    // in this turn for this document. Ordinary Floating Chat writes target trunk.
    if (!args.worktreeId && !(existing && turn?.file?.nodeId === file.nodeId && existing.turn === turn.turn && existing.worktreeId)) {
      return this.editTrunk(session, file, args, signal);
    }
    const p = await this.target(session, args);
    return this.perform(p, signal, async () => {
      const id = await this.ensureDraft(p);
      if (p.phase === 'ready' || p.phase === 'conflict')
        await this.post(`/api/worktrees/${id}/reopen`);
      p.phase = 'editing';
      p.message = '';
      p.review = undefined;
      const result = await this.workspace.executeDraft(
        p.file as FileReference & { type: 'doc' | 'sheet' },
        id,
        args.code,
        args.revision,
      );
      await this.authorize(p);
      p.revision = result.revision;
      return {
        ...result,
        value: result.value ?? null,
        worktreeId: id,
        file: p.file,
        committedToSharedDocument: false,
      };
    });
  }
  private async editTrunk(session: string, file: FileReference, args: any, signal: AbortSignal) {
    const scope = await this.bindings.scope(session);
    if (!['doc', 'sheet', 'slide', 'board', 'base'].includes(file.type))
      throw new SpaceError(400, 'This content is not a Univer Unit.');
    if ((args.nodeId && args.nodeId !== file.nodeId) ||
        (args.resourceId && args.resourceId !== file.resourceId) ||
        (args.unitId && args.unitId !== file.unitId) ||
        (args.unitType && args.unitType !== file.type))
      throw new SpaceError(409, 'This request is bound to a different document.');
    const identity = this.workspace.identitySignal;
    const { node } = await this.workspace.json(`/api/nodes/${encodeURIComponent(file.nodeId)}`, { signal });
    if (identity.aborted || scope.endpoint !== file.endpoint)
      throw new SpaceError(403, 'Workspace identity changed.');
    if (node.resource?.id !== file.resourceId || node.resource?.unitId !== file.unitId || node.resource?.unitType !== file.type)
      throw new SpaceError(409, 'Document identity changed.');
    if (!node.resource.capabilities.editContent)
      throw new SpaceError(403, 'You do not have permission to edit this document.');
    const result = await this.workspace.executeTrunk(
      file as FileReference & { type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' }, args.code, signal, args.revision,
    );
    return { ...result, value: result.value ?? null, file, committedToSharedDocument: result.committed };
  }
  async exportDraft(session: string, args: any, signal: AbortSignal) {
    if (!this.matchingProposal(session, args)) {
      const identity = this.workspace.identitySignal;
      const target = await this.draftTarget(session, args, signal);
      identity.throwIfAborted();
      const value = await this.workspace.exportUnitData(target, target.worktreeId, args.revision);
      signal.throwIfAborted(); identity.throwIfAborted();
      return value;
    }
    const p = await this.target(session, args);
    if (!p.worktreeId || p.worktreeId !== args.worktreeId || p.operation) throw new SpaceError(409, 'No completed draft is available.');
    await this.authorize(p);
    const value = await this.workspace.exportUnitData(p.file as FileReference & { type: 'doc' | 'sheet' }, p.worktreeId, args.revision);
    signal.throwIfAborted();
    return value;
  }
  async inspect(session: string, args: any, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.matchingProposal(session, args)) {
      const identity = this.workspace.identitySignal;
      const target = await this.draftTarget(session, args, signal);
      identity.throwIfAborted();
      const range = args.range && args.sheet && !args.range.includes('!') ? `'${args.sheet.replace(/'/g, "''")}'!${args.range}` : args.range;
      if (target.type === 'board' || target.type === 'base') {
        if (range) throw new SpaceError(400, 'Range inspection requires a Sheet Unit.');
        const offset = args.offset ?? 0, limit = args.limit ?? 120;
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 400) throw new SpaceError(400, 'offset >= 0 and 1 <= limit <= 400 are required.');
        const rows = JSON.stringify(await this.workspace.exportUnitData(target, target.worktreeId, args.revision), null, 2).split('\n');
        const lines: { index: number; text: string }[] = []; let length = 0;
        for (let i = offset; i < Math.min(rows.length, offset + limit); i++) {
          if (rows[i]!.length > 24000) throw new SpaceError(413, 'A content line exceeds the read limit.');
          if (length + rows[i]!.length > 24000) break;
          length += rows[i]!.length; lines.push({ index: i, text: rows[i]! });
        }
        signal.throwIfAborted(); identity.throwIfAborted();
        return { file: target, worktreeId: target.worktreeId, scope: 'draft', format: 'univer-unit-json', offset, total: rows.length, lines, nextOffset: offset + lines.length < rows.length ? offset + lines.length : null };
      }
      const result = await this.workspace.inspectUnit(target, range, args.revision, target.worktreeId);
      signal.throwIfAborted(); identity.throwIfAborted();
      return { file: target, worktreeId: target.worktreeId, scope: 'draft', result };
    }
    const p = await this.target(session, args);
    if (!p.worktreeId || p.operation)
      throw new SpaceError(409, 'No completed draft is available to inspect.');
    const range = args.range && args.sheet && !args.range.includes('!')
      ? `'${args.sheet.replace(/'/g, "''")}'!${args.range}` : args.range;
    const result = await this.workspace.inspectUnit(
      p.file as FileReference & { type: 'doc' | 'sheet' }, range, args.revision, p.worktreeId,
    );
    signal.throwIfAborted();
    await this.authorize(p);
    return {
      file: p.file,
      worktreeId: p.worktreeId,
      ...(p.revision === undefined ? {} : { revision: p.revision }),
      scope: 'draft',
      result,
    };
  }
  private async discard(p: Pending, phase: 'rejected' | 'canceled', signal?: AbortSignal) {
    p.review = undefined;
    if (p.worktreeId)
      await this.post(
        `/api/worktrees/${p.worktreeId}/discard`,
        undefined,
        `${p.id}-discard`,
        signal,
      );
    p.phase = phase;
  }
  async action(
    session: string,
    node: string,
    action: string,
    proposalId?: string,
    reviewToken?: string,
  ) {
    const identity = this.workspace.identitySignal;
    const scope = await this.bindings.scope(session);
    const checkIdentity = () => {
      if (identity.aborted || identity !== this.workspace.identitySignal)
        throw new SpaceError(409, 'Workspace identity changed. Review the changes again.');
    };
    checkIdentity();
    const p = this.proposals.get(this.key(session, node));
    if (!p || p.id !== proposalId)
      throw new SpaceError(409, 'This proposal is no longer current.');
    if (scope.userId !== p.userId || scope.endpoint !== p.file.endpoint)
      throw new SpaceError(403, 'Workspace identity changed.');
    if (action === 'cancel' || action === 'reject') {
      if (p.phase === 'applying' || p.phase === 'uncertain')
        throw new SpaceError(409, 'The Apply result must be confirmed before discarding changes.');
      if (p.phase === 'applied')
        throw new SpaceError(409, 'These changes were already applied.');
      p.cancelRequested = true;
      p.phase = 'canceling';
      if (p.operation) await p.operation.catch(() => {});
      checkIdentity();
      if ((p as Proposal).phase !== 'canceled')
        await this.discard(p, action === 'reject' ? 'rejected' : 'canceled', identity);
      if (action === 'reject') p.phase = 'rejected';
      return this.public(p);
    }
    await this.authorize(p);
    try { checkIdentity(); }
    catch (error) { p.review = undefined; throw error; }
    if (
      p.operation ||
      !p.worktreeId ||
      !['ready', 'conflict', 'uncertain'].includes(p.phase)
    )
      throw new SpaceError(409, 'Wait until changes are ready.');
    if (action === 'review') {
      if (p.phase === 'uncertain')
        throw new SpaceError(409, 'Confirm the previous Apply result before reviewing again.');
      const review = await this.post(
        `/universer-api/worktrees/${p.worktreeId}/review`,
        { unitId: p.file.unitId },
        undefined,
        identity,
      );
      checkIdentity();
      p.review = review;
      return p.review;
    }
    if (action === 'apply') {
      if (!p.review || p.review.reviewToken !== reviewToken)
        throw new SpaceError(409, 'Review these changes before applying.');
      p.phase = 'applying';
      try {
        const result = await this.post(
          `/api/worktrees/${p.worktreeId}/merge`,
          { reviewToken },
          p.applyKey,
          identity,
        );
        if (result.worktree?.state !== 'merged')
          throw new SpaceError(409, 'The Server could not apply all changes.');
        p.phase = 'applied';
        p.review = undefined;
        return this.public(p);
      } catch (error) {
        if (error instanceof SpaceError && error.status >= 500) {
          // The Server may have committed before the response was lost. Keep
          // the exact approved token and operation key for safe recovery.
          p.phase = 'uncertain';
          p.message = 'Apply result not confirmed. Retry the same approved changes to check recovery.';
          throw new SpaceError(502, p.message);
        }
        p.phase = 'conflict';
        p.message = error instanceof Error ? error.message : 'Apply failed.';
        p.review = undefined;
        p.applyKey = randomUUID();
        throw error;
      }
    }
    throw new SpaceError(400, 'Unknown review action.');
  }
}

export function registerEditingTools(ctx: Context, editing: AgentEditing) {
  const output = {
    schema: {},
    render: (_args: unknown, value: unknown) => [
      { type: 'text' as const, text: JSON.stringify(value) },
    ],
  };
  const session = (exec: ToolRunContext) => {
    const id = exec.agent?.session.id;
    if (!id) throw new SpaceError(403, 'A native Agent Session is required.');
    return id;
  };
  const identity = {
    nodeId: { type: 'string' },
    resourceId: { type: 'string' },
    unitId: { type: 'string' },
    unitType: { type: 'string', enum: ['doc', 'sheet', 'slide', 'board', 'base'] },
    worktreeId: { type: 'string' },
  };
  const disposers = [
    ctx.tools.register({
      name: 'univer_worktree',
      description:
        'Create or ready an isolated Workspace Worktree, or reopen a ready draft. The current Docs or Sheets document uses the existing in-document Review controls. Other Worktree Review surfaces are not connected in this host; this tool never merges or publishes.',
      parameters: {
        type: 'object',
        properties: {
          ...identity,
          action: { type: 'string', enum: ['create', 'ready', 'reopen'] },
          name: { type: 'string' }, summary: { type: 'string' },
        },
        required: ['action'],
      },
      output,
      execute: (args: any, exec: ToolRunContext) =>
        editing.worktree(session(exec), args, exec.signal),
      presentCall: () => ({
        card: 'generic',
        title: 'Prepare document changes',
        kind: 'edit',
      }),
    }),
    ctx.tools.register({
      name: 'univer_edit',
      description:
        'Read or write using Univer Facade API code for the admitted current Workspace Unit or an explicit authorized nodeId, resourceId, or unitId. With no worktreeId, commits changes to the shared trunk through collaboration. When an explicit Worktree is created for this turn, writes go to its draft for Review. Read first with univer_inspect. Variables include api/univerAPI and the type-specific Unit handle.',
      parameters: {
        type: 'object',
        properties: {
          ...identity,
          mode: { type: 'string', enum: ['read', 'write'] },
          code: { type: 'string' },
          revision: { type: 'integer' },
        },
        required: ['mode', 'code'],
      },
      output,
      execute: (args: any, exec: ToolRunContext) =>
        editing.edit(session(exec), args, exec.signal),
      presentCall: () => ({
        card: 'generic',
        title: 'Edit Workspace content',
        kind: 'edit',
      }),
    }),
    ctx.tools.register({
      name: 'univer_execute',
      description: 'Execute Facade code in the admitted or explicitly identified Workspace Unit. Provide exactly one of code or codeFile in the native Session workspace. Writes commit to trunk unless the current request has an explicit Worktree.',
      parameters: { type: 'object', properties: { ...identity, revision: { type: 'integer' }, code: { type: 'string' }, codeFile: { type: 'string' } } },
      output,
      async execute(args: any, exec: ToolRunContext) {
        if (!args || (typeof args.code === 'string') === (typeof args.codeFile === 'string')) throw new SpaceError(400, 'Provide exactly one of code or codeFile.');
        let code = args.code;
        if (args.codeFile !== undefined) {
          const source = await authorizedSessionPath(exec.agent?.session.header.cwd, args.codeFile, true);
          code = await readFile(source.path, 'utf8');
        }
        return editing.edit(session(exec), { ...args, mode: 'write', code }, exec.signal);
      },
      presentCall: () => ({ card: 'generic', title: 'Execute Univer Facade code', kind: 'execute' }),
    }),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
