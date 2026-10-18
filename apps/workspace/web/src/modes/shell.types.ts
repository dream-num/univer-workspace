import type { PropsWithChildren, ReactNode } from "react";
import type { RepositoryTab, RepositoryBreadcrumb } from "./repository/repository-tabs";

export type WorkspaceView = "home" | "apps" | "trash" | "worktrees" | "members" | "issues";
export type RepositoryGlobalView =
  | "home"
  | "repositories"
  | "worktrees"
  | "issues"
  | "recent"
  | "apps";

export type WorkspaceShellProps = PropsWithChildren<{
  readonly selectedSpaceId?: string;
  readonly repositoryTab?: RepositoryTab;
  readonly repositoryHome?: boolean;
  readonly repositoryView?: RepositoryGlobalView;
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
