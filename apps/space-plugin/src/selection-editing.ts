import { CommandType, DocumentDataModel, ICommandService, JSONX, TextX, TextXActionType, getRichTextEditPath, type ICommand, type Univer, type IDisposable } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { DocSelectionManagerService, DocSkeletonManagerService, RichTextEditingMutation, type IRichTextEditingMutationParams } from '@univerjs/docs';
import { DocCanvasPopManagerService, DocFloatMenuService, DocSelectionRenderService } from '@univerjs/docs-ui';
import { captureDocTarget, resolveDocTarget, type DocTarget } from './doc-focus.js';
import type { OpenFile } from './model.js';
import type { Face } from './client.js';
import { IRenderManagerService, registerDocumentLayoutPresentation } from '@univerjs/engine-render';
import { selectionProjection, selectionEditActions } from './selection-projection.js';
import type { DocFocus } from './doc-focus.js';
import { createElement } from 'react';
import { SelectionEditingControls } from './components/selection-editing.js';

// A normal Command provides the SDK history trigger for this one atomic edit.
// The SDK still validates/applies/inverts/transforms the rich-text mutation.
const AcceptDocSelectionCommand: ICommand<IRichTextEditingMutationParams> = {
  id: 'space.command.accept-doc-selection', type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params) return false;
    const result = accessor.get(ICommandService).syncExecuteCommand<IRichTextEditingMutationParams, IRichTextEditingMutationParams>(RichTextEditingMutation.id, params);
    return !!result?.actions?.length;
  },
};

export interface SelectionProposalInput {
  focus: DocFocus;
  instruction: string;
  candidate?: string;
  sessionId: string | null;
}

export interface SelectionEditState {
  phase: 'idle' | 'selected' | 'instruction' | 'editing' | 'reviewing' | 'applying' | 'applied';
  target?: DocTarget;
  candidate?: string;
  syncState?: 'pending' | 'failed' | 'complete';
  warning?: string;
  error?: string;
}

