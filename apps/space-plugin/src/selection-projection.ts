import { BooleanNumber, BuildTextUtils, DocumentDataModel, TextDecoration, TextX, TextXActionType, type IDocumentData, type TextXAction } from '@univerjs/core';

/** SDK-owned text diff. Retained text keeps its existing rich metadata rather
 * than taking empty styles from the model's plain-text replacement body. */
export function selectionEditActions(model: DocumentDataModel, start: number, end: number, candidate: string): TextXAction[] {
  const edits = BuildTextUtils.selection.replace({
    doc: model, selection: { startOffset: start, endOffset: end, collapsed: start === end },
    body: {
      dataStream: candidate,
      paragraphs: [...candidate.matchAll(/\r/g)].map(match => ({ startIndex: match.index!, paragraphId: crypto.randomUUID() })),
    },
  });
  if (!edits) throw new Error('This selection cannot be replaced safely.');
  const actions = edits.serialize().map(action => action.t === TextXActionType.RETAIN ? { t: action.t, len: action.len } : action);
  return actions.some(action => action.t !== TextXActionType.RETAIN) ? actions : [];
}

/** A render copy only. The exact SDK edit actions also drive the formal apply. */
export function selectionProjection(source: IDocumentData, start: number, end: number, candidate: string): IDocumentData {
  const snapshot = structuredClone(source);
  if (!snapshot.body || start < 0 || end <= start || end >= snapshot.body.dataStream.length)
    throw new Error('This selection cannot be previewed safely.');
  snapshot.body.textRuns ??= [];
  const model = new DocumentDataModel(snapshot);
  let edits: TextXAction[];
  try { edits = selectionEditActions(model, start, end, candidate); }
  finally { model.dispose(); }
  const presentation = new TextX();
  for (const edit of edits) {
    if (edit.t === TextXActionType.DELETE) {
      presentation.retain(edit.len, { dataStream: '', textRuns: [{ st: 0, ed: edit.len, ts: {
        cl: { rgb: '#8f8f8f' }, st: { s: BooleanNumber.TRUE, t: TextDecoration.SINGLE },
      } }] });
    } else if (edit.t === TextXActionType.INSERT) {
      presentation.insert(edit.len, { ...edit.body, textRuns: [{ st: 0, ed: edit.len, ts: {
        cl: { rgb: '#2c67c5' }, bg: { rgb: 'rgba(44,103,197,0.10)' },
      } }] });
    } else presentation.retain(edit.len);
  }
  TextX.apply(snapshot.body, presentation.serialize());
  return snapshot;
}
