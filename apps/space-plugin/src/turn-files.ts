import { workspaceReferenceRule } from './file-reference.js';

type Reference = { label: string; nodeId: string; resourceId: string; unitId: string };
type State = { turn: number; files: Reference[] };
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap { spaceReturnedFiles: { files: readonly Reference[] } }
}

/** Project durable native Session results and assistant references as the original Workspace turn projector does. */
function append(state: State, text: string): State {
  const files = [...state.files];
  let from = 0;
  for (;;) {
    const found = workspaceReferenceRule.match(text, from, { read: () => undefined });
    if (!found) break;
    if (found.id !== 'workspace-file') { from = found.end; continue; }
    const file = found.data;
    if (!files.some((f) => f.nodeId === file.nodeId && f.resourceId === file.resourceId && f.unitId === file.unitId)) files.push(file);
    from = found.end;
  }
  return files.length === state.files.length ? state : { ...state, files };
}
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.flatMap((block) => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n');
}
function accept(state: State, event: any): State {
  if (event.type === 'assistant/message') return append(state, textOf(event.data.message.content));
  if (event.type !== 'tool/result' || event.data.message.isError || event.data.error) return state;
  try {
    const result = JSON.parse(textOf(event.data.message.content));
    return typeof result?.reference === 'string' ? append(state, result.reference) : state;
  } catch { return state; }
}
export const spaceReturnedFilesDefinition = {
  kind: 'spaceReturnedFiles',
  match(event: any) {
    if (!['turn/start', 'assistant/message', 'tool/result'].includes(event.type)) return null;
    return { id: String(event.data.turn), role: 'start' as const };
  },
  start(_context: unknown, match: any): State {
    return accept({ turn: match.event.data.turn, files: [] }, match.event);
  },
  update(context: { state: State }, match: any): State { return accept(context.state, match.event); },
  buildLocationData(context: { state?: State }, scope: string) {
    if (scope !== 'turn' || !context.state) return null;
    return { kind: 'turn' as const, turn: context.state.turn, key: 'spaceReturnedFiles' as const, value: { files: context.state.files } };
  },
};
