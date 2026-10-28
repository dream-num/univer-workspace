/** Body-free identity carried by the native request. Text is read by a Tool. */
export interface DocFocus {
  id: string;
  channel: string;
  kind: 'paragraph' | 'selection';
  segmentId: string;
  paragraphs: { id: string; text: string }[];
  start: number;
  end: number;
  startOffset: number;
  endOffset: number;
  text: string;
  nodeId: string;
  resourceId: string;
  unitId: string;
}

// Structural Facade interfaces keep this policy testable without another Univer
// runtime. The real FDocument/FDocumentParagraph satisfy these interfaces.
interface Paragraph {
  getId(): string;
  getText(): string;
  getInfo(): { startOffset: number; endOffset: number };
}
export interface FocusDocument {
  getParagraphs(segmentId?: string): Paragraph[];
  getParagraph(id: string, segmentId?: string): Paragraph | null;
  getTextRange(start: number, end: number, segmentId?: string): {
    getText(): string;
    setText(text: string): boolean;
  };
}
export interface DocTarget {
  kind: DocFocus['kind'];
  segmentId: string;
  paragraphs: { id: string; text: string }[];
  start: number;
  end: number;
  startOffset: number;
  endOffset: number;
  text: string;
}
export const FOCUS_TEXT_LIMIT = 24000;
// Plain text plus tab/paragraph/newline only. Embedded objects, table markers,
// section breaks and other document control tokens require their own Facades.
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
export function isFocusText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= FOCUS_TEXT_LIMIT && !controls.test(value);
}
export function parseDocFocus(value: unknown): DocFocus | null {
  if (value === null) return null;
  const v = value as DocFocus | undefined;
  if (!v || !/^[\w-]{1,128}$/.test(v.id) || !/^[\w-]{1,128}$/.test(v.channel) || !['paragraph', 'selection'].includes(v.kind) || !/^[\w-]{0,128}$/.test(v.segmentId) || !/^[\w-]{1,256}$/.test(v.nodeId) || !/^[\w-]{1,256}$/.test(v.resourceId) || !/^[\w-]{1,256}$/.test(v.unitId) || !Array.isArray(v.paragraphs) || v.paragraphs.length < 1 || v.paragraphs.length > 32 || !Number.isSafeInteger(v.start) || !Number.isSafeInteger(v.end) || !Number.isSafeInteger(v.startOffset) || !Number.isSafeInteger(v.endOffset) || !isFocusText(v.text))
    throw new Error('Invalid document focus.');
  if (v.paragraphs.some(p => !p || !/^[\w-]{1,256}$/.test(p.id) || !isFocusText(p.text))) throw new Error('Invalid document focus.');
  return { id: v.id, channel: v.channel, kind: v.kind, segmentId: v.segmentId, paragraphs: v.paragraphs.map(p => ({ id: p.id, text: p.text })), start: v.start, end: v.end, startOffset: v.startOffset, endOffset: v.endOffset, text: v.text, nodeId: v.nodeId, resourceId: v.resourceId, unitId: v.unitId };
}

/** Only SDK selection data is accepted. Never read the canvas/DOM selection. */
export function captureDocTarget(doc: FocusDocument, ranges: readonly { startOffset: number; endOffset: number; segmentId?: string }[], rectangular = false): DocTarget | null {
  if (rectangular || ranges.length !== 1) return null;
  const range = ranges[0]!;
  const { startOffset: start, endOffset: end } = range;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return null;
  const segmentId = range.segmentId ?? '';
  const all = doc.getParagraphs(segmentId);
  const first = all.findIndex(p => { const i = p.getInfo(); return start >= i.startOffset && start <= i.endOffset; });
  if (first < 0) return null;
  const kind = start === end ? 'paragraph' : 'selection';
  const last = kind === 'paragraph' ? first : all.findIndex(p => { const i = p.getInfo(); return end > i.startOffset && end <= i.endOffset + 1; });
  if (last < first) return null;
  const paragraphs = all.slice(first, last + 1);
  const head = paragraphs[0]!.getInfo(), tail = paragraphs.at(-1)!.getInfo();
  const from = kind === 'paragraph' ? head.startOffset : start;
  const to = kind === 'paragraph' ? head.endOffset : end;
  // Never replace the final segment terminator or a non-text gap.
  if (to > tail.endOffset && last === all.length - 1) return null;
  const text = doc.getTextRange(from, to, segmentId).getText();
  if (!isFocusText(text) || paragraphs.some(p => !p.getId() || !isFocusText(p.getText()))) return null;
  return {
    kind, segmentId, text,
    start: from - head.startOffset,
    end: to - tail.startOffset,
    startOffset: from,
    endOffset: to,
    paragraphs: paragraphs.map(p => ({ id: p.getId(), text: p.getText() })),
  };
}

/** Stable paragraph ids survive insertions before the target. Edits within any
 * target paragraph invalidate it; never relocate by quote/first occurrence. */
export function resolveDocTarget(doc: FocusDocument, target: DocTarget) {
  const all = doc.getParagraphs(target.segmentId);
  const first = all.findIndex(p => p.getId() === target.paragraphs[0]?.id);
  if (first < 0 || target.paragraphs.some((p, i) => all[first + i]?.getId() !== p.id || all[first + i]?.getText() !== p.text))
    throw new Error('目标段落已更改或删除，请重新选择后发送指令。');
  const head = doc.getParagraph(target.paragraphs[0]!.id, target.segmentId)!;
  const tail = doc.getParagraph(target.paragraphs.at(-1)!.id, target.segmentId)!;
  const start = head.getInfo().startOffset + target.start;
  const end = tail.getInfo().startOffset + target.end;
  const range = doc.getTextRange(start, end, target.segmentId);
  if (range.getText() !== target.text) throw new Error('目标文字已变化，请重新选择后发送指令。');
  return { range, start, end };
}
