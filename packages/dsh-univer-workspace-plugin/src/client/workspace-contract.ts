/**
 * Browser wire contract consumed by the Workspace capability plugin.
 *
 * The host harness owns authentication and exposes these same-origin routes;
 * the capability plugin owns the Workspace UI that consumes them. Keeping the
 * browser contract here prevents the package from importing implementation
 * code from `apps/harness`.
 */

export const WORKSPACE_ME_PATH = "/api/uwh/me";
export const WORKSPACE_TEMPLATE_FORK_PATH = "/api/uwh/template-fork";
export const WORKSPACE_SPACES_PATH = "/univer-workspace/api/spaces";
export const WORKSPACE_NODES_PATH = "/univer-workspace/api/spaces";
export const WORKSPACE_TRASH_PATH = "/univer-workspace/api/spaces";
export const WORKSPACE_TRASH_BATCH_PATH = "/univer-workspace/api/trash-batches";
export const WORKSPACE_SPACE_MUTATION_PATH = "/api/uwh/spaces";
export const WORKSPACE_SESSION_CONTEXT_PATH = "/univer-workspace/api/session-context";

export interface WorkspaceSpace {
  readonly spaceId: string;
  readonly type: "personal" | "team";
  readonly name: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  readonly dshWorkspaceId: string;
  readonly capabilities?: Readonly<{
    readonly browseRoot?: boolean;
    readonly createAtRoot?: boolean;
    readonly renameSpace?: boolean;
    readonly manageMembers?: boolean;
    readonly viewTrash?: boolean;
  }>;
}

export interface WorkspaceSpaceList {
  readonly spaces: readonly WorkspaceSpace[];
}

export interface WorkspaceSpaceRenameResult {
  readonly space: {
    readonly spaceId: string;
    readonly name: string;
  };
}

export interface WorkspaceDocument {
  readonly nodeId: string;
  readonly name: string;
  readonly parentNodeId: string | null;
  readonly hasChildren: boolean;
  readonly updatedAt: string | null;
  readonly resourceId: string | null;
  readonly resourceKind: "univer" | "blob" | null;
  readonly mediaType?: string;
  readonly byteSize?: number;
  readonly availability?: "ready" | "quarantined";
  readonly unitId: string | null;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base" | null;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  readonly nodeCapabilities?: Readonly<Record<string, boolean>>;
  readonly resourceCapabilities?: Readonly<Record<string, boolean>>;
}

export interface WorkspaceTrashBatch {
  readonly id: string;
  readonly root?: { readonly id?: string; readonly name?: string; readonly resource?: unknown };
  readonly originalLocation?: { readonly breadcrumbs?: readonly { readonly name?: string }[] };
  readonly trashedAt?: string;
  readonly nodeCount?: number;
  readonly capabilities?: Readonly<{
    readonly restore?: boolean;
    readonly removePermanently?: boolean;
  }>;
}

export interface WorkspaceTemplate {
  readonly key: string;
  readonly sessionId: string;
  readonly label?: string;
  readonly agentPreset?: string;
  readonly description?: string;
}

export interface WorkspaceMeView {
  readonly workspaceOrigin: string;
  readonly templates: readonly WorkspaceTemplate[];
  readonly connected: boolean;
  readonly restartRequired: boolean;
  readonly identity?: {
    readonly userId: string;
    readonly username: string;
    readonly displayName?: string;
  };
  readonly pendingIdentity?: {
    readonly userId: string;
    readonly username: string;
    readonly displayName?: string;
  };
}
