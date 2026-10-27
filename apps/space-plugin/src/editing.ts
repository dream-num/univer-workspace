import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SpaceError, type WorkspaceConnection } from './workspace.js';
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
    if (p.phase === 'applying')
      throw new SpaceError(409, 'Changes are being applied.');
    if (args.worktreeId && args.worktreeId !== p.worktreeId)
      throw new SpaceError(403, 'This draft belongs to a different request.');
    await this.authorize(p);
    p.turn = turn;
    return p;
  }
  private async post(path: string, data?: unknown, key?: string) {
    return this.workspace.json(path, {
      method: 'POST',
      headers: key ? { 'Idempotency-Key': key } : {},
      body: data === undefined ? undefined : JSON.stringify(data),
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
    if (!['create', 'ready'].includes(args.action))
      throw new SpaceError(
        403,
        'Apply or reject changes in the document Review controls.',
      );
    const p = await this.target(session, args);
    return this.perform(p, signal, async () => {
      const id = await this.ensureDraft(p);
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
  async edit(session: string, args: any, signal: AbortSignal) {
    if (
      args.mode !== 'write' ||
      typeof args.code !== 'string' ||
      !args.code.trim() ||
      args.code.length > 64000
    )
      throw new SpaceError(
        400,
        'mode=write and bounded Facade code are required.',
      );
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
  async inspect(session: string, args: any, signal: AbortSignal) {
    signal.throwIfAborted();
    const p = await this.target(session, args);
    if (!p.worktreeId || p.operation)
      throw new SpaceError(409, 'No completed draft is available to inspect.');
    const result = await this.workspace.inspectDraft(
      p.file as FileReference & { type: 'doc' | 'sheet' },
      p.worktreeId,
      args.sheet,
      args.range,
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
  private async discard(p: Pending, phase: 'rejected' | 'canceled') {
    p.review = undefined;
    if (p.worktreeId)
      await this.post(
        `/api/worktrees/${p.worktreeId}/discard`,
        undefined,
        `${p.id}-discard`,
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
    await this.bindings.scope(session);
    const p = this.proposals.get(this.key(session, node));
    if (!p || p.id !== proposalId)
      throw new SpaceError(409, 'This proposal is no longer current.');
    if (action === 'cancel' || action === 'reject') {
      if (p.phase === 'applying')
        throw new SpaceError(409, 'Apply is already in progress.');
      if (p.phase === 'applied')
        throw new SpaceError(409, 'These changes were already applied.');
      p.cancelRequested = true;
      p.phase = 'canceling';
      if (p.operation) await p.operation.catch(() => {});
      if ((p as Proposal).phase !== 'canceled')
        await this.discard(p, action === 'reject' ? 'rejected' : 'canceled');
      if (action === 'reject') p.phase = 'rejected';
      return this.public(p);
    }
    await this.authorize(p);
    if (
      p.operation ||
      !p.worktreeId ||
      !['ready', 'conflict'].includes(p.phase)
    )
      throw new SpaceError(409, 'Wait until changes are ready.');
    if (action === 'review') {
      p.review = await this.post(
        `/universer-api/worktrees/${p.worktreeId}/review`,
        { unitId: p.file.unitId },
      );
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
        );
        if (result.worktree?.state !== 'merged')
          throw new SpaceError(409, 'The Server could not apply all changes.');
        p.phase = 'applied';
        p.review = undefined;
        return this.public(p);
      } catch (error) {
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
    unitType: { type: 'string', enum: ['doc', 'sheet'] },
    worktreeId: { type: 'string' },
  };
  const disposers = [
    ctx.tools.register({
      name: 'univer_worktree',
      description:
        'Create an isolated draft of the document fixed when this request was sent, then mark it ready for human Review. Never merges or publishes. The user applies/rejects in the current document.',
      parameters: {
        type: 'object',
        properties: {
          ...identity,
          action: { type: 'string', enum: ['create', 'ready'] },
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
        'Execute real Univer Facade API code on the isolated current-document Worktree using the existing Fork headless runtime. mode=write only. Variables: api/univerAPI, workbook (Sheets), doc (Docs). Commits actual draft changesets; shared content is unchanged until human Review/Apply. Read first with univer_inspect. Examples: doc.appendParagraph("new paragraph"); return doc.save().body.dataStream; or workbook.getActiveSheet().getRange("B2").setValue(37); return true;',
      parameters: {
        type: 'object',
        properties: {
          ...identity,
          mode: { type: 'string', enum: ['write'] },
          code: { type: 'string' },
        },
        required: ['mode', 'code'],
      },
      output,
      execute: (args: any, exec: ToolRunContext) =>
        editing.edit(session(exec), args, exec.signal),
      presentCall: () => ({
        card: 'generic',
        title: 'Edit document draft',
        kind: 'edit',
      }),
    }),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
