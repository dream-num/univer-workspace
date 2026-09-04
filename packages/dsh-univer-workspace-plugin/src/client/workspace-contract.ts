/**
 * Browser wire contract consumed by the Workspace capability plugin.
 *
 * The host harness owns authentication and exposes these same-origin routes;
 * the capability plugin owns the Workspace UI that consumes them. Keeping the
 * browser contract here prevents the package from importing implementation
 * code from `apps/harness`.
 */

export const WORKSPACE_LOGIN_PATH = "/auth/login";
export const WORKSPACE_ME_PATH = "/api/uwh/me";
export const WORKSPACE_TEMPLATE_FORK_PATH = "/api/uwh/template-fork";
export const WORKSPACE_SPACES_PATH = "/univer-workspace/api/spaces";
export const WORKSPACE_SPACE_MUTATION_PATH = "/api/uwh/spaces";

export interface WorkspaceSpace {
  readonly spaceId: string;
  readonly type: "personal" | "team";
  readonly name: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  readonly dshWorkspaceId: string;
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
}
