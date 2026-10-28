import React, { useState, useSyncExternalStore } from 'react';
import { ArrowUp, Check, Sparkles, Square, Undo2, X } from 'lucide-react';
import type { SelectionEditing } from '../selection-editing.js';

export function SelectionEditingControls({ editor }: { editor: SelectionEditing }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [instruction, setInstruction] = useState('');
  const anchor = state.anchor;
  const width = state.phase === 'selected' ? 155 : state.phase === 'reviewing' ? 322 : 384;
  const left = anchor ? Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left)) : 8;
  const top = anchor ? Math.max(8, Math.min(window.innerHeight - 170, state.phase === 'selected' || state.phase === 'reviewing' ? anchor.top - 52 : anchor.bottom + 8)) : 8;
  if (state.phase === 'idle' && !state.error) return null;
  return <div className="sp-selection-ai tw-font-sans" style={{ position: 'fixed', left, top, width, visibility: anchor || state.error ? 'visible' : 'hidden' }}
    onPointerDown={event => event.stopPropagation()}>
    {state.phase === 'selected' && <div role="toolbar" aria-label="Selection AI" className="tw-flex tw-h-11 tw-items-center tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-white tw-p-1 tw-shadow-md">
      <button className="tw-flex tw-h-9 tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-full hover:tw-bg-hover" onPointerDown={event => event.preventDefault()} onClick={() => { setInstruction(''); editor.begin(); }}><Sparkles size={16} />Ask for change</button>
    </div>}
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
    {state.phase === 'reviewing' && <div role="toolbar" aria-label="Review edit" className="tw-flex tw-h-11 tw-items-center tw-gap-1 tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-white tw-p-1 tw-shadow-md">
      <button className="sp-selection-ai-action" onClick={editor.undo}><Undo2 size={15} />Undo</button>
      <button className="sp-selection-ai-action" onClick={() => { setInstruction(''); editor.begin(); }}><Sparkles size={15} />Ask for change</button>
      <button className="sp-selection-ai-action sp-selection-ai-accept" onClick={() => void editor.accept()}><Check size={15} />Accept</button>
    </div>}
    {state.error && <div role="alert" className="tw-mt-2 tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-white tw-p-3 tw-text-sm tw-shadow-md">{state.error}<button aria-label="Dismiss selection edit error" onClick={editor.undo}><X size={14} /></button></div>}
  </div>;
}
