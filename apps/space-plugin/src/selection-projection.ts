import { BooleanNumber, TextDecoration, TextX, TextXActionType, type IDocumentData } from '@univerjs/core';

/** A render copy only. TextX preserves and shifts the SDK's structural metadata. */
export function selectionProjection(source: IDocumentData, start: number, end: number, candidate: string): IDocumentData {
  const snapshot = structuredClone(source);
  if (!snapshot.body || start < 0 || end <= start || end >= snapshot.body.dataStream.length)
    throw new Error('This selection cannot be previewed safely.');
  snapshot.body.textRuns ??= [];
  const original = snapshot.body.dataStream.slice(start, end);
  // One contiguous replacement, without introducing a second text-diff engine.
  let prefix = 0, suffix = 0;
  while (prefix < original.length && prefix < candidate.length && original[prefix] === candidate[prefix]) prefix++;
  if (prefix && /[\uD800-\uDBFF]/.test(original[prefix - 1]!)) prefix--;
  while (suffix < original.length - prefix && suffix < candidate.length - prefix && original[original.length - suffix - 1] === candidate[candidate.length - suffix - 1]) suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(original[original.length - suffix]!)) suffix--;
  const removed = original.length - prefix - suffix;
  const inserted = candidate.slice(prefix, candidate.length - suffix);
  const actions = new TextX().retain(start + prefix);
  if (removed) actions.retain(removed, { dataStream: '', textRuns: [{ st: 0, ed: removed, ts: {
    cl: { rgb: '#8f8f8f' }, st: { s: BooleanNumber.TRUE, t: TextDecoration.SINGLE },
  } }] });
  if (inserted) actions.insert(inserted.length, {
    dataStream: inserted,
    textRuns: [{ st: 0, ed: inserted.length, ts: { cl: { rgb: '#2c67c5' }, bg: { rgb: 'rgba(44,103,197,0.10)' } } }],
    paragraphs: [...inserted.matchAll(/\r/g)].map(match => ({ startIndex: match.index!, paragraphId: crypto.randomUUID() })),
  });
  TextX.apply(snapshot.body, actions.serialize());
  return snapshot;
}
