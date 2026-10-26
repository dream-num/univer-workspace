import type { FileReference } from './tools.js';
export interface Space {
  id: string;
  name: string;
  type: string;
}
export interface Resource {
  id: string;
  kind: string;
  unitType?: string;
  capabilities: { openContent: boolean };
  htmlView?: boolean;
}
export interface Node {
  id: string;
  name: string;
  spaceId?: string;
  resource: Resource | null;
  capabilities?: {
    browseChildren?: boolean;
    createChildren?: boolean;
    rename?: boolean;
    move?: boolean;
    trash?: boolean;
    share?: boolean;
  };
  updatedAt?: string;
  accessRole?: string;
}
export interface Page {
  nodes: Node[];
  nextCursor: string | null;
  parentNode?: Node;
  space?: Space;
  breadcrumbs?: { id: string; name: string }[];
}
export interface Recent {
  node: Node;
  resource: Resource;
  lastOpenedAt: string;
  location: { space: Space; breadcrumbs: { id: string; name: string }[] };
}
export interface Content {
  endpoint: string;
  nodeId: string;
  resourceId: string;
  unitId: string;
  name: string;
  type: 'doc' | 'sheet' | 'slide' | 'board' | 'base' | 'site';
  html?: string;
  revision: number;
  sha256: string;
  capturedAt: string;
  data: any;
  content: {
    text: string;
    sheets: {
      id: string;
      name: string;
      cells: { row: number; column: number; value: string }[];
    }[];
  };
}
export interface State {
  status: {
    state: string;
    endpoint: string;
    user?: { id?: string; username?: string; displayName?: string };
  };
  spaces: Space[];
  all: Node[];
  recent: Recent[];
  recentCursor: string | null;
  page: Page | null;
  location: 'home' | 'recent' | 'folder' | 'space';
  space: string;
  parent: string;
  content: Content | null;
  context: {
    file: FileReference;
    state: 'linking' | 'linked' | 'removed' | 'failed';
    afterSeq?: number;
  } | null;
  sessionId: string | null;
  sessionTitle: string;
  sessions: { id: string; title: string }[];
  error: string;
  busy: boolean;
  settings: boolean;
  ai: boolean;
  chatMode: 'compact' | 'expanded' | 'minimized';
  pins: string[];
  spaceTab: 'Overview' | 'Content';
  query: string;
  filter: string;
  discovery: string;
  notice: string;
}
export function nodeKind(node: Node) {
  return (
    (node.resource?.htmlView ? 'site' : node.resource?.unitType) ??
    (node.resource?.kind === 'blob' ? 'file' : 'folder')
  );
}
export const contentKinds = [
  ['doc', 'Docs'],
  ['sheet', 'Sheets'],
  ['slide', 'Slides'],
  ['board', 'Boards / Canvas'],
  ['base', 'Bases / Databases'],
  ['site', 'Pages / Sites'],
] as const;
export function kindName(kind: string) {
  return (
    (
      {
        doc: 'Document',
        sheet: 'Sheet',
        folder: 'Folder',
        slide: 'Slides',
        file: 'File',
        board: 'Board',
        base: 'Base',
        site: 'Page / Site',
      } as Record<string, string>
    )[kind] ?? kind
  );
}
export function selectedReference(file: Content): FileReference {
  if (file.type !== 'doc' && file.type !== 'sheet')
    throw new Error('Chat reading currently supports Docs and Sheets.');
  return {
    endpoint: file.endpoint,
    nodeId: file.nodeId,
    resourceId: file.resourceId,
    unitId: file.unitId,
    name: file.name,
    type: file.type,
  };
}
export function userText(data: any): string {
  return typeof data?.content === 'string'
    ? data.content
    : Array.isArray(data?.content)
      ? data.content
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('\n')
      : '';
}
export function referenceText(file: FileReference): string {
  return `[${file.name.replace(/[\\[\]]/g, '\\$&')}](workspace-file://${encodeURIComponent(file.resourceId)}?nodeId=${encodeURIComponent(file.nodeId)}&unitId=${encodeURIComponent(file.unitId)})`;
}

export function submittedReference(
  entries: readonly any[],
  file: Parameters<typeof referenceText>[0],
  afterSeq: number,
): boolean {
  const expected = referenceText(file);
  return entries.some(
    (entry) =>
      entry.type === 'event' &&
      entry.event.seq > afterSeq &&
      entry.event.type === 'user/message' &&
      entry.event.data.source?.kind === 'user' &&
      userText(entry.event.data).includes(expected),
  );
}
