import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { DocSelectionManagerService } from '@univerjs/docs';
import { DocCanvasPopManagerService } from '@univerjs/docs-ui';
import { captureDocTarget, resolveDocTarget, type DocTarget } from './doc-focus.js';
import type { OpenFile } from './model.js';

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
  ) {
    const service = univer.__getInjector().get(DocSelectionManagerService);
    this.subscription = service.textSelection$.subscribe(() => {
      if (!['idle', 'selected'].includes(this.state.phase)) return;
      const doc = api.getDocument(file.unitId);
      const target = doc && captureDocTarget(doc, service.getDocRanges({ unitId: file.unitId, subUnitId: file.unitId }));
      this.set(target?.kind === 'selection' && target.text ? { phase: 'selected', target } : { phase: 'idle' });
      this.reposition();
    });
    window.addEventListener('scroll', this.schedulePosition, true);
    window.addEventListener('resize', this.schedulePosition);
    element.addEventListener('wheel', this.schedulePosition, { passive: true });
    element.addEventListener('keyup', this.schedulePosition);
    this.observer = new ResizeObserver(this.schedulePosition);
    this.observer.observe(element);
  }
  protected set(state: SelectionEditState) {
    if (this.disposed) return;
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
      this.set({ phase: 'idle', error: (error as Error).message });
    }
  }
  begin = () => {
    try { this.validate(); this.set({ ...this.state, phase: 'instruction', error: undefined }); }
    catch (error) { this.set({ phase: 'idle', error: (error as Error).message }); }
  };
  cancel = () => { this.set({ ...this.state, phase: this.state.candidate === undefined ? 'selected' : 'reviewing', error: undefined }); };
  submit: (instruction: string) => Promise<void> = async () => {
    this.set({ ...this.state, error: 'AI proposal integration is not available in this build.' });
  };
  undo = () => { this.set({ phase: 'idle' }); };
  accept: () => Promise<void> = async () => {};
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.subscription.unsubscribe();
    this.observer.disconnect();
    window.removeEventListener('scroll', this.schedulePosition, true);
    window.removeEventListener('resize', this.schedulePosition);
    this.element.removeEventListener('wheel', this.schedulePosition);
    this.element.removeEventListener('keyup', this.schedulePosition);
    this.listeners.clear();
  }
}
