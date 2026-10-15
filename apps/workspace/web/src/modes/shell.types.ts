import type { PropsWithChildren, ReactNode } from "react";
import type { RepositoryTab, RepositoryBreadcrumb } from "../features/spaces";

export type WorkspaceView = "home" | "apps" | "trash" | "worktrees" | "members" | "issues";

export type WorkspaceShellProps = PropsWithChildren<{
  readonly selectedSpaceId?: string;
  readonly repositoryTab?: RepositoryTab;
  readonly repositoryHome?: boolean;
  readonly repositoryBreadcrumbs?: readonly RepositoryBreadcrumb[];
  readonly selectedNodeId?: string;
  readonly selectedNodePath?: readonly string[];
  readonly selectedView?: WorkspaceView;
  readonly immersive?: boolean;
  readonly contentMode?: "default" | "editor";
  readonly headerTitle?: ReactNode;
  readonly headerContent?: ReactNode;
  readonly headerActions?: ReactNode;
}>;