/** One ephemeral transaction per Document View. It has no Conversation owner. */
export class SelectionEditing {
  private state: SelectionEditState = { phase: 'idle' };
  private listeners = new Set<() => void>();
  private disposed = false;
  private subscription;
  private request?: AbortController;
  private projection?: { registration: IDisposable; model: DocumentDataModel; insertedLength: number };
  private revision = -1;
  private applying = false;
  private applyingMutation = false;
  private syncing = false;
  private menuSuppressed = false;
  private commandSubscription: IDisposable;
  private commandRegistration: IDisposable;
  private componentRegistration: IDisposable;
  private popup?: IDisposable;
  private popupKey = '';
  private readonly componentKey = `space-selection-ai-${crypto.randomUUID()}`;
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  constructor(
    protected readonly univer: Univer,
    protected readonly api: FUniver,
    protected readonly file: OpenFile,
    private readonly face: Face,
    private readonly setProjectionBlocked: (blocked: boolean) => void,
    private readonly flush: () => Promise<void>,
  ) {
    this.commandRegistration = univer.__getInjector().get(ICommandService).registerCommand(AcceptDocSelectionCommand);
    this.componentRegistration = api.registerComponent(this.componentKey, () => createElement('div', {
      className: 'sp-shell sp-selection-popup',
    }, createElement(SelectionEditingControls, { editor: this })));
    const service = univer.__getInjector().get(DocSelectionManagerService);
    this.subscription = service.textSelection$.subscribe(() => {
      if (!['idle', 'selected'].includes(this.state.phase) && !(this.state.phase === 'applied' && this.state.syncState === 'complete')) return;
      const doc = api.getDocument(file.unitId);
      const target = doc && captureDocTarget(doc, service.getDocRanges({ unitId: file.unitId, subUnitId: file.unitId }));
      this.set(target?.kind === 'selection' && !target.segmentId && target.text ? { phase: 'selected', target } : { phase: 'idle' });
    });
    this.commandSubscription = api.addEvent(api.Event.BeforeCommandExecute, event => {
      if (this.applyingMutation || !this.state.target || event.type !== CommandType.MUTATION) return;
      const params = event.params as { unitId?: string } | undefined;
      if (params?.unitId !== file.unitId) return;
      // Restore the authoritative renderer before any local/remote mutation.
      // A fresh selection is cheaper and safer than translating a stale proposal.
      this.request?.abort();
      this.clearProjection();
      this.set({ phase: 'idle', error: 'Document changed. Select the text again to request another edit.' });
    });
  }
  protected set(state: SelectionEditState) {
    if (this.disposed) return;
    const suppress = ['instruction', 'editing', 'reviewing', 'applying'].includes(state.phase);
    if (suppress !== this.menuSuppressed) {
      this.renderer().render.with(DocFloatMenuService).setSuppressed(suppress);
      this.menuSuppressed = suppress;
    }
    this.state = state;
    this.updatePopup();
    this.listeners.forEach(listener => listener());
  }
  protected document() {
    const doc = this.api.getDocument(this.file.unitId);
    if (!doc) throw new Error('This document is no longer open.');
    return doc;
  }
  protected validate() {
    if (!this.state.target) throw new Error('Select text in this document first.');
    return resolveDocTarget(this.document(), this.state.target);
  }
  private updatePopup() {
    const target = this.state.target;
    if (!target) {
      this.popup?.dispose();
      this.popup = undefined;
      this.popupKey = '';
      return;
    }
    const { start, end } = this.validate();
    const direction = ['instruction', 'editing'].includes(this.state.phase) ? 'bottom-left' : 'top-left';
    const projectedEnd = end + (this.projection?.insertedLength ?? 0);
    const passive = this.state.phase === 'selected';
    const key = `${start}/${projectedEnd}/${direction}/${passive}`;
    if (key === this.popupKey) return;
    this.popup?.dispose();
    // The native popup owns viewport/zoom/layout subscriptions and placement.
    // Univer's desktop UI mounts this floating layer outside the SDK container.
    this.popup = this.univer.__getInjector().get(DocCanvasPopManagerService).attachPopupToRange({
      startOffset: start, endOffset: projectedEnd, collapsed: false, segmentId: target.segmentId,
    }, {
      componentKey: this.componentKey, direction, offset: [0, 8], zIndex: 1200,
      requiresStableLayout: false, hideOnInvisible: passive, hiddenType: 'hide',
    }, this.file.unitId);
    this.popupKey = key;
  }
  begin = () => {
    if (this.applying) return;
    try {
      this.validate();
      this.set({ ...this.state, phase: 'instruction', error: undefined });
    }
    catch (error) { this.set({ phase: 'idle', error: (error as Error).message }); }
  };
  cancel = () => {
    if (this.applying) return;
    this.request?.abort();
    this.set({ ...this.state, phase: this.state.candidate === undefined ? 'selected' : 'reviewing', error: undefined });
  };
  submit = (instruction: string) => this.propose(instruction);
  undo = () => {
    if (this.applying || this.syncing) return;
    this.request?.abort(); this.clearProjection(); this.set({ phase: 'idle' });
  };
  accept = async () => {
    if (this.applying || this.state.phase !== 'reviewing' || this.state.candidate === undefined) return;
    const pending = this.state;
    const revision = this.revision;
    let mutationAttempted = false;
    this.applying = true;
    try {
      this.set({ ...pending, phase: 'applying', error: undefined });
      const { node } = await this.face.metadata(this.file.nodeId);
      if (this.disposed || this.getSnapshot().phase !== 'applying' || this.state.target !== pending.target) return;
      if (!node.resource?.capabilities.editContent || node.resource.id !== this.file.resourceId)
        throw new Error('This document can no longer be edited.');
      this.validateRevision();
      const { start, end } = this.validate();
      const document = this.document();
      const candidate = pending.candidate!;
      const model = document.getDocumentDataModel();
      const edits = selectionEditActions(model, start, end, candidate);
      this.clearProjection();
      if (!TextX.isNoop(edits)) {
        mutationAttempted = true;
        this.applyingMutation = true;
        try {
          if (!this.api.syncExecuteCommand(AcceptDocSelectionCommand.id, {
            unitId: this.file.unitId, segmentId: pending.target!.segmentId,
            actions: JSONX.getInstance().editOp(edits, getRichTextEditPath(model, pending.target!.segmentId)),
            textRanges: [], noNeedSetTextRange: true, debounce: false, isEditing: false,
          } satisfies IRichTextEditingMutationParams)) throw new Error('Univer rejected the text replacement.');
        } finally { this.applyingMutation = false; }
        // Verify the formal model before treating this candidate as applied.
        if (document.getTextRange(start, start + candidate.length, pending.target!.segmentId).getText() !== candidate)
          throw new Error('Univer did not apply the requested text replacement.');
      }
      this.set({ phase: 'applied', syncState: 'pending' });
    } catch (error) {
      if (this.disposed) return;
      const changed = this.document().getDocumentDataModel().getMutationRevision() !== revision;
      if (mutationAttempted && changed) {
        // Never offer Apply again after a local mutation, even if a downstream
        // command listener threw. Existing save guards still own these writes.
        this.set({ phase: 'applied', syncState: 'failed', warning: (error as Error).message });
      } else if (!changed && this.state.target === pending.target) {
        try {
          if (!this.projection) this.showProjection(pending.candidate!);
          this.set({ ...pending, phase: 'reviewing', error: (error as Error).message });
        } catch (restoreError) {
          // Retain the candidate even when its renderer cannot be restored.
          this.set({ ...pending, phase: 'reviewing', error: (restoreError as Error).message });
        }
      } else {
        this.set({ phase: 'idle', error: 'Document changed. Select the text again before applying an edit.' });
      }
      return;
    } finally { this.applying = false; }
    await this.retrySync();
  };
  retrySync = async () => {
    if (this.disposed || this.syncing || this.state.phase !== 'applied' || this.state.syncState === 'complete') return;
    this.syncing = true;
    const warning = this.state.warning;
    this.set({ phase: 'applied', syncState: 'pending', warning });
    try {
      // Use the same complete HTTP drain and SDK collaboration flush as leaving
      // the human editor. Retrying never executes the replacement command again.
      await this.flush();
      this.set({ phase: 'applied', syncState: 'complete', warning });
    } catch (error) {
      this.set({ phase: 'applied', syncState: 'failed', warning, error: (error as Error).message });
    } finally { this.syncing = false; }
  };
  dispose() {
    if (this.disposed) return;
    this.request?.abort();
    try {
      this.clearProjection();
      if (this.menuSuppressed) this.renderer().render.with(DocFloatMenuService).setSuppressed(false);
    } finally {
      this.disposed = true;
      this.projection?.registration.dispose();
      this.projection?.model.dispose();
      this.projection = undefined;
      this.subscription.unsubscribe();
      this.commandSubscription.dispose();
      this.commandRegistration.dispose();
      this.popup?.dispose();
      this.componentRegistration.dispose();
      this.listeners.clear();
    }
  }

