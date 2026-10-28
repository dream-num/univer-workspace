import { CommandType, DocumentDataModel, type Univer, type IDisposable } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { DocSelectionManagerService, DocSkeletonManagerService, DocStateChangeManagerService } from '@univerjs/docs';
import { DocCanvasPopManagerService, DocFloatMenuService, DocSelectionRenderService } from '@univerjs/docs-ui';
import { captureDocTarget, resolveDocTarget, type DocTarget } from './doc-focus.js';
import type { OpenFile } from './model.js';
import type { Face } from './client.js';
import { IRenderManagerService, registerDocumentLayoutPresentation } from '@univerjs/engine-render';
import { selectionProjection } from './selection-projection.js';
import type { DocFocus } from './doc-focus.js';

export interface SelectionProposalInput {
  focus: DocFocus;
  instruction: string;
  candidate?: string;
  sessionId: string | null;
}

export interface SelectionEditState {
  phase: 'idle' | 'selected' | 'instruction' | 'editing' | 'reviewing';
  target?: DocTarget;
  anchor?: { left: number; top: number; bottom: number };
  candidate?: string;
  error?: string;
}

/** One ephemeral transaction per Document View. It has no Conversation owner. */
export class SelectionEditing {
  private state: SelectionEditState = { phase: 'idle' };
  private listeners = new Set<() => void>();
  private disposed = false;
  private frame = 0;
  private subscription;
  private observer;
  private request?: AbortController;
  private projection?: { registration: IDisposable; model: DocumentDataModel };
  private revision = -1;
  private applying = false;
  private menuSuppressed = false;
  private commandSubscription: IDisposable;
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  constructor(
    protected readonly univer: Univer,
    protected readonly api: FUniver,
    protected readonly file: OpenFile,
    protected readonly element: HTMLElement,
    private readonly face: Face,
  ) {
    const service = univer.__getInjector().get(DocSelectionManagerService);
    this.subscription = service.textSelection$.subscribe(() => {
      if (!['idle', 'selected'].includes(this.state.phase)) return;
      const doc = api.getDocument(file.unitId);
      const target = doc && captureDocTarget(doc, service.getDocRanges({ unitId: file.unitId, subUnitId: file.unitId }));
      this.set(target?.kind === 'selection' && !target.segmentId && target.text ? { phase: 'selected', target } : { phase: 'idle' });
      this.reposition();
    });
    window.addEventListener('scroll', this.schedulePosition, true);
    window.addEventListener('resize', this.schedulePosition);
    element.addEventListener('wheel', this.schedulePosition, { passive: true });
    element.addEventListener('keyup', this.schedulePosition);
    this.observer = new ResizeObserver(this.schedulePosition);
    this.observer.observe(element);
    this.commandSubscription = api.addEvent(api.Event.BeforeCommandExecute, event => {
      if (!this.state.target || event.type !== CommandType.MUTATION) return;
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
    const suppress = !['idle', 'selected'].includes(state.phase);
    if (suppress !== this.menuSuppressed) {
      this.renderer().render.with(DocFloatMenuService).setSuppressed(suppress);
      this.menuSuppressed = suppress;
    }
    this.state = state;
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
  readonly schedulePosition = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.reposition());
  };
  protected reposition() {
    if (!this.state.target) return;
    try {
      const { start, end } = this.validate();
      const bounds = this.univer.__getInjector().get(DocCanvasPopManagerService).getRangeBounds({
        startOffset: start, endOffset: end, collapsed: false, segmentId: this.state.target.segmentId,
      }, this.file.unitId);
      const rect = bounds?.[0];
      const viewport = this.element.getBoundingClientRect();
      const anchor = rect && rect.bottom > viewport.top && rect.top < viewport.bottom
        ? { left: rect.left, top: rect.top, bottom: rect.bottom } : undefined;
      if (JSON.stringify(anchor) !== JSON.stringify(this.state.anchor)) this.set({ ...this.state, anchor });
    } catch (error) {
      this.request?.abort();
      this.clearProjection();
      this.set({ phase: 'idle', error: (error as Error).message });
    }
  }
  begin = () => {
    try {
      this.validate();
      this.set({ ...this.state, phase: 'instruction', error: undefined });
    }
    catch (error) { this.set({ phase: 'idle', error: (error as Error).message }); }
  };
  cancel = () => {
    this.request?.abort();
    this.set({ ...this.state, phase: this.state.candidate === undefined ? 'selected' : 'reviewing', error: undefined });
  };
  submit = (instruction: string) => this.propose(instruction);
  undo = () => { this.request?.abort(); this.clearProjection(); this.set({ phase: 'idle' }); };
  accept = async () => {
    if (this.applying || this.state.phase !== 'reviewing' || this.state.candidate === undefined) return;
    const pending = this.state;
    this.applying = true;
    try {
      const { node } = await this.face.metadata(this.file.nodeId);
      if (this.disposed || this.state.phase !== 'reviewing' || this.state.target !== pending.target || this.state.candidate !== pending.candidate) return;
      if (!node.resource?.capabilities.editContent || node.resource.id !== this.file.resourceId)
        throw new Error('This document can no longer be edited.');
      this.validateRevision();
      const { range } = this.validate();
      const candidate = this.state.candidate!;
      this.clearProjection();
      this.set({ phase: 'idle' });
      if (!range.setText(candidate)) throw new Error('Univer rejected the text replacement.');
      this.univer.__getInjector().get(DocStateChangeManagerService).flushPendingChanges(this.file.unitId);
      // Same SDK collaboration queue and save/unload guards as human input.
      await this.api.getCollaboration().flush(this.file.unitId, { timeout: 20000 });
    } catch (error) {
      this.set({ ...this.state, error: (error as Error).message });
    } finally { this.applying = false; }
  };
  dispose() {
    if (this.disposed) return;
    this.request?.abort();
    this.clearProjection();
    if (this.menuSuppressed) this.renderer().render.with(DocFloatMenuService).setSuppressed(false);
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.subscription.unsubscribe();
    this.commandSubscription.dispose();
    this.observer.disconnect();
    window.removeEventListener('scroll', this.schedulePosition, true);
    window.removeEventListener('resize', this.schedulePosition);
    this.element.removeEventListener('wheel', this.schedulePosition);
    this.element.removeEventListener('keyup', this.schedulePosition);
    this.listeners.clear();
  }

  private renderer() {
    const render = this.univer.__getInjector().get(IRenderManagerService).getRenderUnitById(this.file.unitId);
    if (!render) throw new Error('Document renderer is unavailable.');
    return { render, skeleton: render.with(DocSkeletonManagerService) };
  }
  private clearProjection() {
    if (!this.projection) return;
    const current = this.projection;
    this.projection = undefined;
    current.registration.dispose();
    const { render, skeleton } = this.renderer();
    skeleton.getViewModel().reset(this.document().getDocumentDataModel());
    skeleton.getSkeleton().makeDirty(true);
    skeleton.recalculate();
    render.mainComponent?.makeDirty();
    current.model.dispose();
    // The existing disconnect boundary remains authoritative.
    this.element.inert = ['offline', 'denied'].includes(this.element.parentElement?.dataset.editorState ?? '');
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
    this.projection = { registration, model };
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
    this.element.inert = true;
    this.schedulePosition();
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
