import { contentTypes, contentType, creationName } from './content-types.js';
export interface FileReference {
  endpoint: string;
  nodeId: string;
  resourceId: string;
  unitId: string;
  name: string;
  type: Content['type'];
}
export interface Proposal {
  id: string;
  file: FileReference;
  userId: string;
  sessionId: string;
  turn: number;
  phase: 'editing' | 'applying' | 'ready' | 'canceling' | 'canceled' | 'rejected' | 'applied' | 'conflict' | 'failed';
  message: string;
  revision?: number;
}
export interface Space {
  id: string;
  name: string;
  type: string;
  accessRole?: string;
  publicRead?: boolean;
  owner?: { id: string; username: string };
  capabilities?: {
    createAtRoot?: boolean;
    renameSpace?: boolean;
    manageMembers?: boolean;
    viewTrash?: boolean;
  };
}
export interface Resource {
  id: string;
  kind: string;
  unitType?: string;
  capabilities: { openContent: boolean; editContent?: boolean };
  htmlView?: boolean;
}
export interface Node {
  id: string;
  name: string;
  spaceId?: string;
  parentNodeId?: string | null;
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
  node?: Node;
  space?: Space;
  breadcrumbs?: { id: string; name: string }[];
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
  hostNavigation: 'checking' | 'active' | 'unsupported';
  status: {
    state: string;
    endpoint: string;
    oauth?: { phase: string; message: string };
    user?: {
      id?: string;
      username?: string;
      displayName?: string;
      avatarUrl?: string | null;
    };
  };
  spaces: Space[];
  all: Node[];
  recent: Recent[];
  recentCursor: string | null;
  page: Page | null;
  location: 'home' | 'recent' | 'folder' | 'space' | 'trash';
  trash: TrashBatch[];
  sharing: import('./sharing.js').ShareTarget | null;
  action: {
    kind: 'rename' | 'move' | 'delete' | 'rename-space';
    node?: Node;
    space?: Space;
  } | null;
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
export const contentKinds = contentTypes.map(
  (type) => [type.kind, type.label] as const,
);
export function kindName(kind: string) {
  return (
    contentType(kind)?.label ?? (kind === 'file' ? 'File' : creationName(kind))
  );
}
export interface TrashBatch {
  id: string;
  spaceId: string;
  root: { id: string; name: string };
  capabilities: { restore: boolean };
  restoreBlockedBy?: { name?: string } | null;
  originalLocation: { breadcrumbs: { id: string; name: string }[] };
}
export function selectedReference(file: Content): FileReference {
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
