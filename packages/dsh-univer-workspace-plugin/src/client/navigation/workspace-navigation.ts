export type WorkspaceNavigationMode = "sessions" | "files" | "worktrees";

export interface WorkspaceResourceSurface {
  readonly kind: "resource";
  readonly workspaceOrigin: string;
  readonly resourceId: string;
  readonly docKey: `res:${string}`;
  readonly name: string;
  readonly unitType: string | null;
  readonly spaceName?: string;
}

export interface WorkspaceBlobSurface {
  readonly kind: "blob";
  readonly workspaceOrigin: string;
  readonly resourceId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly byteSize: number | null;
}

export interface WorkspaceWorktreeSurface {
  readonly kind: "worktree";
  readonly workspaceOrigin: string;
  readonly worktreeId: string;
  readonly name: string;
  readonly unitId: string | null;
  /** Conversation route context used to return to the originating turn. */
  readonly sessionId?: string;
}

export type WorkspaceContentSurface =
  | WorkspaceResourceSurface
  | WorkspaceBlobSurface
  | WorkspaceWorktreeSurface;

export interface WorkspaceNavigationState {
  readonly navigationMode: WorkspaceNavigationMode;
  readonly contentSurface: WorkspaceContentSurface | null;
}

export type WorkspaceNavigationIntent =
  | {
      readonly type: "select-navigation";
      readonly navigationMode: WorkspaceNavigationMode;
    }
  | {
      readonly type: "open-content";
      readonly contentSurface: WorkspaceContentSurface;
    }
  | { readonly type: "close-content" };

export interface WorkspaceNavigationStore {
  getSnapshot(): WorkspaceNavigationState;
  subscribe(listener: () => void): () => void;
  dispatch(intent: WorkspaceNavigationIntent): void;
}

export const INITIAL_WORKSPACE_NAVIGATION_STATE: WorkspaceNavigationState = {
  navigationMode: "sessions",
  contentSurface: null,
};

export function workspaceNavigationModeOf(value: string | null): WorkspaceNavigationMode {
  return value === "files" || value === "worktrees" ? value : "sessions";
}

/** Select the content surface consumed by the middle Workspace overlay. */
export function resolveWorkspaceOverlaySurface(
  contentSurface: WorkspaceContentSurface | null,
): WorkspaceContentSurface | null {
  return contentSurface;
}

export function reduceWorkspaceNavigation(
  state: WorkspaceNavigationState,
  intent: WorkspaceNavigationIntent,
): WorkspaceNavigationState {
  switch (intent.type) {
    case "select-navigation":
      return state.navigationMode === intent.navigationMode
        ? state
        : { ...state, navigationMode: intent.navigationMode };
    case "open-content":
      // Opening an existing preview must also reveal a collapsed or closed native tab.
      return { ...state, contentSurface: { ...intent.contentSurface } };
    case "close-content":
      return state.contentSurface === null ? state : { ...state, contentSurface: null };
  }
}

export function createWorkspaceNavigationStore(
  initialState: WorkspaceNavigationState = INITIAL_WORKSPACE_NAVIGATION_STATE,
): WorkspaceNavigationStore {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(intent) {
      const next = reduceWorkspaceNavigation(state, intent);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}
