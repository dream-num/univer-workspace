import React, { useState, useSyncExternalStore } from 'react';
import { ArrowUp, Check, Sparkles, Square, Undo2, X } from 'lucide-react';
import type { SelectionEditing } from '../selection-editing.js';

export function SelectionEditingControls({ editor }: { editor: SelectionEditing }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [instruction, setInstruction] = useState('');
  const reviewing = state.phase === 'reviewing' || state.phase === 'applying';
  const width = reviewing ? 322 : 384;
  if (state.phase === 'idle' || state.phase === 'selected' || state.phase === 'applied') return null;
  return <div className="sp-selection-ai tw-font-sans" style={{ width }}
    onPointerDown={event => event.stopPropagation()}>
    {state.phase === 'instruction' && <form aria-label="Edit instruction" className="tw-rounded-3xl tw-border tw-border-solid tw-border-line tw-bg-white tw-p-3 tw-shadow-md" onSubmit={event => { event.preventDefault(); if (instruction.trim()) void editor.submit(instruction); }}>
      <textarea autoFocus aria-label="Edit instruction" placeholder="Describe the edit…" value={instruction} rows={2}
        className="tw-w-full tw-resize-none tw-border-0 tw-bg-transparent tw-text-sm tw-outline-none"
        onChange={event => setInstruction(event.target.value)} onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); editor.cancel(); }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (instruction.trim()) void editor.submit(instruction); }
        }} />
      <div className="tw-flex tw-justify-end tw-gap-2">
        <button type="button" aria-label="Cancel edit instruction" className="sp-selection-ai-round" onClick={editor.cancel}><X size={16} /></button>
        <button type="submit" aria-label="Submit edit" disabled={!instruction.trim()} className="sp-selection-ai-round sp-selection-ai-submit"><ArrowUp size={18} /></button>
      </div>
    </form>}
    {state.phase === 'editing' && <div role="status" className="tw-flex tw-h-14 tw-items-center tw-justify-between tw-rounded-3xl tw-border tw-border-solid tw-border-line tw-bg-white tw-px-3 tw-shadow-md"><span className="tw-text-muted">Editing…</span><button aria-label="Stop generation" className="sp-selection-ai-round sp-selection-ai-submit" onClick={editor.cancel}><Square size={14} fill="currentColor" /></button></div>}
    {reviewing && <div role="toolbar" aria-label="Review edit" aria-busy={state.phase === 'applying'} className="tw-flex tw-h-11 tw-items-center tw-gap-1 tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-white tw-p-1 tw-shadow-md">
      <button disabled={state.phase === 'applying'} className="sp-selection-ai-action" onClick={editor.undo}><Undo2 size={15} />Undo</button>
      <button disabled={state.phase === 'applying'} className="sp-selection-ai-action" onClick={() => { setInstruction(''); editor.begin(); }}><Sparkles size={15} />Ask for change</button>
      <button disabled={state.phase === 'applying'} className="sp-selection-ai-action sp-selection-ai-accept" onClick={() => void editor.accept()}><Check size={15} />{state.phase === 'applying' ? 'Applying…' : 'Accept'}</button>
    </div>}
    {state.error && <div role="alert" className="tw-mt-2 tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-white tw-p-3 tw-text-sm tw-shadow-md">{state.error}<button aria-label="Dismiss selection edit error" onClick={editor.undo}><X size={14} /></button></div>}
  </div>;
}

/** Application/save errors stay outside the SDK surface after its range popup closes. */
export function SelectionEditingNotice({ editor }: { editor: SelectionEditing }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  if (state.phase !== 'applied' && !(state.phase === 'idle' && state.error)) return null;
  const pending = state.syncState === 'pending';
  return <div className="sp-selection-ai sp-selection-notice tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-white tw-p-3 tw-text-sm tw-shadow-md" role={state.error || state.warning ? 'alert' : 'status'}>
    {state.phase === 'applied' && <div>{pending ? 'Applied locally · Saving…' : state.syncState === 'failed' ? 'Applied locally · Not yet synchronized' : state.warning ? 'Local changes synchronized · Check the document' : 'Edit synchronized'}</div>}
    {(state.error || state.warning) && <div>{state.warning}{state.warning && state.error ? ' · ' : ''}{state.error}</div>}
    {state.syncState === 'failed' && <button className="sp-selection-ai-action" onClick={() => void editor.retrySync()}>Retry sync</button>}
    <button disabled={pending} className="sp-selection-ai-action" aria-label="Dismiss selection edit notice" onClick={editor.undo}><X size={14} />Dismiss</button>
  </div>;
}