  private renderer() {
    const render = this.univer.__getInjector().get(IRenderManagerService).getRenderUnitById(this.file.unitId);
    if (!render) throw new Error('Document renderer is unavailable.');
    return { render, skeleton: render.with(DocSkeletonManagerService) };
  }
  private clearProjection() {
    if (!this.projection) return;
    const current = this.projection;
    current.registration.dispose();
    const { render, skeleton } = this.renderer();
    skeleton.getViewModel().reset(this.document().getDocumentDataModel());
    skeleton.getSkeleton().makeDirty(true);
    skeleton.recalculate();
    render.mainComponent?.makeDirty();
    // On restoration failure retain the lease and input protection for retry.
    this.projection = undefined;
    current.model.dispose();
    this.setProjectionBlocked(false);
  }
  private showProjection(candidate: string) {
    this.clearProjection();
    const { start, end } = this.validate();
    const real = this.document().getDocumentDataModel();
    const snapshot = selectionProjection(real.getSnapshot(), start, end, candidate);
    const model = new DocumentDataModel(snapshot);
    const { render, skeleton } = this.renderer();
    // This public registration also keeps the incremental worker from publishing
    // real-model pages over the temporary projection. The unit is never replaced.
    const registration = registerDocumentLayoutPresentation(real, {
      getSnapshot: () => snapshot,
      captureState: () => null, applyActions: () => {}, restoreState: () => {},
    });
    const insertedLength = selectionEditActions(real, start, end, candidate)
      .reduce((length, action) => length + (action.t === TextXActionType.INSERT ? action.len : 0), 0);
    this.projection = { registration, model, insertedLength };
    this.setProjectionBlocked(true);
    skeleton.getSkeleton().cancelIncrementalLayout();
    try {
      skeleton.getViewModel().reset(model);
      skeleton.getSkeleton().makeDirty(true);
      skeleton.recalculate();
      render.with(DocSelectionRenderService).removeAllRanges();
      render.mainComponent?.makeDirty();
    } catch (error) {
      this.clearProjection();
      throw error;
    }
    // Projection offsets differ from editable offsets. Keep input in the review
    // controls until Accept/Undo; never let a projected caret write to trunk.
  }
  private async propose(instruction: string) {
    if (!instruction.trim() || this.state.phase !== 'instruction') return;
    const target = this.state.target!;
    const candidate = this.state.candidate;
    const controller = new AbortController();
    this.request?.abort();
    this.request = controller;
    try {
      this.validate();
      this.revision = this.document().getDocumentDataModel().getMutationRevision();
      this.set({ ...this.state, phase: 'editing', error: undefined });
      const result = await this.face.selectionProposal({
        sessionId: this.face.store.getSnapshot().sessionId,
        instruction, candidate,
        focus: { ...target, id: crypto.randomUUID(), channel: crypto.randomUUID(), nodeId: this.file.nodeId, resourceId: this.file.resourceId, unitId: this.file.unitId },
      }, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      this.validateRevision();
      this.showProjection(result.text);
      this.set({ ...this.state, phase: 'reviewing', candidate: result.text });
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return;
      this.set({ ...this.state, phase: candidate === undefined ? 'instruction' : 'reviewing', error: (error as Error).message });
    }
  }
  private validateRevision() {
    this.validate();
    if (this.document().getDocumentDataModel().getMutationRevision() !== this.revision)
      throw new Error('Document changed. Select the text again before applying an edit.');
  }
}
