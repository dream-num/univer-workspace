import type { ReactElement, ReactNode } from "react";

export type WorkspaceFileLocale = "en-US" | "zh-CN";
export type WorkspaceFileAccessRole = "owner" | "admin" | "editor" | "viewer";
export type WorkspaceUnitType = "sheet" | "doc" | "slide" | "board" | "base";

export interface WorkspaceFileSpaceCapabilities {
  readonly browseRoot: boolean;
  readonly createAtRoot: boolean;
  readonly renameSpace: boolean;
  readonly manageMembers: boolean;
  readonly viewTrash: boolean;
}

export interface WorkspaceFileSpace {
  readonly id: string;
  readonly type: "personal" | "team";
  readonly name: string;
  readonly accessRole: WorkspaceFileAccessRole;
  readonly capabilities: WorkspaceFileSpaceCapabilities;
}

export interface WorkspaceFileNodeCapabilities {
  readonly browseChildren: boolean;
  readonly createChildren: boolean;
  readonly rename: boolean;
  readonly move: boolean;
  readonly trash: boolean;
  readonly share: boolean;
}

export interface WorkspaceFileResource {
  readonly id: string;
  readonly kind: "univer" | "blob";
  readonly unitType?: WorkspaceUnitType;
  readonly mediaType?: string;
  readonly byteSize?: number;
}

export interface WorkspaceFileNode {
  readonly id: string;
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly name: string;
  readonly resource: WorkspaceFileResource | null;
  readonly hasChildren: boolean;
  readonly accessRole: WorkspaceFileAccessRole;
  readonly capabilities: WorkspaceFileNodeCapabilities;
}

export interface WorkspaceFileChildrenRequest {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly signal: AbortSignal;
}

export interface WorkspaceFileMoveRequest {
  readonly nodeId: string;
  readonly parentNodeId: string | null;
}

export type WorkspaceFileCreateKind = "folder" | WorkspaceUnitType;
export type WorkspaceDocumentMode = "modern" | "classic";

export interface WorkspaceFileCreateRequest {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly name: string;
  readonly kind: WorkspaceFileCreateKind;
  readonly documentMode: WorkspaceDocumentMode;
}

export interface WorkspaceFileUploadRequest {
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly file: File;
}

export interface WorkspaceFileUser {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly avatarUrl?: string | null;
}

export type WorkspaceFileShareRole = "editor" | "viewer";

export interface WorkspaceFileGrant {
  readonly user: WorkspaceFileUser;
  readonly role: WorkspaceFileShareRole;
  readonly effectiveRole: WorkspaceFileAccessRole;
}

export interface WorkspaceFileLinkSharing {
  readonly enabled: boolean;
  readonly role: WorkspaceFileShareRole;
}

export interface WorkspaceFileSharingDataSource {
  loadGrants(nodeId: string): Promise<readonly WorkspaceFileGrant[]>;
  searchUsers(query: string): Promise<readonly WorkspaceFileUser[]>;
  loadLinkSharing(nodeId: string): Promise<WorkspaceFileLinkSharing>;
  setGrant(input: {
    readonly nodeId: string;
    readonly userId: string;
    readonly role: WorkspaceFileShareRole;
  }): Promise<void>;
  removeGrant(input: { readonly nodeId: string; readonly userId: string }): Promise<void>;
  setLinkSharing(input: {
    readonly nodeId: string;
    readonly enabled: boolean;
    readonly role: WorkspaceFileShareRole;
  }): Promise<void>;
}

export interface WorkspaceFileTreeDataSource {
  loadChildren(input: WorkspaceFileChildrenRequest): Promise<readonly WorkspaceFileNode[]>;
  moveNode(input: WorkspaceFileMoveRequest): Promise<void>;
}

export interface WorkspaceFileBrowserDataSource extends WorkspaceFileTreeDataSource {
  createTeamSpace(input: {
    readonly name: string;
    readonly publicRead: boolean;
  }): Promise<WorkspaceFileSpace>;
  createNode(input: WorkspaceFileCreateRequest): Promise<void>;
  uploadFile(input: WorkspaceFileUploadRequest): Promise<void>;
  renameNode(input: { readonly node: WorkspaceFileNode; readonly name: string }): Promise<void>;
  trashNode(input: { readonly node: WorkspaceFileNode }): Promise<void>;
  nodeUrl(node: WorkspaceFileNode): string;
  readonly sharing: WorkspaceFileSharingDataSource;
}

export interface WorkspaceFileBrowserProps {
  readonly spaces: readonly WorkspaceFileSpace[];
  readonly dataSource: WorkspaceFileBrowserDataSource;
  readonly storageScope: string;
  readonly locale: WorkspaceFileLocale;
  readonly selectedSpaceId?: string;
  readonly selectedNodeId?: string;
  readonly selectedNodePath?: readonly string[];
  readonly onOpenSpace: (space: WorkspaceFileSpace) => void;
  readonly onOpenNode: (node: WorkspaceFileNode) => void;
  /** Additional node actions owned by the embedding product. */
  readonly renderNodeActions?: (
    node: WorkspaceFileNode,
    controls: WorkspaceFileTreeControls,
  ) => ReactNode;
}

export interface WorkspaceFileTreeControls {
  readonly refresh: () => void;
  readonly expand: () => void;
}

export interface WorkspaceFileTreeProps {
  readonly spaces: readonly WorkspaceFileSpace[];
  readonly dataSource: WorkspaceFileTreeDataSource;
  readonly storageScope: string;
  readonly locale: WorkspaceFileLocale;
  readonly selectedSpaceId?: string;
  readonly selectedNodeId?: string;
  readonly selectedNodePath?: readonly string[];
  readonly onOpenSpace: (space: WorkspaceFileSpace) => void;
  readonly onOpenNode: (node: WorkspaceFileNode) => void;
  readonly renderSpaceActions?: (
    space: WorkspaceFileSpace,
    controls: WorkspaceFileTreeControls,
  ) => ReactNode;
  readonly renderTeamActions?: () => ReactNode;
  readonly decorateNodeRow?: (
    node: WorkspaceFileNode,
    controls: WorkspaceFileTreeControls,
    renderRow: (actions?: ReactNode) => ReactElement,
  ) => ReactElement;
}
