export interface Space { id: string; name: string; type: string }
export interface Resource { id: string; kind: string; unitType?: string; capabilities: { openContent: boolean } }
export interface Node { id: string; name: string; spaceId?: string; resource: Resource | null; capabilities?: { browseChildren?: boolean }; updatedAt?: string }
export interface Page { nodes: Node[]; nextCursor: string | null; parentNode?: Node; space?: Space; breadcrumbs?: { id: string; name: string }[] }
export interface Recent { node: Node; resource: Resource; lastOpenedAt: string; location: { space: Space; breadcrumbs: { id: string; name: string }[] } }
export interface Content {
  endpoint: string; nodeId: string; resourceId: string; unitId: string;
  name: string; type: 'doc' | 'sheet'; revision: number; sha256: string; capturedAt: string;
  data: any;
  content: { text: string; sheets: { id: string; name: string; cells: { row: number; column: number; value: string }[] }[] };
}
export interface State {
  status: { state: string; endpoint: string; user?: { id?: string; username?: string; displayName?: string } };
  spaces: Space[]; recent: Recent[]; recentCursor: string | null;
  page: Page | null; location: 'home' | 'recent' | 'folder'; space: string; parent: string;
  content: Content | null; context: { file: Omit<Content, 'data'>; state: 'selected' | 'draft' | 'submitted'; marker?: string } | null;
  sessionId: string | null; sessionTitle: string; sessions: { id: string; title: string }[];
  experience: 'unverified' | 'requested' | 'reduced'; error: string; busy: boolean; settings: boolean; ai: boolean; rail: boolean;
  query: string; filter: string;
}
export function nodeKind(node: Node) { return node.resource?.unitType ?? (node.resource?.kind === 'blob' ? 'file' : 'folder'); }
export function kindName(kind: string) { return ({ doc: 'Document', sheet: 'Sheet', folder: 'Folder', slide: 'Slides', file: 'File', board: 'Board', base: 'Base' } as Record<string,string>)[kind] ?? kind; }
export function selectedSnapshot(file: Content): Omit<Content, 'data'> { const { data, ...snapshot } = file; return structuredClone(snapshot); }
export function userText(data: any): string {
  return typeof data?.content === 'string' ? data.content : Array.isArray(data?.content) ? data.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n') : '';
}

/** Human-readable native context; opaque server identifiers stay in the selection. */
export function contextText(file: Omit<Content, 'data'>): string {
  const body = file.type === 'doc' ? file.content.text.replace(/\r\n?/g, '\n') : file.content.sheets.map(sheet =>
    `工作表：${sheet.name}\n` + sheet.cells.map(cell => `行 ${cell.row + 1}，列 ${cell.column + 1}：${cell.value}`).join('\n')
  ).join('\n\n');
  return `参考文件：《${file.name}》\n类型：${kindName(file.type)} · 版本：${file.revision}\n范围：${file.type === 'doc' ? '正文文本' : '工作表名称与单元格'}（冻结快照）\n快照指纹：${file.sha256}\n\n${body}`;
}
